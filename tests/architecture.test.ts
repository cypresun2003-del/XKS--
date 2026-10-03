import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { createApp } from '../server/app';
import { CloudAI, type Fetcher } from '../server/ai';
import { Store } from '../server/store';
import type { Decision, DecisionChannel, Employee } from '../shared/model';

type ModelRequest = { messages: { role: string; content: string }[]; [key: string]: unknown };
type CapturedRequest = { body: ModelRequest; payload: Record<string, any>; kind: 'options' | 'risk' | 'review' };
const angle = (angleType = '流程规则', title = '明确协作边界') => ({ angleType, title, plan: '先明确各自负责的范围和协调方式。', basis: '根据用户提供的情况，分工仍有待明确。', risks: '规则过细可能增加沟通成本。', questions: '参与者是否认可这次分工？' });
const options = (count = 3) => ({ perspectives: [angle(), angle('暂不动作', '先观察再调整'), angle('资源投入', '补充协调资源')].slice(0, count), unknowns: ['尚未提供可投入的时间。'], profileCandidates: [] as { alias: string; description: string; evidence: string }[] });
const success = (value: unknown) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }), { headers: { 'Content-Type': 'application/json' } });
const defaultResponder = async (call: CapturedRequest) => success(call.kind === 'risk' ? { riskSummary: '初判需要补充谁来协调出现的分歧。' } : call.kind === 'review' ? { summary: '依据本次结果继续观察。', suggestions: [] } : options());

async function fixture() {
  const store = new Store(':memory:');
  const calls: CapturedRequest[] = [];
  let responder = defaultResponder;
  const ai = new CloudAI((async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as ModelRequest;
    const system = body.messages[0].content;
    const call: CapturedRequest = { body, payload: JSON.parse(body.messages[1].content), kind: system.includes('复盘参谋') ? 'review' : system.includes('本次唯一任务') ? 'risk' : 'options' };
    calls.push(call);
    return responder(call);
  }) as Fetcher);
  store.saveSetting('connection', { baseUrl: 'https://model.example.test/v1', model: 'test-model', apiKey: 'fixture-secret' });
  const server: Server = await new Promise(resolve => { const server = createApp(store, ai).listen(0, '127.0.0.1', () => resolve(server)); });
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port + '/api';
  const request = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Zhujian-Client': 'local' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, value: await response.json() as any };
  };
  return {
    store, calls, request, setResponder: (next: typeof responder) => { responder = next; },
    async employee(description = '研发经验较多，协作情况仍需观察。') {
      const result = await request('/employees', 'POST', { description });
      assert.equal(result.status, 201); return result.value as Employee;
    },
    async decision(channel: DecisionChannel, overrides: Record<string, unknown> = {}) {
      const result = await request('/decisions', 'POST', { channel, title: '跨部门协作安排', problem: '项目即将启动，怎样安排团队分工？', temporaryContext: channel === 'quick' ? '我负责一个小团队，目前需要协调研发与交付。' : '', initialPlan: '', ...overrides });
      assert.equal(result.status, 201, result.value.error); return result.value as Decision;
    },
    async analyze(decision: Decision, requestId = randomUUID()) {
      const preview = await request('/decisions/' + decision.id + '/analysis-preview');
      assert.equal(preview.status, 200, preview.value.error);
      const body = { fingerprint: preview.value.fingerprint, revision: decision.revision, consent: true, requestId };
      const result = await request('/decisions/' + decision.id + '/analyze', 'POST', body);
      return { ...result, body, preview: preview.value };
    },
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); },
  };
}

