import { useState } from 'react';
import { FolderPlus, PencilLine, Trash2 } from 'lucide-react';
import type { EmployeeGroup } from '../shared/model';
import type { PageProps } from './App';
import { api, errorText } from './api';
import { FormError, Modal, Spinner } from './ui';
import EmployeeSelection from './EmployeeSelection';

export default function Groups({ data, refresh, notify }: PageProps) {
  const [editor, setEditor] = useState<EmployeeGroup | 'new' | null>(null), [deleting, setDeleting] = useState<EmployeeGroup | null>(null);
  const [name, setName] = useState(''), [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const groups = data.groups || [];
  function open(group: EmployeeGroup | 'new') {
    setName(group === 'new' ? '' : group.name); setSelected(group === 'new' ? [] : group.employeeIds); setError(''); setEditor(group);
  }
  async function save() {
    if (!editor) return;
    setBusy(true); setError('');
    try {
      await api('/employee-groups' + (editor === 'new' ? '' : '/' + editor.id), editor === 'new' ? 'POST' : 'PUT', { name, employeeIds: selected, ...(editor === 'new' ? {} : { version: editor.version }) });
      setEditor(null); notify('分组已保存。');
      try { await refresh(); } catch { /* App provides a refresh retry; do not repeat the write. */ }
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function remove() {
    if (!deleting) return;
    setBusy(true); setError('');
    try {
      await api('/employee-groups/' + deleting.id, 'DELETE', undefined, { 'X-Group-Version': String(deleting.version) });
      setDeleting(null); notify('分组已删除，员工画像和决策记录仍保留。');
      try { await refresh(); } catch { /* Read-only retry remains available. */ }
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <section className="groups-section" aria-label="员工分组">
    <div className="groups-heading"><h2>分组 <small>{groups.length}</small></h2><button className="secondary" onClick={() => open('new')}><FolderPlus size={15} />新建分组</button></div>
    {groups.length ? <div className="group-list">{groups.map(group => {
      const members = data.employees.filter(e => group.employeeIds.includes(e.id) && !e.archived);
      return <div className="group-row" key={group.id}><div><strong>{group.name}</strong><small>{members.length} 位当前员工{members.length ? ' · ' + members.map(e => e.nickname || e.alias).join('、') : ' · 暂无可关联员工'}</small></div><button className="icon-button" aria-label={'编辑分组：' + group.name} onClick={() => open(group)}><PencilLine size={16} /></button><button className="icon-button" aria-label={'删除分组：' + group.name} onClick={() => { setDeleting(group); setError(''); }}><Trash2 size={16} /></button></div>;
    })}</div> : <p className="muted">把常用的几位员工放在一起，下次可以一键关联。</p>}
    {editor && <Modal title={editor === 'new' ? '新建员工分组' : '编辑员工分组'} onClose={() => setEditor(null)} busy={busy}>
      <label className="field"><span className="field-title">分组名称</span><input autoFocus maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder="例如：学校项目组" /></label>
      <div className="group-member-picker"><EmployeeSelection employees={data.employees} selected={selected} onChange={setSelected} limit={10000} /></div>
      {selected.some(id => data.employees.find(e => e.id === id)?.archived) && <p className="field-hint">已归档成员保留在分组中，但不会用于新的关联。<button className="text-button" onClick={() => setSelected(ids => ids.filter(id => !data.employees.find(e => e.id === id)?.archived))}>移出已归档成员</button></p>}
      <FormError message={error} /><div className="modal-actions"><button className="secondary" disabled={busy} onClick={() => setEditor(null)}>取消</button><button className="primary" disabled={busy || !name.trim()} onClick={save}>{busy ? <Spinner label="保存中…" /> : '保存分组'}</button></div>
    </Modal>}
    {deleting && <Modal title="删除这个分组？" onClose={() => setDeleting(null)} busy={busy}><p>将删除“{deleting.name}”分组，员工画像和已有决策记录都会保留。</p><FormError message={error} /><div className="modal-actions"><button className="secondary" disabled={busy} onClick={() => setDeleting(null)}>取消</button><button className="danger-button" disabled={busy} onClick={remove}>{busy ? <Spinner label="删除中…" /> : '确认删除分组'}</button></div></Modal>}
  </section>;
}
