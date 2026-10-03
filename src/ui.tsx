import { useEffect, useRef, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { X, LoaderCircle, LockKeyhole, ShieldCheck, AlertCircle } from 'lucide-react';
import { hasContacts, redactContacts } from '../shared/model';

export function Spinner({ label = '正在准备…' }: { label?: string }) { return <span className="spinner-label"><LoaderCircle size={16} className="spin" />{label}</span>; }
export function PrivacyNote({ compact = false }: { compact?: boolean }) { return <p className="privacy-note"><LockKeyhole size={13} /><span>{compact ? '记录保存在这台电脑' : '记录保存在本机。仅在你确认后，必要内容才会发送给 AI 服务。'}</span></p>; }
export function Modal({ title, eyebrow, children, onClose, busy = false, wide = false, className = '' }: { title: string; eyebrow?: string; children: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = ref.current!; element.showModal(); return () => element.close(); }, []);
  return <dialog ref={ref} className={'modal ' + (wide ? 'modal-wide ' : '') + className} aria-label={title} onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <header className="modal-header"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2></div><button type="button" className="icon-button" aria-label="关闭弹窗" disabled={busy} onClick={onClose}><X size={20} /></button></header>
    <div className="modal-body">{children}</div>
  </dialog>;
}
export function TextArea({ label, hint, value, onValue, ...props }: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & { label?: string; hint?: string; value: string; onValue: (value: string) => void }) {
  const sensitive = hasContacts(value);
  return <label className="field"><span className="field-title">{label}</span><textarea value={value} onChange={e => onValue(e.target.value)} {...props} />{hint && <span className="field-hint">{hint}</span>}{sensitive && <span className="contact-warning"><AlertCircle size={14} />检测到联系方式。<button type="button" onClick={() => onValue(redactContacts(value))}>替换为匿名文本</button></span>}</label>;
}
export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode }) { return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{children}</p>{action}</div>; }
export function FormError({ message }: { message?: string }) { return message ? <p className="form-error" role="alert"><AlertCircle size={16} />{message}</p> : null; }
const names: Record<string, string> = { industry: '行业', department: '部门职能', description: '背景说明', 员工标识: '员工内部代号' };
export function PayloadView({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (Array.isArray(value)) return value.length ? <div className="payload-list">{value.map((item, i) => <div className="payload-item" key={i}><PayloadView value={item} depth={depth + 1} /></div>)}</div> : <p className="muted">未提供</p>;
  if (value !== null && typeof value === 'object') return <div className={'payload depth-' + depth}>{Object.entries(value).filter(([key]) => key !== '员工标识').map(([key, item]) => <div key={key}><h4>{names[key] || key}</h4><PayloadView value={item} depth={depth + 1} /></div>)}</div>;
  return <p className="preserve-lines">{typeof value === 'boolean' ? (value ? '是' : '否') : value === null || value === undefined || value === '' ? '未提供' : String(value)}</p>;
}
export function DataBadge() { return <span className="data-badge"><ShieldCheck size={14} />数据保存在本机</span>; }