test('快速分析无初判只调用独立方案；改变初判不改变独立请求，风险检查单独发送', async () => {
  const f = await fixture();
  try {
    const decision = await f.decision('quick');
    const first = await f.analyze(decision);
    assert.equal(first.status, 200);
    assert.equal(f.calls.length, 1);
    assert.equal(first.value.analyses[0].result.riskSummary, null);
    assert.equal(first.value.analyses[0].sentPayload.risk, null);
    const independentWithoutPlan = structuredClone(f.calls[0].body);
    const sentinel = '仅风险调用可见_SENTINEL_我准备让员工A独自承担全部工作_仅此初判包含';
    const edited = await f.request('/decisions/' + decision.id, 'PUT', { ...first.value, title: sentinel, initialPlan: sentinel });
    assert.equal(edited.status, 200);
    const second = await f.analyze(edited.value);
    assert.equal(second.status, 200);
    assert.equal(f.calls.length, 3);
    const independentWithPlan = f.calls.slice(1).find(c => c.kind === 'options')!;
    const risk = f.calls.slice(1).find(c => c.kind === 'risk')!;
    assert.deepEqual(independentWithPlan.body, independentWithoutPlan, '独立调用不能获得初判、字数、摘要，或含有初判的标题');
    assert(!JSON.stringify(independentWithPlan.body).includes(sentinel));
    assert.equal(risk.payload.我的初步打算, sentinel);
    assert.deepEqual(risk.body.messages.map(m => m.role), ['system', 'user']);
    assert.deepEqual(independentWithPlan.body.messages.map(m => m.role), ['system', 'user']);
    assert.notEqual(risk.body.messages[0].content, independentWithPlan.body.messages[0].content);
    assert(!JSON.stringify(risk.payload).includes('明确协作边界'), '风险调用不能混入另一调用生成的方案');
    assert.deepEqual(second.value.analyses[1].sentPayload, second.preview.payload);
    assert.equal(second.value.analyses[1].result.qualityFlags.degraded, false);
    assert.equal(f.store.employees().length, 0);
  } finally { await f.close(); }
});

test('快速分析仅使用本次情况并给出三个角度，不能读取员工档案、直接拍板或复盘', async () => {
  const f = await fixture();
  try {
    const employeeA = await f.employee('员工A专用描述：负责技术交付。');
    const employeeB = await f.employee('员工B专用描述：负责客户沟通。');
    assert.equal((await f.request('/context', 'PUT', { industry: '仅全局可见行业_SENTINEL', department: '仅全局可见部门_SENTINEL', description: '全局团队背景不用于快速分析_SENTINEL' })).status, 200);
    const decision = await f.decision('quick', { initialPlan: '无' });
    assert.deepEqual(decision.employeeIds, []);
    await f.employee('创建快速分析之后才添加的员工。');
    const edited = await f.request('/decisions/' + decision.id, 'PUT', { ...decision, employeeIds: [employeeA.id] });
    assert.equal(edited.status, 400, '绑定档案前应升级为深度决策');
    const result = await f.analyze(decision);
    assert.equal(result.status, 200); assert.equal(f.calls.length, 1);
    assert.equal(result.value.analyses[0].result.perspectives.length, 3);
    assert.equal(new Set(result.value.analyses[0].result.perspectives.map((p: any) => p.angleType)).size, 3);
    assert.equal(result.value.analyses[0].result.riskSummary, null);
    assert.deepEqual(result.value.employeeIds, []);
    assert.deepEqual(result.value.analyses[0].snapshot.employees, []);
    assert.deepEqual(result.value.analyses[0].snapshot.context, { nickname: '', industry: '', persona: '', department: '', description: '' });
    assert(!JSON.stringify(f.calls[0].body).includes('SENTINEL'), '快速分析只发送本次情况，不暗带全局背景');
    assert(!JSON.stringify(f.calls[0].body).includes(employeeA.description));
    assert(!JSON.stringify(f.calls[0].body).includes(employeeB.description));
    const final = await f.request('/decisions/' + decision.id + '/finals', 'POST', { mode: 'adopt', text: '先明确分工边界。', analysisId: result.value.analyses[0].id, adoptedOptionId: result.value.analyses[0].result.perspectives[0].id, revision: result.value.revision });
    assert.equal(final.status, 400);
    assert.equal(f.store.decision(decision.id).finals.length, 0);
    assert.equal((await f.request('/decisions/' + decision.id + '/reviews', 'POST', { resultStatus: 'smooth', revision: result.value.revision })).status, 400);
    const missingContext = await f.decision('quick', { temporaryContext: '' });
    assert.equal((await f.request('/decisions/' + missingContext.id + '/analysis-preview')).status, 400);
    assert.equal((await f.request('/decisions/' + missingContext.id + '/analyze', 'POST', { fingerprint: 'missing-context', revision: missingContext.revision, consent: true, requestId: randomUUID() })).status, 400);
    const missingProblem = await f.decision('quick', { problem: '' });
    assert.equal((await f.request('/decisions/' + missingProblem.id + '/analysis-preview')).status, 400);
    assert.equal(f.calls.length, 1);
    assert.equal((await f.request('/decisions', 'POST', { channel: 'trial', problem: '旧入口不能再创建记录。', temporaryContext: '已有背景。' })).status, 400);
    assert.equal((await f.request('/decisions', 'POST', { channel: 'quick', problem: '需要协作建议。', temporaryContext: '我负责研发。', employeeIds: [employeeA.id] })).status, 400);
  } finally { await f.close(); }
});

