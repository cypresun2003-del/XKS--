import { useRef, useState } from 'react';
import { Download, Upload, Trash2, Palette } from 'lucide-react';
import type { PageProps } from './App';
import { api, dateText, errorText } from './api';
import { FormError, Modal, Spinner } from './ui';
import { feedbackEmail, feedbackHref, SupportLink } from './Support';

type BackupCounts = { employees: number; groups: number; decisions: number; exportedAt: string };
export default function Settings({ refresh, notify, theme, setTheme }: PageProps) {
  const [busy, setBusy] = useState('');
  const [restore, setRestore] = useState<{ backup: unknown; counts: BackupCounts } | null>(null), [clear, setClear] = useState(false), [confirmation, setConfirmation] = useState(''), [modalError, setModalError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  async function readBackup(file: File) {
    setBusy('backup');
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error('备份文件不能超过 15 MB。');
      let backup: unknown; try { backup = JSON.parse(await file.text()); } catch { throw new Error('这不是有效的 JSON 备份文件。'); }
      const counts = await api<BackupCounts>('/backup/validate', 'POST', backup);
      setRestore({ backup, counts }); setConfirmation(''); setModalError('');
    } catch (e) { notify(errorText(e), true); } finally { setBusy(''); if (fileRef.current) fileRef.current.value = ''; }
  }
  async function destructiveAction() {
    setBusy('data'); setModalError('');
    try {
      if (restore) await api('/backup/restore', 'POST', restore.backup, { 'X-Confirm-Restore': 'replace' });
      else await api('/data', 'DELETE', undefined, { 'X-Confirm-Clear': 'clear-local-data' });
      const restored = Boolean(restore);
      setRestore(null); setClear(false);
      notify(restored ? '备份已完整恢复。' : '本机业务记录已清空。');
      try { await refresh(); } catch { /* Operation succeeded; App exposes a read-only retry. */ }
    } catch (e) { setModalError(errorText(e)); } finally { setBusy(''); }
  }
  return <div className="page settings-page simple-settings">
    <section className="settings-row appearance-card"><div className="settings-row-title"><Palette size={20} /><div><h2>外观</h2><p>选择你喜欢的界面配色。</p></div></div><div className="theme-options" role="group" aria-label="界面配色"><button className={theme === 'graphite' ? 'selected' : ''} aria-pressed={theme === 'graphite'} onClick={() => setTheme('graphite')}><i className="theme-swatch theme-swatch-graphite" /><span>石墨银灰</span></button><button className={theme === 'blue' ? 'selected' : ''} aria-pressed={theme === 'blue'} onClick={() => setTheme('blue')}><i className="theme-swatch theme-swatch-blue" /><span>蓝白</span></button></div></section>
    <section className="settings-row"><div className="settings-row-title"><Download size={20} /><div><h2>备份与恢复</h2><p>包含员工、分组、决策和复盘。恢复将替换当前资料。</p></div></div><div className="settings-row-actions"><a href="/api/backup" className="secondary" download><Download size={15} />导出备份</a><button className="secondary" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}><Upload size={15} />导入备份</button><input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e => { if (e.target.files?.[0]) readBackup(e.target.files[0]); }} /></div></section>
    <section className="settings-row clear-data-row"><div className="settings-row-title"><Trash2 size={20} /><div><h2>清空本机业务记录</h2><p>清空你的资料及历史记录，操作前需要再次确认。</p></div></div><button className="danger-text" disabled={Boolean(busy)} onClick={() => { setClear(true); setConfirmation(''); setModalError(''); }}>清空记录</button></section>
    <footer className="settings-footnotes"><p><strong>反馈与改进</strong> 有意见或遇到问题，欢迎发邮件至 <a href={feedbackHref}>{feedbackEmail}</a>。<SupportLink>写邮件</SupportLink></p><p><strong>隐私与数据边界</strong> 资料保存在本机；点击分析后，分析所需内容才会发送至模型服务，云端留存遵循服务商政策。请使用昵称和代号，并妥善保管备份。</p></footer>
    {(restore || clear) && <Modal title={restore ? '确认恢复这份备份？' : '确认清空本机记录？'} onClose={() => { setRestore(null); setClear(false); }} busy={Boolean(busy)}>{restore ? <p className="modal-intro">这份备份来自 {dateText(restore.counts.exportedAt, true)}，包含 {restore.counts.employees} 位员工、{restore.counts.groups || 0} 个分组和 {restore.counts.decisions} 条决策。恢复后将替换当前业务资料。</p> : <p className="modal-intro">用户信息、员工、分组、决策及复盘历史将从本机删除。建议先导出备份，删除后无法在应用中撤销。</p>}<a className="text-button" href="/api/backup" download><Download size={14} />先导出当前记录</a><label className="field"><span className="field-title">请输入“{restore ? '恢复备份' : '清空本机记录'}”确认</span><input value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label><FormError message={modalError} /><div className="modal-actions"><button className="secondary" disabled={Boolean(busy)} onClick={() => { setRestore(null); setClear(false); }}>取消</button><button className="danger-button" disabled={Boolean(busy) || confirmation !== (restore ? '恢复备份' : '清空本机记录')} onClick={destructiveAction}>{busy === 'data' ? <Spinner label="正在处理…" /> : restore ? '确认恢复' : '确认清空'}</button></div></Modal>}
  </div>;
}
