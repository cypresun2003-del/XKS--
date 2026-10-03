import { useState } from 'react';
import { Plus, ArrowUpRight, Archive, RotateCcw, UsersRound, History, ShieldCheck } from 'lucide-react';
import type { Employee, ProfileHistory } from '../shared/model';
import { hasContacts } from '../shared/model';
import type { PageProps } from './App';
import { api, dateText, errorText } from './api';
import { EmptyState, FormError, Modal, PrivacyNote, Spinner, TextArea } from './ui';

export default function Team({ data, refresh, notify }: PageProps) {
  const [showArchived, setShowArchived] = useState(false), [editor, setEditor] = useState<Employee | 'new' | null>(null), [nickname, setNickname] = useState(''), [role, setRole] = useState(''), [description, setDescription] = useState(''), [history, setHistory] = useState<ProfileHistory[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const employees = data.employees.filter(e => e.archived === showArchived);
  async function edit(employee: Employee | 'new') {
    setEditor(employee); setNickname(employee === 'new' ? '' : employee.nickname); setRole(employee === 'new' ? '' : employee.role); setDescription(employee === 'new' ? '' : employee.description); setError(''); setHistory([]);
    if (employee !== 'new') try { setHistory(await api<ProfileHistory[]>('/employees/' + employee.id + '/history')); } catch (e) { notify(errorText(e), true); }
  }
  async function save() {
    setBusy(true); setError('');
    try {
      if (editor === 'new') await api('/employees', 'POST', { nickname, role, description });
      else if (editor) await api('/employees/' + editor.id, 'PUT', { nickname, role, description, version: editor.version });
      await refresh(); setEditor(null); notify('你的观察已保存在本机。');
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function archive(employee: Employee) {
    setBusy(true);
    try { await api('/employees/' + employee.id + '/archive', 'POST', { archived: !employee.archived, version: employee.version }); await refresh(); setEditor(null); notify(employee.archived ? '员工已恢复到团队。' : '员工已归档，过去的决策记录仍然保留。'); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <div className="page team-page"><div className="page-heading"><div><h1>员工画像</h1><p className="page-description">记录员工特点，供分析时参考。一位员工、一条描述就能开始。</p></div><button className="primary" onClick={() => edit('new')}><Plus size={17} />添加员工</button></div>
    <div className="principle-note"><ShieldCheck size={17} /><p>昵称、职责和主观观察由你维护；AI 提出的画像调整建议，需经你确认才会更新。</p></div>
    <div className="filter-tabs" role="tablist" aria-label="员工状态"><button role="tab" aria-selected={!showArchived} className={!showArchived ? 'selected' : ''} onClick={() => setShowArchived(false)}>当前团队 <small>{data.employees.filter(e => !e.archived).length}</small></button><button role="tab" aria-selected={showArchived} className={showArchived ? 'selected' : ''} onClick={() => setShowArchived(true)}>已归档 <small>{data.employees.filter(e => e.archived).length}</small></button></div>
    {employees.length ? <div className="employee-grid">{employees.map((employee, index) => <button className="employee-card" key={employee.id} onClick={() => edit(employee)}><div className="employee-card-head"><span className={'employee-avatar avatar-' + index % 4}>{employee.alias.slice(2)}</span><div><h3>{employee.nickname || employee.alias}</h3><span>{employee.alias} · {employee.role || '未填写职责'}</span></div><ArrowUpRight size={18} /></div><p className="preserve-lines">{employee.description}</p><div className="employee-card-footer"><span>{dateText(employee.updatedAt)} 更新</span><span>第 {employee.version} 版</span></div></button>)}{!showArchived && <button className="add-employee-card" onClick={() => edit('new')}><Plus size={25} strokeWidth={1.3} /><span>添加员工</span><small>昵称、职责、一句话观察</small></button>}</div> : <EmptyState icon={<UsersRound size={29} strokeWidth={1.2} />} title={showArchived ? '还没有归档的员工' : '尚未添加员工'} action={!showArchived && <button className="secondary" onClick={() => edit('new')}><Plus size={15} />添加员工</button>}>{showArchived ? '归档后的画像不会用于新任务的默认选择，历史记录仍会保留。' : '添加员工昵称、职责，再写一句你对他的观察。'}</EmptyState>}
    <PrivacyNote />
    {editor && <Modal title={editor === 'new' ? '添加员工画像' : editor.alias + ' · 编辑画像'} onClose={() => setEditor(null)} busy={busy}>
      <p className="modal-intro">{editor === 'new' ? '使用昵称记录，系统同时生成员工代号。' : '修改后会保留之前的版本。'}</p>
      <label className="field"><span className="field-title">昵称</span><input autoFocus maxLength={80} placeholder="例如：小李" value={nickname} onChange={event => setNickname(event.target.value)} /></label>
      <label className="field"><span className="field-title">职责</span><input maxLength={120} placeholder="例如：负责产品研发" value={role} onChange={event => setRole(event.target.value)} /></label>
      <TextArea label="我目前对他的看法" rows={4} maxLength={3000} placeholder="例如：研发能力强，跨部门沟通时比较直接。" value={description} onValue={setDescription} hint="用一句或几句话，记录你的主观观察。" />
      <FormError message={error} /><div className="modal-actions"><button className="secondary" disabled={busy} onClick={() => setEditor(null)}>取消</button><button className="primary" disabled={busy || !nickname.trim() || !role.trim() || !description.trim() || hasContacts(nickname + role + description)} onClick={save}>{busy ? <Spinner label="保存中…" /> : '保存画像'}</button></div>
      {editor !== 'new' && <><details className="history-details"><summary><History size={15} />画像的变化记录 <span>{history.length}</span></summary>{history.length ? history.map(h => <div className="history-entry" key={h.id}><span>{dateText(h.createdAt, true)} · {h.source === 'review' ? '复盘后由你确认' : '你主动修改'}</span><p>{h.description}</p><details><summary>查看修改前</summary><p>{h.previousDescription}</p></details></div>) : <p className="muted">这是第一版观察，还没有修改记录。</p>}</details><div className="archive-row"><p>{editor.archived ? '恢复后，可以在新决策中选择这位员工。' : '暂时不再合作？归档后仍会保留历史。'}</p><button className="text-button" disabled={busy} onClick={() => archive(editor)}>{editor.archived ? <RotateCcw size={14} /> : <Archive size={14} />}{editor.archived ? '恢复员工' : '归档员工'}</button></div></>}
    </Modal>}
  </div>;
}