test('深度决策允许不关联员工，但必须有有效初判并阻止降级绕过校验', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('/context', 'PUT', { nickname: '大叉叉', industry: '机器人行业', persona: '负责机器人在学校的销售' })).status, 200);
    const noProfile = await f.decision('full', { initialPlan: '先与员工明确交付责任。' });
    const withoutProfile = await f.analyze(noProfile);
    assert.equal(withoutProfile.status, 200);
    assert.deepEqual(withoutProfile.value.analyses[0].snapshot.employees, []);
    assert.equal(withoutProfile.value.analyses[0].result.perspectives.length, 3);
    const independent = f.calls.find(call => call.kind === 'options')!;
    const risk = f.calls.find(call => call.kind === 'risk')!;
    assert.deepEqual(independent.payload.用户画像, { 称呼: '大叉叉', 行业: '机器人行业', 日常决策介绍: '负责机器人在学校的销售' });
    assert(!JSON.stringify(independent.payload).includes('先与员工明确交付责任。'));
    assert.equal(risk.payload.我的初步打算, '先与员工明确交付责任。');
    for (const initialPlan of ['', '   ', '无', '没有', '还没想好']) {
      const decision = await f.decision('full', { employeeIds: [], initialPlan });
      assert.equal((await f.request('/decisions/' + decision.id + '/analysis-preview')).status, 400);
      assert.equal((await f.request('/decisions/' + decision.id + '/analyze', 'POST', { fingerprint: 'not-used', revision: decision.revision, consent: true, requestId: randomUUID() })).status, 400);
      assert.equal((await f.request('/decisions/' + decision.id, 'PUT', { ...decision, channel: 'quick', temporaryContext: '试图修改模式。', employeeIds: [] })).status, 400);
      assert.equal(f.store.decision(decision.id).channel, 'full');
    }
    assert.equal(f.calls.length, 2);
  } finally { await f.close(); }
});

