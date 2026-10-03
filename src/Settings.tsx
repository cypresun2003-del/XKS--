import { useRef, useState } from 'react';
import { PlugZap, ShieldCheck, Download, Upload, Trash2, Check, LockKeyhole, ExternalLink, Palette, MessageSquareText } from 'lucide-react';
import type { PageProps } from './App';
import { api, dateText, errorText } from './api';
import { FormError, Modal, PrivacyNote, Spinner, TextArea } from './ui';

export default function Settings({ data, refresh, notify, theme, setTheme }: PageProps) {
  const [baseUrl, setBaseUrl] = useState(data.connection.baseUrl), [model, setModel] = useState(data.connection.model), [key, setKey] = useState(''), [busy, setBusy] = useState(''), [connectionError, setConnectionError] = useState('');
  const [feedback, setFeedback] = useState(''), [feedbackNotes, setFeedbackNotes] = useState<{ text: string; createdAt: string }[]>(() => { try { return JSON.parse(localStorage.getItem('second-perspective-feedback') || '[]'); } catch { return []; } });
  const [restore, setRestore] = useState<{ backup: unknown; counts: { employees: number; decisions: number; exportedAt: string } } | null>(null), [clear, setClear] = useState(false), [confirmation, setConfirmation] = useState(''), [modalError, setModalError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  function saveFeedback() {
    const note = feedback.trim(); if (!note) return;
    const next = [{ text: note, createdAt: new Date().toISOString() }, ...feedbackNotes].slice(0, 50);
    setFeedbackNotes(next); setFeedback('');
    try { localStorage.setItem('second-perspective-feedback', JSON.stringify(next)); notify('反馈已保存在本机。'); }
    catch { notify('这台电脑暂时无法保存反馈。', true); }
  }
  async function saveConnection(test = false, clearKey = false) {
    setBusy(test ? 'test' : 'connection'); setConnectionError('');
    try {
      await api('/settings/connection', 'PUT', { baseUrl, model, ...(key ? { apiKey: key } : {}), ...(clearKey ? { clearKey: true } : {}) }); setKey(''); await refresh();
      if (test) { const result = await api<{ message: string }>('/settings/connection/test', 'POST', {}); notify(result.message); }
      else notify(clearKey ? 'AI 密钥已从本机配置移除。' : 'AI 配置已保存，尚未进行连接测试。');
    } catch (e) { setConnectionError(errorText(e)); } finally { setBusy(''); }
  }
  async function readBackup(file: File) {
    setBusy('backup');
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error('备份文件不能超过 15 MB。');
      let backup: unknown; try { backup = JSON.parse(await file.text()); } catch { throw new Error('这不是有效的 JSON 备份文件。'); }
      const counts = await api<{ employees: number; decisions: number; exportedAt: string }>('/backup/validate', 'POST', backup);
      setRestore({ backup, counts }); setConfirmation(''); setModalError('');
    } catch (e) { notify(errorText(e), true); } finally { setBusy(''); if (fileRef.current) fileRef.current.value = ''; }
  }
  async function destructiveAction() {
    setBusy('data'); setModalError('');
    try {
      if (restore) await api('/backup/restore', 'POST', restore.backup, { 'X-Confirm-Restore': 'replace' });
      else await api('/data', 'DELETE', undefined, { 'X-Confirm-Clear': 'clear-local-data' });
      await refresh(); setRestore(null); setClear(false); notify(restore ? '备份已完整恢复。' : '本机业务记录已清空，模型连接设置仍保留。');
    } catch (e) { setModalError(errorText(e)); } finally { setBusy(''); }
  }
  return <div className="page settings-page"><div className="page-heading"><div><h1>设置</h1><p className="page-description">外观、AI 连接和反馈。</p></div></div>
    <section className="settings-card appearance-card"><header><span className="section-icon"><Palette size={20} /></span><div><h2>外观</h2><p>切换两种界面配色。</p></div></header><div className="theme-options" role="group" aria-label="界面配色"><button className={theme === 'graphite' ? 'selected' : ''} aria-pressed={theme === 'graphite'} onClick={() => setTheme('graphite')}><i className="theme-swatch theme-swatch-graphite" /><span>石墨银灰</span></button><button className={theme === 'blue' ? 'selected' : ''} aria-pressed={theme === 'blue'} onClick={() => setTheme('blue')}><i className="theme-swatch theme-swatch-blue" /><span>蓝白</span></button></div></section>
    <section className="settings-card"><header><span className="section-icon"><PlugZap size={20} /></span><div><h2>连接 AI 参谋</h2><p>使用真实模型分析。你可以连接支持 Chat Completions 的云端接口。</p></div><span className={'connection-pill ' + (data.connection.hasKey ? 'configured' : '')}>{data.connection.hasKey ? <><Check size={13} />密钥已配置</> : '等待连接'}</span></header><div className="form-grid"><label className="field"><span className="field-title">接口基础地址</span><input aria-label="接口基础地址" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.deepseek.com" /><span className="field-hint">基础地址即可，不需要填写 /chat/completions。</span></label><label className="field"><span className="field-title">模型名称</span><input aria-label="模型名称" value={model} onChange={e => setModel(e.target.value)} placeholder="填写服务商提供的模型名称" /></label></div><label className="field"><span className="field-title">API 密钥</span><input type="password" autoComplete="new-password" aria-label="API 密钥" value={key} onChange={e => setKey(e.target.value)} placeholder={data.connection.hasKey ? '已保存；留空保留原密钥，填写新值可替换' : '粘贴你自己的 API 密钥'} /><span className="field-hint">密钥保存在本机，不会写入业务备份，也不会在页面中回显。调用费用由你的模型账户承担。</span></label><FormError message={connectionError} /><div className="section-actions"><button className="text-button" disabled={Boolean(busy) || !data.connection.hasKey} onClick={() => saveConnection(false, true)}>移除已保存的密钥</button><div className="button-group"><button className="secondary" disabled={Boolean(busy)} onClick={() => saveConnection()}>{busy === 'connection' ? <Spinner label="保存中…" /> : '保存配置'}</button><button className="primary" disabled={Boolean(busy) || !baseUrl || !model || (!key && !data.connection.hasKey)} onClick={() => saveConnection(true)}>{busy === 'test' ? <Spinner label="测试连接中…" /> : '保存并测试连接'}</button></div></div><p className="field-hint">连接测试只发送一条测试消息，不携带员工或决策资料。默认服务的模型名称可按你的账户权限调整。</p></section>
    <section className="settings-card feedback-card"><header><span className="section-icon"><MessageSquareText size={20} /></span><div><h2>反馈与改进</h2><p>记下使用中遇到的问题或改进想法。</p></div></header><TextArea label="你的反馈" rows={4} maxLength={3000} value={feedback} onValue={setFeedback} placeholder="希望哪里更顺手？" /><div className="section-actions"><span className="muted">反馈只保存在本机，不会自动发送。</span><button className="secondary" disabled={!feedback.trim()} onClick={saveFeedback}>保存反馈</button></div>{feedbackNotes.length > 0 && <details className="feedback-history"><summary>已记录 {feedbackNotes.length} 条</summary>{feedbackNotes.slice(0, 5).map((note,index) => <p key={note.createdAt + index}>{note.text}<small>{dateText(note.createdAt, true)}</small></p>)}</details>}</section>
    <details className="settings-details"><summary>隐私与数据边界</summary><div><header><span className="section-icon"><ShieldCheck size={20} /></span><div><h2>你的记录，留在这台电脑</h2><p>清楚知道什么留在本地，什么会发送出去。</p></div></header><div className="privacy-columns"><div><LockKeyhole size={18} /><h3>本机保存</h3><p>用户画像、员工画像、初判、最终决定和复盘记录，保存在本机数据库。关闭浏览器后仍会保留。</p></div><div><ExternalLink size={18} /><h3>确认后发送</h3><p>每次分析前都会展示需要发送的内容。模型服务商会处理这些内容，留存规则以服务商政策为准。</p></div></div><p className="privacy-caveat">请使用昵称和代号，不要填写真实姓名或公司名。系统会检查常见联系方式，但无法识别所有敏感信息。本机文件也需要妥善保管。</p></div></details>
    <section className="settings-card"><header><span className="section-icon"><Download size={20} /></span><div><h2>备份与恢复</h2><p>备份包含你的私人业务记录，请存放在可信的位置。</p></div></header><div className="section-actions"><p className="muted">恢复会替换当前记录，建议先导出一份备份。</p><div className="button-group"><a href="/api/backup" className="secondary" download><Download size={15} />导出备份</a><button className="secondary" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}><Upload size={15} />导入备份</button><input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e => { if (e.target.files?.[0]) readBackup(e.target.files[0]); }} /></div></div></section>
    <div className="danger-zone"><div><h3>清空本机业务记录</h3><p>删除员工、决策、复盘和画像历史。此操作需要二次确认。</p></div><button className="danger-text" onClick={() => { setClear(true); setConfirmation(''); setModalError(''); }}><Trash2 size={15} />清空记录</button></div><PrivacyNote />
    {(restore || clear) && <Modal title={restore ? '确认恢复这份备份？' : '确认清空本机记录？'} onClose={() => { setRestore(null); setClear(false); }} busy={Boolean(busy)}>{restore ? <p className="modal-intro">这份备份来自 {dateText(restore.counts.exportedAt, true)}，包含 {restore.counts.employees} 位员工和 {restore.counts.decisions} 条决策。恢复后将替换当前业务记录，模型配置保持不变。</p> : <p className="modal-intro">员工、决策和复盘将从本机删除。建议先导出备份，删除后无法在应用中撤销。</p>}<a className="text-button" href="/api/backup" download><Download size={14} />先导出当前记录</a><label className="field"><span className="field-title">请输入“{restore ? '恢复备份' : '清空本机记录'}”确认</span><input value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label><FormError message={modalError} /><div className="modal-actions"><button className="secondary" disabled={Boolean(busy)} onClick={() => { setRestore(null); setClear(false); }}>取消</button><button className="danger-button" disabled={Boolean(busy) || confirmation !== (restore ? '恢复备份' : '清空本机记录')} onClick={destructiveAction}>{busy === 'data' ? <Spinner label="正在处理…" /> : restore ? '确认恢复' : '确认清空'}</button></div></Modal>}
  </div>;
}

