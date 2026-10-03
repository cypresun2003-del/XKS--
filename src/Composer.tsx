import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, ChevronDown, HelpCircle, Paperclip, Plus, X } from 'lucide-react';
import type { Bootstrap, DraftInput, Employee } from '../shared/model';
import { hasContacts, meaningfulInitialPlan } from '../shared/model';
import type { Notify } from './App';
import { api, errorText } from './api';
import { FormError, Modal, Spinner, TextArea } from './ui';
import GuidedTour from './GuidedTour';
import EmployeeSelection from './EmployeeSelection';

export default function Composer({ data, refresh, notify, startDecision }: {
  data: Bootstrap;
  refresh: () => Promise<void>;
  notify: Notify;
  startDecision: (input: DraftInput) => Promise<void>;
  navigate: (path: string) => void;
}) {
  const [problem, setProblem] = useState(''), [initialPlan, setInitialPlan] = useState(''), [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [picker, setPicker] = useState(false), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [adding, setAdding] = useState(false), [nickname, setNickname] = useState(''), [role, setRole] = useState(''), [description, setDescription] = useState('');
  const [guide, setGuide] = useState(0);
  const anchor = useRef<HTMLButtonElement>(null), popover = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 12, maxHeight: 300 });
  useLayoutEffect(() => {
    if (!picker) return;
    const reposition = () => {
      const a = anchor.current?.getBoundingClientRect(); if (!a) return;
      const viewport = window.visualViewport;
      const bottom = (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight);
      const topEdge = (viewport?.offsetTop || 0) + 12;
      const height = Math.min(popover.current?.scrollHeight || 290, bottom - topEdge - 12);
      const below = a.bottom + 8;
      const top = below + height <= bottom - 12 ? below : Math.max(topEdge, a.top - height - 8);
      setPosition({ left: Math.max(12, Math.min(a.left, window.innerWidth - Math.min(300, window.innerWidth - 24) - 12)), top, maxHeight: bottom - top - 12 });
    };
    reposition();
    const observer = new ResizeObserver(reposition); if (popover.current) observer.observe(popover.current);
    const outside = (event: PointerEvent) => { if (!popover.current?.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) setPicker(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setPicker(false); anchor.current?.focus(); } };
    window.addEventListener('resize', reposition); window.addEventListener('scroll', reposition, true);
    window.visualViewport?.addEventListener('resize', reposition);
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { observer.disconnect(); window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true); window.visualViewport?.removeEventListener('resize', reposition); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [picker]);
  const employees = data.employees.filter(employee => !employee.archived);
  useEffect(() => {
    const available = new Set(data.employees.filter(e => !e.archived).map(e => e.id));
    setEmployeeIds(ids => ids.filter(id => available.has(id)));
  }, [data.employees]);
  const canAnalyze = Boolean(problem.trim() && meaningfulInitialPlan(initialPlan) && !hasContacts(problem + initialPlan) && !busy);

  useEffect(() => {
    try { if (!localStorage.getItem('second-perspective-guide-v3-seen') && !window.location.hash.slice(1).replace('/', '')) setGuide(1); } catch { /* Continue without local storage. */ }
  }, []);

  function closeGuide() {
    setGuide(0);
    try { localStorage.setItem('second-perspective-guide-v3-seen', '1'); } catch { /* The guide remains dismissible for this visit. */ }
  }

  async function submit() {
    setError('');
    if (!problem.trim()) { setError('先写下你现在的问题。'); return; }
    if (!meaningfulInitialPlan(initialPlan)) { setError('请先写下你目前的初步决定，再查看 AI 方案。'); return; }
    setBusy('create');
    try {
      await startDecision({ channel: 'full', title: problem.trim().slice(0, 80), problem: problem.trim(), initialPlan: initialPlan.trim(), employeeIds, temporaryContext: '' });
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(''); }
  }

  async function saveEmployee() {
    setBusy('employee'); setError('');
    try {
      const employee = await api<Employee>('/employees', 'POST', { nickname, role, description });
      setEmployeeIds(ids => [...new Set([...ids, employee.id])]);
      setAdding(false); setNickname(''); setRole(''); setDescription('');
      try { await refresh(); } catch { notify('画像已保存，列表暂未刷新，请重试刷新。', true); return; }
      notify(employee.nickname + ' 已加入本次参考画像。');
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(''); }
  }

  return <div className="composer-page">
    <section className="question-composer" aria-label="输入决策问题">
      <div className="question-area">
        <div className="composer-label-row"><label htmlFor="decision-problem" data-guide="problem">你遇到了什么问题？</label><button className="guide-trigger icon-button" aria-label="查看使用说明" onClick={() => { setPicker(false); setGuide(1); }}><HelpCircle size={18} /></button></div>
        <textarea id="decision-problem" aria-label="你遇到了什么问题？" maxLength={8000} value={problem} onChange={event => setProblem(event.target.value)} placeholder="说说目前的情况、顾虑和你希望达到的结果。" />
      <div className="composer-employee-row">
        <div className="composer-employee-select">
          <button ref={anchor} className="text-button" data-guide="employees" type="button" aria-expanded={picker} onClick={() => setPicker(open => !open)}><Paperclip size={15} />关联员工画像 <span className="field-hint">可选</span><ChevronDown size={14} /></button>
          {employeeIds.length > 0 && <div className="composer-selected">{employeeIds.slice(0, 2).map(id => { const e = employees.find(employee => employee.id === id); return e && <button type="button" className="profile-chip" key={id} onClick={() => setEmployeeIds(ids => ids.filter(item => item !== id))}>{e.nickname || e.alias}<X size={12} /></button>; })}{employeeIds.length > 2 && <button type="button" className="profile-chip" onClick={() => setPicker(true)}>另 {employeeIds.length - 2} 人</button>}</div>}
          {picker && <div ref={popover} className="employee-popover compact-popover" role="dialog" aria-label="选择相关员工" style={position}><div className="popover-heading"><strong>选择相关员工</strong><button className="icon-button" aria-label="关闭员工选择" onClick={() => setPicker(false)}><X size={15} /></button></div>
            <EmployeeSelection compact employees={employees} groups={data.groups || []} selected={employeeIds} onChange={setEmployeeIds} />
            <div className="popover-actions"><button type="button" className="text-button" onClick={() => { setPicker(false); setError(''); setAdding(true); }}><Plus size={14} />新增员工画像</button><button type="button" className="primary" onClick={() => setPicker(false)}>完成</button></div>
          </div>}
        </div>
      </div>
      </div>
      <div className="initial-plan-area">
        <div className="composer-label-row"><label htmlFor="decision-plan" data-guide="plan">你打算怎么做？ <span>必填</span></label><span className="independence-hint">AI 的三个独立方案不会读取这段初判</span></div>
        <textarea id="decision-plan" aria-label="你打算怎么做？" maxLength={8000} value={initialPlan} onChange={event => setInitialPlan(event.target.value)} placeholder="写下你现在倾向的做法和理由。" />
        <div className="composer-submit-row"><span className="composer-submit-note">{hasContacts(problem + initialPlan) ? '请先移除输入中的电话号码或邮箱。' : '先写下自己的判断，再开始分析。'}</span><button className="primary composer-submit" data-guide="analyze" disabled={!canAnalyze} onClick={submit}>{busy === 'create' ? <Spinner label="准备中…" /> : <>分析<ArrowUpRight size={17} /></>}</button></div>
      </div>
    </section>
    {!adding && <FormError message={error} />}

    {adding && <Modal title="添加员工画像" onClose={() => setAdding(false)} busy={busy === 'employee'}><p className="modal-intro">使用代号和昵称，不需要填写真实姓名。</p><label className="field"><span className="field-title">昵称</span><input maxLength={80} value={nickname} onChange={event => setNickname(event.target.value)} placeholder="例如：负责交付的同事" /></label><label className="field"><span className="field-title">职责</span><input maxLength={120} value={role} onChange={event => setRole(event.target.value)} placeholder="例如：产品研发" /></label><TextArea label="我对他的看法" rows={4} maxLength={3000} value={description} onValue={setDescription} placeholder="例如：技术能力强，跨部门沟通时比较直接。" /><FormError message={error} /><div className="modal-actions"><button className="secondary" disabled={busy === 'employee'} onClick={() => setAdding(false)}>返回</button><button className="primary" disabled={busy === 'employee' || !nickname.trim() || !role.trim() || !description.trim()} onClick={saveEmployee}>{busy === 'employee' ? <Spinner label="保存中…" /> : '保存并关联'}</button></div></Modal>}
    {guide > 0 && <GuidedTour onClose={closeGuide} />}
  </div>;
}