test('重复角度只重试一次；仍重复如实标记，重试改善后清除降级标记', async () => {
  const f = await fixture();
  try {
    f.setResponder(async () => success({ ...options(), perspectives: [angle(), angle('流程规则', '另一种措辞'), angle('流程规则', '仍是流程规则')] }));
    const decision = await f.decision('quick');
    const result = await f.analyze(decision);
    assert.equal(result.status, 200); assert.equal(f.calls.length, 2);
    assert.deepEqual(result.value.analyses[0].result.qualityFlags, { angleTypesDuplicated: true, degraded: true });
    assert.equal(new Set(result.value.analyses[0].result.perspectives.map((p: any) => p.angleType)).size, 1);
    assert.deepEqual(f.calls[0].payload, f.calls[1].payload);
    let attempt = 0;
    f.setResponder(async () => { attempt++; return success(attempt === 1 ? { ...options(), perspectives: [angle(), angle('流程规则', '仍然同角度'), angle('流程规则', '依然相同')] } : options()); });
    const improved = await f.analyze(await f.decision('quick'));
    assert.equal(improved.status, 200); assert.equal(attempt, 2); assert.equal(f.calls.length, 4);
    assert.deepEqual(improved.value.analyses[0].result.qualityFlags, { angleTypesDuplicated: false, degraded: false });
    assert(improved.value.analyses[0].result.perspectives.some((p: any) => p.angleType === '暂不动作'));
    for (const count of [1, 2]) {
      f.setResponder(async () => success(options(count)));
      const tooFew = await f.decision('quick');
      const failed = await f.analyze(tooFew);
      assert.equal(failed.status, 502, '快速分析必须恰好提供三个角度');
      assert.equal(f.store.decision(tooFew.id).analyses.length, 0);
    }
    f.setResponder(async call => call.kind === 'options' ? success(options(2)) : defaultResponder(call));
    const employee = await f.employee();
    const full = await f.decision('full', { employeeIds: [employee.id], initialPlan: '先明确交付责任。' });
    assert.equal((await f.analyze(full)).status, 502, '深度决策同样必须恰好提供三个角度');
    assert.equal(f.store.decision(full.id).analyses.length, 0);
  } finally { await f.close(); }
});

test('风险检查单独失败时保留独立方案并记录失败，绝不伪造风险内容', async () => {
  const f = await fixture();
  try {
    f.setResponder(async call => call.kind === 'risk' ? new Response('{}', { status: 401 }) : defaultResponder(call));
    const result = await f.analyze(await f.decision('quick', { initialPlan: '我打算先调整协作边界。' }));
    assert.equal(result.status, 200); assert.equal(f.calls.length, 2);
    const analysis = result.value.analyses[0];
    assert.equal(analysis.result.perspectives.length, 3);
    assert.equal(analysis.result.riskSummary, null);
    assert.match(analysis.result.riskError, /联系支持/);
    assert.equal(analysis.result.qualityFlags.degraded, true);
    assert.equal(analysis.result.qualityFlags.angleTypesDuplicated, false);
    assert.equal(f.store.decision(result.value.id).analyses.length, 1);
  } finally { await f.close(); }
});

