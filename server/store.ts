import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { backupSchema, contextSchema, decisionSchema, employeeSchema, historySchema, migrateDecision, type Backup, type ConnectionSettings, type Decision, type Employee, type ProfileHistory, type TeamContext } from '../shared/model';

export class AppError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const now = () => new Date().toISOString();
export const id = () => randomUUID();
export const blankContext: TeamContext = { nickname: '', industry: '', persona: '', department: '', description: '' };

export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS employees (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS profile_history (id TEXT PRIMARY KEY, data TEXT NOT NULL);');
  }
  close() { this.db.close(); }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private list<T>(table: 'employees' | 'decisions' | 'profile_history'): T[] {
    return (this.db.prepare('SELECT data FROM ' + table).all() as { data: string }[]).map(r => JSON.parse(r.data));
  }
  private read<T>(table: 'employees' | 'decisions', itemId: string): T {
    const row = this.db.prepare('SELECT data FROM ' + table + ' WHERE id = ?').get(itemId) as { data: string } | undefined;
    if (!row) throw new AppError(404, '这条记录不存在，可能已被删除。');
    return JSON.parse(row.data);
  }
  private put(table: 'employees' | 'decisions' | 'profile_history', item: { id: string }) {
    this.db.prepare('INSERT INTO ' + table + ' (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(item.id, JSON.stringify(item));
  }
  setting<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT data FROM settings WHERE key = ?').get(key) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  saveSetting(key: string, value: unknown) { this.db.prepare('INSERT INTO settings (key,data) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').run(key, JSON.stringify(value)); }
  context() { return contextSchema.parse(this.setting<TeamContext>('context') ?? { ...blankContext }); }
  connection(): ConnectionSettings { return this.setting<ConnectionSettings>('connection') ?? { baseUrl: process.env.AI_BASE_URL || 'https://api.deepseek.com', model: process.env.AI_MODEL || 'deepseek-flash', apiKey: process.env.AI_API_KEY || '' }; }
  publicConnection() { const c = this.connection(); return { baseUrl: c.baseUrl, model: c.model, hasKey: Boolean(c.apiKey) }; }
  employees() { return this.list<unknown>('employees').map(e => employeeSchema.parse(e)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.alias.localeCompare(b.alias)); }
  employee(employeeId: string) { return employeeSchema.parse(this.read<unknown>('employees', employeeId)); }
  putEmployee(employee: Employee) { this.put('employees', employeeSchema.parse(employee)); }
  decisions() { return this.list<unknown>('decisions').map(d => decisionSchema.parse(migrateDecision(d))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  decision(decisionId: string) { return decisionSchema.parse(migrateDecision(this.read<unknown>('decisions', decisionId))); }
  putDecision(decision: Decision) { this.put('decisions', decisionSchema.parse(decision)); }
  completedRequest(requestId: string) {
    for (const decision of this.decisions()) {
      const analysis = decision.analyses.find(a => a.requestId === requestId);
      if (analysis) return { decision, operation: 'analysis', target: decision.id, fingerprint: analysis.fingerprint };
      const review = decision.reviews.find(r => r.requestId === requestId);
      if (review) return { decision, operation: 'review', target: review.id, fingerprint: review.fingerprint };
    }
    return null;
  }
  deleteDecision(decisionId: string) { this.decision(decisionId); this.db.prepare('DELETE FROM decisions WHERE id = ?').run(decisionId); }
  history(employeeId?: string) { return this.list<unknown>('profile_history').map(h => historySchema.parse(h)).filter(h => !employeeId || h.employeeId === employeeId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  addHistory(employee: Employee, description: string, source: ProfileHistory['source'], decisionId: string | null) {
    this.put('profile_history', { id: id(), employeeId: employee.id, previousDescription: employee.description, description, source, decisionId, createdAt: now() } as ProfileHistory);
  }
  nextAlias() {
    const used = new Set(this.employees().map(e => e.alias));
    for (let n = 1; n < 18279; n++) {
      let value = n, letters = '';
      while (value) { value--; letters = String.fromCharCode(65 + value % 26) + letters; value = Math.floor(value / 26); }
      if (!used.has('员工' + letters)) return '员工' + letters;
    }
    throw new AppError(400, '员工数量已达到上限。');
  }
  export(): Backup { return { format: 'zhujian-backup', version: 2, exportedAt: now(), context: this.context(), employees: this.employees(), decisions: this.decisions(), history: this.history() }; }
  validateBackup(input: unknown): Backup {
    const backup = backupSchema.parse(input);
    const assertUnique = (items: { id: string }[]) => { if (new Set(items.map(i => i.id)).size !== items.length) throw new AppError(400, '备份包含重复记录，未导入。'); };
    assertUnique(backup.employees); assertUnique(backup.decisions); assertUnique(backup.history);
    if (new Set(backup.employees.map(e => e.alias)).size !== backup.employees.length) throw new AppError(400, '备份包含重复员工代号。');
    const employees = new Set(backup.employees.map(e => e.id));
    const requestIds = new Set<string>();
    const checkRequest = (requestId: string | null) => {
      if (!requestId) return;
      if (requestIds.has(requestId)) throw new AppError(400, '备份中包含重复分析请求标识。');
      requestIds.add(requestId);
    };
    for (const d of backup.decisions) {
      assertUnique(d.analyses); assertUnique(d.finals); assertUnique(d.reviews);
      assertUnique(d.analyses.flatMap(a => a.profileCandidates)); assertUnique(d.reviews.flatMap(r => r.suggestions));
      if (d.employeeIds.some(e => !employees.has(e))) throw new AppError(400, '备份中存在缺失的员工引用。');
      if (new Set(d.employeeIds).size !== d.employeeIds.length) throw new AppError(400, '备份中存在重复的员工选择。');
      for (const analysis of d.analyses) {
        checkRequest(analysis.requestId); assertUnique(analysis.result.perspectives); assertUnique(analysis.profileCandidates);
        if (d.channel !== 'full' && analysis.snapshot.channel === 'full') throw new AppError(400, '备份中的决策通道与历史版本不一致。');
        if (analysis.snapshot.channel === 'full' && analysis.profileCandidates.length) throw new AppError(400, '只有快速分析可以包含临时画像。');
        if (analysis.snapshot.employees.some(e => !employees.has(e.id))) throw new AppError(400, '备份中的分析快照引用不完整。');
        for (const candidate of analysis.profileCandidates) {
          if (candidate.status === 'saved' ? !candidate.employeeId || !employees.has(candidate.employeeId) : candidate.employeeId !== null) throw new AppError(400, '备份中的候选画像状态或员工引用无效。');
        }
      }
      for (const final of d.finals) {
        const analysis = d.analyses.find(a => a.id === final.analysisId);
        if (final.analysisId && !analysis) throw new AppError(400, '备份中的方案引用不完整。');
        if (final.adoptedOptionId && !analysis?.result.perspectives.some(p => p.id === final.adoptedOptionId)) throw new AppError(400, '备份中采纳的角度引用不完整。');
        if (final.mode === 'maintain' && final.adoptedOptionId) throw new AppError(400, '备份中的拍板方式与采纳角度不一致。');
        if (final.snapshot.employees.some(e => !employees.has(e.id))) throw new AppError(400, '备份中的决定快照引用不完整。');
        if (final.snapshot.channel !== 'full' && final.followup.status !== 'none') throw new AppError(400, '快速分析记录不能包含回访安排。');
        if (d.channel !== 'full' && final.snapshot.channel === 'full') throw new AppError(400, '备份中的拍板版本通道不一致。');
        if (final.followup.status === 'pending' && !final.followup.dueAt) throw new AppError(400, '待回访记录缺少回访日期。');
        if (final.followup.status === 'none' && final.followup.dueAt) throw new AppError(400, '未安排回访的记录不能包含回访日期。');
      }
      for (const review of d.reviews) {
        checkRequest(review.requestId);
        if (review.requestId && (!review.fingerprint || review.summary === null)) throw new AppError(400, '备份中的复盘请求记录不完整。');
        if (!d.finals.some(f => f.id === review.finalId)) throw new AppError(400, '备份中的复盘引用不完整。');
        assertUnique(review.suggestions);
        if (review.suggestions.some(s => !employees.has(s.employeeId))) throw new AppError(400, '画像建议指向不存在的员工。');
      }
    }
    if (backup.history.some(h => !employees.has(h.employeeId))) throw new AppError(400, '画像历史引用不完整。');
    return backup;
  }
  restore(input: Backup) {
    const backup = this.validateBackup(input);
    this.transaction(() => {
      this.db.exec('DELETE FROM employees; DELETE FROM decisions; DELETE FROM profile_history;');
      this.saveSetting('context', backup.context);
      for (const employee of backup.employees) this.putEmployee(employee);
      for (const decision of backup.decisions) this.putDecision(decision);
      for (const history of backup.history) this.put('profile_history', history);
    });
  }
  clear() { this.transaction(() => { this.db.exec('DELETE FROM employees; DELETE FROM decisions; DELETE FROM profile_history;'); this.saveSetting('context', blankContext); }); }
}