test('快速分析候选画像须有原文依据，确认才新增；升级保留历史并重新生成深度分析', async () => {
  const f = await fixture();
  try {
    const existing = await f.employee('已有的主观画像，不能被本次临时信息覆盖。');
    const temporaryContext = '我负责研发。员工A研发能力强，但协作经验尚不清楚。';
    let candidateEvidence = '员工A销售能力很强';
    f.setResponder(async call => call.kind === 'options' && call.payload.可提取临时画像 ? success({ ...options(), profileCandidates: [{ alias: '员工A', description: '研发能力强，协作经验尚不清楚。', evidence: candidateEvidence }] }) : defaultResponder(call));
    const decision = await f.decision('quick', { temporaryContext });
    const bad = await f.analyze(decision);
    assert.equal(bad.status, 502); assert.equal(f.store.decision(decision.id).analyses.length, 0); assert.equal(f.store.employees().length, 1);
    candidateEvidence = '员工A研发能力强，但协作经验尚不清楚';
    const analyzed = await f.analyze(decision);
    assert.equal(analyzed.status, 200); assert.equal(f.store.employees().length, 1);
    const candidate = analyzed.value.analyses[0].profileCandidates[0];
    assert.equal(candidate.status, 'pending'); assert.equal(candidate.employeeId, null);
    assert.equal((await f.request('/decisions/' + decision.id + '/finals', 'POST', { mode: 'adopt', text: '先澄清责任。', analysisId: analyzed.value.analyses[0].id, revision: analyzed.value.revision })).status, 400);
    const saved = await f.request('/decisions/' + decision.id + '/candidates/' + candidate.id + '/resolve', 'POST', { action: 'save', revision: analyzed.value.revision });
    assert.equal(saved.status, 200); assert.equal(f.store.employees().length, 2);
    assert.deepEqual(f.store.employee(existing.id), existing);
    const newId = saved.value.analyses[0].profileCandidates[0].employeeId;
    assert.notEqual(newId, existing.id); assert.equal(f.store.employee(newId).alias, '员工B');
    assert.equal((await f.request('/decisions/' + decision.id + '/candidates/' + candidate.id + '/resolve', 'POST', { action: 'save', revision: saved.value.revision })).status, 409);
    assert.equal(f.store.employees().length, 2);
    const previousAnalysis = structuredClone(saved.value.analyses[0]);
    const legacyTrial: any = structuredClone(f.store.export());
    legacyTrial.decisions[0].channel = 'trial';
    legacyTrial.decisions[0].analyses[0].snapshot.channel = 'trial';
    const migratedTrial = f.store.validateBackup(legacyTrial).decisions[0];
    assert.equal(migratedTrial.channel, 'quick');
    assert.equal(migratedTrial.analyses[0].snapshot.channel, 'trial', '旧分析快照必须保留历史模式');
    assert.equal(migratedTrial.analyses[0].profileCandidates[0].employeeId, newId);
    const upgraded = await f.request('/decisions/' + decision.id + '/upgrade', 'POST', { employeeIds: [newId], initialPlan: '先由这位员工负责研发，再明确协调方式。', revision: saved.value.revision });
    assert.equal(upgraded.status, 200); assert.equal(upgraded.value.channel, 'full'); assert.equal(upgraded.value.status, 'draft');
    assert.deepEqual(upgraded.value.analyses[0], previousAnalysis);
    const fresh = await f.analyze(upgraded.value);
    assert.equal(fresh.status, 200); assert.equal(fresh.value.analyses.length, 2);
    assert.deepEqual(fresh.value.analyses[0], previousAnalysis);
    assert.equal(fresh.value.analyses[1].snapshot.channel, 'full');
    assert.equal(fresh.value.analyses[1].result.perspectives.length, 3);
    assert.equal(fresh.value.analyses[1].snapshot.employees[0].id, newId);
    assert.notEqual(fresh.value.analyses[1].id, previousAnalysis.id);
  } finally { await f.close(); }
});

test('相同请求标识可用旧版本号重放完成结果，内容冲突不再次调用模型', async () => {
  const f = await fixture();
  try {
    const decision = await f.decision('quick');
    const result = await f.analyze(decision);
    assert.equal(result.status, 200); assert.equal(f.calls.length, 1);
    assert.notEqual(result.value.revision, result.body.revision);
    const replay = await f.request('/decisions/' + decision.id + '/analyze', 'POST', result.body);
    assert.equal(replay.status, 200); assert.equal(f.calls.length, 1);
    assert.equal(replay.value.analyses.length, 1);
    assert.equal(replay.value.analyses[0].id, result.value.analyses[0].id);
    const conflict = await f.request('/decisions/' + decision.id + '/analyze', 'POST', { ...result.body, fingerprint: 'different-content' });
    assert.equal(conflict.status, 409); assert.equal(f.calls.length, 1);
    const another = await f.decision('quick');
    const otherPreview = await f.request('/decisions/' + another.id + '/analysis-preview');
    const reusedElsewhere = await f.request('/decisions/' + another.id + '/analyze', 'POST', { ...result.body, fingerprint: otherPreview.value.fingerprint, revision: another.revision });
    assert.equal(reusedElsewhere.status, 409); assert.equal(f.calls.length, 1);
    assert.equal(f.store.decision(another.id).analyses.length, 0);
  } finally { await f.close(); }
});

test('深度决策回访默认30天、未出结果延后14天、完成后关闭；旧档案迁移不补造事实', async () => {
  const f = await fixture();
  try {
    const employee = await f.employee();
    const decision = await f.decision('full', { employeeIds: [employee.id], initialPlan: '我先明确职责和分歧协调人。' });
    const analyzed = await f.analyze(decision);
    assert.equal(analyzed.status, 200);
    let result = await f.request('/decisions/' + decision.id + '/finals', 'POST', { mode: 'maintain', text: decision.initialPlan, analysisId: analyzed.value.analyses[0].id, revision: analyzed.value.revision });
    assert.equal(result.status, 200);
    const followup = result.value.finals[0].followup;
    assert.equal(followup.status, 'pending');
    assert(Math.abs(Date.parse(followup.dueAt) - Date.now() - 30 * 86400000) < 5000);
    result = await f.request('/decisions/' + decision.id + '/reviews', 'POST', { resultStatus: 'pending', surprise: '进度推迟，还无法判断。', hindsight: '继续观察。', revision: result.value.revision });
    assert.equal(result.status, 200); assert.equal(result.value.status, 'decided');
    assert.equal(result.value.reviews[0].resultStatus, 'pending');
    assert.equal(result.value.finals[0].followup.status, 'pending');
    assert(Math.abs(Date.parse(result.value.finals[0].followup.dueAt) - Date.now() - 14 * 86400000) < 5000);
    const callsBeforePendingReview = f.calls.length;
    const pendingReviewPath = '/decisions/' + decision.id + '/reviews/' + result.value.reviews[0].id;
    assert.equal((await f.request(pendingReviewPath + '/preview')).status, 400);
    assert.equal((await f.request(pendingReviewPath + '/analyze', 'POST', { fingerprint: 'no-result-yet', revision: result.value.revision, requestId: randomUUID(), consent: true })).status, 400);
    assert.equal(f.calls.length, callsBeforePendingReview, '没有实际结果时不得调用模型推断画像');
    result = await f.request('/decisions/' + decision.id + '/reviews', 'POST', { resultStatus: 'smooth', surprise: '没有新的意外。', hindsight: '明确协调人有帮助。', satisfaction: 4, revision: result.value.revision });
    assert.equal(result.status, 200); assert.equal(result.value.status, 'reviewed');
    assert.equal(result.value.finals[0].followup.status, 'done'); assert.equal(result.value.reviews.length, 2);
    assert.equal(result.value.reviews[1].hindsight, '明确协调人有帮助。');
    assert.deepEqual(f.store.employee(employee.id), employee, '记录回访不得自动修改画像');

    const legacy: any = structuredClone(f.store.export()); legacy.version = 1;
    for (const d of legacy.decisions) {
      delete d.channel; delete d.temporaryContext;
      for (const a of d.analyses) {
        delete a.requestId; delete a.sentPayload; delete a.profileCandidates; delete a.snapshot.channel; delete a.snapshot.temporaryContext;
        delete a.result.qualityFlags; delete a.result.riskError;
        for (const p of a.result.perspectives) { delete p.id; delete p.angleType; }
      }
      for (const final of d.finals) { delete final.adoptedOptionId; delete final.followup; delete final.snapshot.channel; delete final.snapshot.temporaryContext; }
      for (const review of d.reviews) { delete review.resultStatus; delete review.surprise; delete review.hindsight; delete review.requestId; delete review.fingerprint; }
    }
    const migrated = f.store.validateBackup(legacy).decisions[0];
    assert.equal(migrated.channel, 'full');
    assert.equal(migrated.analyses[0].result.perspectives[0].angleType, null);
    assert.equal(migrated.analyses[0].sentPayload, null);
    assert.equal(migrated.reviews[0].resultStatus, null);
    assert.equal(migrated.reviews[0].outcome, result.value.reviews[0].outcome);
    assert.deepEqual(migrated.finals[0].followup, { dueAt: null, status: 'none' });
  } finally { await f.close(); }
});
