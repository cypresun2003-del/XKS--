import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCheck, ChevronDown, Clock3, GitCompareArrows, History, Lightbulb, PencilLine, Plus, Save, ShieldCheck, Sparkles, Trash2, TriangleAlert, UsersRound } from 'lucide-react';
import { channelLabels, meaningfulInitialPlan as meaningful, modeLabels, type Analysis, type Decision, type Employee, type ProfileSuggestion, type Review } from '../shared/model';
import type { PageProps } from './App';
import { api, dateText, errorText } from './api';
import { FormError, Modal, PayloadView, PrivacyNote, Spinner, TextArea } from './ui';
import { useDecision } from './useDecision';

type Preview = { kind: 'analysis' | 'review'; payload: unknown; fingerprint: string; reviewId?: string; revision: number; requestId: string };
type Mode = 'maintain' | 'revise' | 'adopt';
type Candidate = Analysis['profileCandidates'][number];
const resultLabels = { smooth: '顺利', mixed: '有波折', problem: '出问题', pending: '还没结果' };
type ResultStatus = keyof typeof resultLabels;

export default function DecisionPage({ decisionId, data, refresh, notify, navigate, analyzeOnOpen = false, registerGuard }: PageProps & { decisionId: string; analyzeOnOpen?: boolean; registerGuard: (fn: (() => Promise<void>) | null) => void }) {
  const { decision, draft, update, save, apply, saveStatus, loadError, refreshAfterWrite } = useDecision(decisionId, refresh, notify, registerGuard);
  const [modal, setModal] = useState<'soul' | 'preview' | 'final' | 'delete' | 'upgrade' | 'candidates' | 'employee' | null>(null);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [soul, setSoul] = useState(''), [preview, setPreview] = useState<Preview | null>(null), [consent, setConsent] = useState(false);
  const requestIds = useRef(new Map<string, string>());
  const autoAnalyzeStarted = useRef(false);
  const [finalMode, setFinalMode] = useState<Mode>('maintain'), [finalText, setFinalText] = useState(''), [finalSource, setFinalSource] = useState<string | null>(null), [adoptedOptionId, setAdoptedOptionId] = useState<string | null>(null);
  const [followupDays, setFollowupDays] = useState<14 | 30 | 90 | null>(30);
  const [resultStatus, setResultStatus] = useState<ResultStatus>('smooth'), [surprise, setSurprise] = useState(''), [hindsight, setHindsight] = useState(''), [reviewError, setReviewError] = useState(''), [showReviewForm, setShowReviewForm] = useState(false);
  const [suggestion, setSuggestion] = useState<ProfileSuggestion | null>(null), [suggestionText, setSuggestionText] = useState(''), [acknowledge, setAcknowledge] = useState(false);
  const [candidateTexts, setCandidateTexts] = useState<Record<string, string>>({}), [upgradeEmployees, setUpgradeEmployees] = useState<string[]>([]), [upgradePlan, setUpgradePlan] = useState('');
  const [employeeNickname, setEmployeeNickname] = useState(''), [employeeRole, setEmployeeRole] = useState(''), [employeeDescription, setEmployeeDescription] = useState(''), [employeeReturnTo, setEmployeeReturnTo] = useState<'upgrade' | null>(null);
  const createdEmployee = useRef<Employee | null>(null);
  const [newEmployees, setNewEmployees] = useState<Employee[]>([]);
  const employees = useMemo(() => {
    const known = new Map(data.employees.map(employee => [employee.id, employee]));
    for (const employee of newEmployees) if (!known.has(employee.id)) known.set(employee.id, employee);
    return [...known.values()];
  }, [data.employees, newEmployees]);
  const latestAnalysis = decision?.analyses.at(-1), latestFinal = decision?.finals.at(-1);
  const channel = decision?.channel || 'full', full = channel === 'full', quick = !full;
  const hasPlan = meaningful(draft.initialPlan), locked = Boolean(busy);
  const relevantEmployees = employees.filter(e => !e.archived || draft.employeeIds.includes(e.id));
  const selectedEmployee = suggestion ? employees.find(e => e.id === suggestion.employeeId) : undefined;
  const changedProfile = Boolean(suggestion && selectedEmployee && suggestion.baseVersion !== selectedEmployee.version);
  const candidates = decision?.analyses.flatMap(a => a.profileCandidates) || [];
  const analysisCurrent = useMemo(() => {
    if (!latestAnalysis || !decision) return false;
    const snapshot = latestAnalysis.snapshot;
    return snapshot.channel === decision.channel && snapshot.title === draft.title.trim() && snapshot.problem === draft.problem.trim()
      && snapshot.temporaryContext === draft.temporaryContext.trim() && snapshot.initialPlan === draft.initialPlan.trim()
      && JSON.stringify(snapshot.context) === JSON.stringify(full ? data.context : { industry: '', department: '', description: '' })
      && JSON.stringify(snapshot.employees.map(e => [e.id, e.version])) === JSON.stringify(draft.employeeIds.map(id => { const e = employees.find(e => e.id === id); return [id, e?.version]; }));
  }, [latestAnalysis, decision, draft, data, full, employees]);

  async function acceptDecision(next: Decision) { apply(next); await refreshAfterWrite(); }
  function openSoul() { setSoul(draft.initialPlan); setError(''); setModal('soul'); }
  async function loadPreview(current: Decision, review?: Review) {
    const path = review ? '/decisions/' + decisionId + '/reviews/' + review.id + '/preview' : '/decisions/' + decisionId + '/analysis-preview';
    const result = await api<Omit<Preview, 'revision' | 'requestId'>>(path);
    const key = [review?.id || 'analysis', current.revision, result.fingerprint].join(':');
    if (!requestIds.current.has(key)) requestIds.current.set(key, crypto.randomUUID());
    setPreview({ ...result, kind: review ? 'review' : 'analysis', reviewId: review?.id, revision: current.revision, requestId: requestIds.current.get(key)! });
    setConsent(false); setModal('preview');
  }
  async function prepareAnalysis(fromSoul = false, send = true) {
    setBusy('prepare'); setError('');
    try {
      if (fromSoul) update({ initialPlan: soul.trim() });
      const current = await save();
      if (!send) { setModal(null); notify('初步打算已保存。'); return; }
      await loadPreview(current);
    } catch (e) { setError(errorText(e)); } finally { setBusy(''); }
  }
  function startAnalysis() { void prepareAnalysis(); }
  async function prepareReview(review: Review) {
    setBusy('prepare'); setError('');
    try { await loadPreview(await save(), review); } catch (e) { notify(errorText(e), true); } finally { setBusy(''); }
  }
  async function sendPreview() {
    if (!preview || !consent) return;
    setBusy('analysis'); setError('');
    try {
      const path = preview.kind === 'analysis' ? '/decisions/' + decisionId + '/analyze' : '/decisions/' + decisionId + '/reviews/' + preview.reviewId + '/analyze';
      const next = await api<Decision>(path, 'POST', { fingerprint: preview.fingerprint, revision: preview.revision, requestId: preview.requestId, consent });
      await acceptDecision(next); setModal(null);
      notify(preview.kind === 'analysis' ? '分析已完成，请查看备选角度。' : '复盘已完成。画像建议需要你确认后才会生效。');
    } catch (e) { setError(errorText(e)); } finally { setBusy(''); }
  }
  async function openFinal(mode: Mode, text?: string, optionId: string | null = null) {
    setError(''); setBusy('prepare');
    try {
      const current = await save();
      setFinalMode(mode); setFinalText(mode === 'maintain' ? current.initialPlan.trim() : text || current.initialPlan.trim());
      setFinalSource(mode === 'maintain' ? null : latestAnalysis?.id || null); setAdoptedOptionId(mode === 'maintain' ? null : optionId);
      setFollowupDays(full ? 30 : null); setModal('final');
    } catch (e) { notify(errorText(e), true); } finally { setBusy(''); }
  }
  async function confirmFinal() {
    setBusy('final'); setError('');
    try {
      const current = await save();
      const next = await api<Decision>('/decisions/' + decisionId + '/finals', 'POST', { mode: finalMode, text: finalText, analysisId: finalSource, adoptedOptionId, followupDays: full ? followupDays : null, revision: current.revision });
      await acceptDecision(next); setModal(null); setShowReviewForm(false); notify('最终决定已保存。');
    } catch (e) { setError(errorText(e)); } finally { setBusy(''); }
  }
  async function saveReview() {
    setBusy('feedback'); setReviewError('');
    try {
      const current = await save();
      const next = await api<Decision>('/decisions/' + decisionId + '/reviews', 'POST', { resultStatus, surprise, hindsight, revision: current.revision });
      await acceptDecision(next); setSurprise(''); setHindsight(''); setShowReviewForm(false);
      if (resultStatus === 'pending') { notify('已记录，下次回访顺延 14 天。'); return; }
      notify('结果已保存。核对发送内容后，可以继续 AI 复盘。');
      try { await loadPreview(next, next.reviews.at(-1)!); } catch (e) { notify('结果已保存。' + errorText(e), true); }
    } catch (e) { setReviewError(errorText(e)); } finally { setBusy(''); }
  }
  async function openSuggestion(item: ProfileSuggestion) {
    setBusy('prepare');
    try { await refresh(); setSuggestion(item); setSuggestionText(item.proposedDescription); setAcknowledge(false); setError(''); }
    catch (e) { notify(errorText(e), true); } finally { setBusy(''); }
  }
  async function resolveSuggestion(item: ProfileSuggestion, action: 'accept' | 'reject') {
    setBusy('suggestion'); setError('');
    try {
      const current = await save();
      const next = await api<Decision>('/decisions/' + decisionId + '/suggestions/' + item.id + '/resolve', 'POST', { action, revision: current.revision, ...(action === 'accept' ? { description: suggestionText, expectedVersion: selectedEmployee?.version, acknowledgeChanged: acknowledge } : {}) });
      await acceptDecision(next); setSuggestion(null); notify(action === 'accept' ? '员工画像已更新，旧版本已保留。' : '已保留原画像。');
    } catch (e) { if (suggestion) setError(errorText(e)); else notify(errorText(e), true); } finally { setBusy(''); }
  }
  function openCandidates() { setCandidateTexts(Object.fromEntries(candidates.map(c => [c.id, c.description]))); setError(''); setModal('candidates'); }
  async function resolveCandidate(candidate: Candidate, action: 'save' | 'skip') {
    setBusy('candidate'); setError('');
    try {
      const current = await save();
      const next = await api<Decision>('/decisions/' + decisionId + '/candidates/' + candidate.id + '/resolve', 'POST', { action, revision: current.revision, ...(action === 'save' ? { description: candidateTexts[candidate.id] } : {}) });
      await acceptDecision(next); notify(action === 'save' ? '已按你确认的内容新增员工画像。' : '已跳过这条候选画像。');
    } catch (e) { setError(errorText(e)); } finally { setBusy(''); }
  }
  function openUpgrade() {
    const availableIds = new Set(employees.filter(e => !e.archived).map(e => e.id));
    const savedCandidateIds = candidates.filter(c => c.status === 'saved' && c.employeeId).map(c => c.employeeId!);
    setUpgradeEmployees([...new Set([...draft.employeeIds, ...savedCandidateIds])].filter(id => availableIds.has(id)));
    setUpgradePlan(draft.initialPlan); setError(''); setModal('upgrade');
  }
  function openEmployee(returnTo: 'upgrade' | null = null) {
    createdEmployee.current = null; setEmployeeNickname(''); setEmployeeRole(''); setEmployeeDescription(''); setEmployeeReturnTo(returnTo); setError(''); setModal('employee');
  }
  async function addEmployee() {
    setBusy('employee'); setError('');
    try {
      const employee = createdEmployee.current || await api<Employee>('/employees', 'POST', { nickname: employeeNickname, role: employeeRole, description: employeeDescription });
      createdEmployee.current = employee;
      setNewEmployees(items => [...items.filter(item => item.id !== employee.id), employee]);
      if (employeeReturnTo === 'upgrade') setUpgradeEmployees(ids => [...new Set([...ids, employee.id])]);
      else { update({ employeeIds: [...new Set([...draft.employeeIds, employee.id])] }); await save(); }
      setModal(employeeReturnTo); notify((employee.nickname || employee.alias) + ' 已新增，并选入本次决策。'); createdEmployee.current = null;
      await refreshAfterWrite();
    } catch (e) { setError((createdEmployee.current ? '画像已新增，请重试完成关联。' : '') + errorText(e)); }
    finally { setBusy(''); }
  }
  async function upgrade() {
    setBusy('upgrade'); setError('');
    try {
      const current = await save();
      const next = await api<Decision>('/decisions/' + decisionId + '/upgrade', 'POST', { employeeIds: upgradeEmployees, initialPlan: upgradePlan, revision: current.revision });
      await acceptDecision(next); setModal(null); notify('已进入深度决策，原有分析仍保留。');
      try { await loadPreview(next); } catch (e) { notify(errorText(e), true); }
    } catch (e) { setError(errorText(e)); } finally { setBusy(''); }
  }
  async function deleteDecision() {
    setBusy('delete'); setError('');
    try { const current = await save(); await api('/decisions/' + decisionId, 'DELETE', undefined, { 'X-Decision-Revision': String(current.revision) }); registerGuard(null); setModal(null); await refreshAfterWrite(); navigate('/'); notify('决策记录已删除。'); }
    catch (e) { setError(errorText(e)); setBusy(''); }
  }

  useEffect(() => {
    if (analyzeOnOpen && decision && !autoAnalyzeStarted.current) { autoAnalyzeStarted.current = true; void prepareAnalysis(); }
  }, [analyzeOnOpen, decision, decisionId]);
  if (!decision) return <div className="loading-page">{loadError ? <><h2>暂时无法打开决策</h2><p>{loadError}</p><button className="secondary" onClick={() => navigate('/library')}>返回决策库</button></> : <Spinner label="正在加载决策…" />}</div>;
  const fullFinal = full && latestFinal?.snapshot.channel === 'full' ? latestFinal : undefined;
  const reviewForFinal = latestFinal && decision.reviews.some(r => r.finalId === latestFinal.id);
  const canReview = Boolean(full && latestFinal?.snapshot.channel === 'full' && (decision.status === 'decided' || decision.status === 'reviewed'));
  const toggleEmployee = (id: string) => update({ employeeIds: draft.employeeIds.includes(id) ? draft.employeeIds.filter(item => item !== id) : [...draft.employeeIds, id] });

  return <div className="page workspace-page">
    <div className="workspace-toolbar"><button className="text-button" disabled={locked} onClick={() => navigate('/library')}><ArrowLeft size={15} />决策库</button><div><span className={'save-status save-' + saveStatus}>{saveStatus === 'saving' ? <Spinner label="保存中" /> : saveStatus === 'saved' ? <><Check size={13} />已保存</> : saveStatus === 'error' ? '保存失败，请重试' : '等待保存…'}</span><button className="icon-button" aria-label="保存草稿" disabled={locked} onClick={() => save().then(() => notify('草稿已保存。')).catch(e => notify(errorText(e), true))}><Save size={16} /></button><button className="icon-button" aria-label="删除决策" disabled={locked} onClick={() => { setError(''); setModal('delete'); }}><Trash2 size={16} /></button></div></div>
    <div className="workspace-title"><span className="channel-badge">{channelLabels[channel]}</span><input aria-label="决策标题" maxLength={100} value={draft.title} disabled={locked} onChange={e => update({ title: e.target.value })} placeholder="给这件事起个标题（可选）" /></div>
    {!modal && <FormError message={error} />}
    <div className="workspace-grid"><div className="decision-main">
      {fullFinal && latestFinal && <section className="final-card"><div className="paper-heading"><CheckCheck size={21} /><h2>最终决定</h2><span className="version-badge">第 {decision.finals.length} 版</span></div><p className="final-text preserve-lines">{latestFinal.text}</p><div className="final-footer"><span>{modeLabels[latestFinal.mode]} · {dateText(latestFinal.createdAt, true)}</span><button className="text-button" disabled={locked} onClick={() => { if (analysisCurrent) void openFinal('revise', latestFinal.text); else { setSoul(latestFinal.text); setError(''); setModal('soul'); } }}>调整决定<PencilLine size={13} /></button></div><ChoiceRecord decision={decision} finalId={latestFinal.id} />{full && latestFinal.followup.dueAt && <p className="field-hint"><Clock3 size={13} />{latestFinal.followup.status === 'done' ? '已完成回访' : '预计回访：' + dateText(latestFinal.followup.dueAt)}</p>}{decision.status === 'draft' && <p className="inline-warning">当前问题或初步打算已经修改，上方是之前确认的决定。</p>}</section>}
      <section className="paper-card problem-card"><div className="paper-heading"><h2>描述问题</h2></div>
        {quick && <TextArea label="背景与限制" rows={2} maxLength={4000} value={draft.temporaryContext} onValue={temporaryContext => update({ temporaryContext })} disabled={locked} placeholder="例如：我负责一个小团队，下周要交付新项目，人手和预算都有限。" hint="只需描述相关情况，不用先填写员工信息。" />}
        <TextArea label="需要解决什么？" aria-label="当前面临的问题" rows={3} maxLength={8000} disabled={locked} placeholder="描述问题、目标和限制，例如：下周要交付新项目，怎样安排负责人？" value={draft.problem} onValue={problem => update({ problem })} />
        {full && <><EmployeePicker employees={relevantEmployees} selected={draft.employeeIds} disabled={locked} onToggle={toggleEmployee} onAdd={() => openEmployee()} hint="可选；不关联也能分析。" /><details className="context-details"><summary>补充本次背景（可选）</summary><TextArea rows={2} maxLength={4000} value={draft.temporaryContext} onValue={temporaryContext => update({ temporaryContext })} disabled={locked} placeholder="本次的时间、资源或其他限制" /></details></>}
        {quick && <><details className="context-details"><summary>我已有初步打算（可选）</summary><TextArea aria-label="我的初步打算（可选）" value={draft.initialPlan} onValue={initialPlan => update({ initialPlan })} rows={2} maxLength={8000} disabled={locked} placeholder="已有想法就写下来；还没想好可以留空。" /><p className="field-hint">初步打算只用于单独检查风险，不影响三个独立角度。</p></details><div className="initial-actions"><button className="primary" disabled={locked || !draft.problem.trim() || !draft.temporaryContext.trim()} onClick={startAnalysis}>{busy === 'prepare' ? <Spinner label="准备中…" /> : <><Sparkles size={15} />{latestAnalysis ? '重新分析三个角度' : '分析三个角度'}</>}</button></div></>}
      </section>
      {full && <section className="paper-card initial-card owner-decision-card"><div className="paper-heading"><h2>我的初步决定</h2><span className="owner-label">你的判断</span></div>
        <TextArea label="我目前倾向于怎样做？" rows={4} maxLength={8000} value={draft.initialPlan} onValue={initialPlan => update({ initialPlan })} disabled={locked} placeholder="写下你目前的安排和主要考虑。" hint="必填。独立方案不会读取这段内容。" />
        <p className="independent-note"><ShieldCheck size={14} />三个独立方案不会看到你的初步决定；风险检查单独进行。</p>
        <div className="initial-actions">{hasPlan && <button className="secondary" disabled={locked} onClick={() => openFinal('maintain')}>按我的打算确认</button>}<button className={latestAnalysis && analysisCurrent ? 'secondary' : 'primary'} disabled={locked || !draft.problem.trim() || !hasPlan} onClick={startAnalysis}>{busy === 'prepare' ? <Spinner label="准备中…" /> : <><Sparkles size={15} />{latestAnalysis ? '重新分析三个角度' : '分析三个角度'}</>}</button></div>
      </section>}
      {latestAnalysis && analysisCurrent && full && <div className="compare-action"><GitCompareArrows size={19} /><div><strong>确定你的安排</strong><p>可以吸收分析，也可以保留自己的想法。</p></div><button className="primary" disabled={locked} onClick={() => openFinal('revise')}>确认最终决定<ArrowRight size={14} /></button></div>}
      {quick && latestAnalysis && <section className="paper-card upgrade-note"><h3>需要把决定落实并跟进结果？</h3><p>保存相关员工画像，进入深度决策。你确认后才会新增档案。</p><div className="button-group">{candidates.length ? <button className="secondary" disabled={locked} onClick={openCandidates}>核对候选画像{candidates.filter(c => c.status === 'pending').length ? ' · ' + candidates.filter(c => c.status === 'pending').length + ' 条' : ''}<ArrowRight size={14} /></button> : <button className="secondary" disabled={locked} onClick={() => { openUpgrade(); openEmployee('upgrade'); }}>添加员工画像</button>}<button className="text-button" disabled={locked} onClick={openUpgrade}>进入深度决策<ArrowRight size={14} /></button></div></section>}
      {fullFinal && latestFinal && <section className="paper-card review-section"><div className="paper-heading"><h2>结果复盘</h2><span className="version-badge">约 30 秒</span></div>
        {!canReview ? <p className="field-hint">请先确认当前版本的最终决定，再填写结果复盘。</p> : (!reviewForFinal || showReviewForm) ? <><div className="field"><span className="field-title">结果怎么样？</span><div className="review-result-options">{(Object.keys(resultLabels) as ResultStatus[]).map(status => <button key={status} type="button" disabled={locked} aria-pressed={resultStatus === status} className={resultStatus === status ? 'selected' : ''} onClick={() => setResultStatus(status)}>{resultLabels[status]}</button>)}</div></div>
          <TextArea label="有没有意外？" rows={2} value={surprise} onValue={setSurprise} maxLength={2000} disabled={locked} placeholder="一句话即可，也可以留空。" />
          <TextArea label="回头看，当初的判断怎么样？" rows={2} value={hindsight} onValue={setHindsight} maxLength={3000} disabled={locked} placeholder="哪些判断准确，哪些需要调整？" />
          {resultStatus === 'pending' && <p className="field-hint">还没结果时，下次回访顺延 14 天，本次不做画像评估。</p>}<FormError message={reviewError} /><div className="section-actions"><span className="field-hint">画像变更仍需你逐条确认。</span><button className="primary" disabled={locked} onClick={saveReview}>{busy === 'feedback' ? <Spinner label="保存中…" /> : resultStatus === 'pending' ? '保存，稍后再访' : '保存结果并复盘'}</button></div></> : <button className="text-button" disabled={locked} onClick={() => setShowReviewForm(true)}><Plus size={15} />补充新的结果</button>}
        {[...decision.reviews].reverse().map(review => <div className="review-record" key={review.id}><div className="review-record-head"><span>{dateText(review.createdAt, true)}</span><span>{review.resultStatus ? resultLabels[review.resultStatus] : '历史反馈'} · 决定第 {decision.finals.findIndex(f => f.id === review.finalId) + 1} 版</span></div><p className="preserve-lines">{review.outcome}</p><ChoiceRecord decision={decision} finalId={review.finalId} />
          {review.resultStatus === 'pending' ? <p className="field-hint">已顺延回访，等有实际结果后再评估。</p> : review.summary !== null ? <><div className="review-summary"><span><Lightbulb size={15} />AI 复盘</span><p>{review.summary}</p></div>{review.suggestions.length ? review.suggestions.map(item => <div className="suggestion-card" key={item.id}><div><h4>{item.alias} · 画像建议</h4><span className={'suggestion-status ' + item.status}>{item.status === 'pending' ? '待你确认' : item.status === 'accepted' ? '已确认更新' : '保留原画像'}</span></div><p>{item.reason}</p><blockquote>实际依据：{item.evidence}</blockquote>{item.status === 'pending' ? <div className="button-group"><button className="secondary" disabled={locked} onClick={() => openSuggestion(item)}>核对并更新<ArrowRight size={14} /></button><button className="text-button" disabled={locked} onClick={() => resolveSuggestion(item, 'reject')}>保留原画像</button></div> : item.status === 'accepted' && <details><summary>查看确认内容</summary><p>{item.appliedDescription}</p></details>}</div>) : <p className="no-suggestion"><ShieldCheck size={15} />证据不足以支持画像修改，现有画像保持不变。</p>}</> : <div className="review-next"><button className="secondary" disabled={locked} onClick={() => prepareReview(review)}><Sparkles size={14} />继续 AI 复盘</button></div>}
        </div>)}
      </section>}
      {(decision.analyses.length > 0 || decision.finals.length > 0) && <details className="history-details workspace-history"><summary><History size={16} />历史记录<span>{decision.analyses.length} 次分析 · {decision.finals.length} 次确认</span></summary>{decision.originalPlan && <div className="history-entry"><h4>第一次初步打算</h4><p className="preserve-lines">{decision.originalPlan}</p></div>}{[...decision.finals].reverse().map((f, i) => <div className="history-entry" key={f.id}><h4>决定第 {decision.finals.length - i} 版</h4><span>{dateText(f.createdAt, true)} · {modeLabels[f.mode]}</span><p className="preserve-lines">{f.text}</p><ChoiceRecord decision={decision} finalId={f.id} /></div>)}{[...decision.analyses].reverse().map((a, i) => <details className="analysis-history" key={a.id}><summary>分析第 {decision.analyses.length - i} 版 · {channelLabels[a.snapshot.channel]} · {dateText(a.createdAt, true)}</summary><AnalysisWarnings analysis={a} />{a.result.riskSummary && <p>{a.result.riskSummary}</p>}{a.profileCandidates.length > 0 && <button className="text-button" disabled={locked} onClick={openCandidates}>查看候选画像<ArrowRight size={13} /></button>}{a.result.perspectives.map(p => <div key={p.id}><h4><span className="angle-tag">{p.angleType}</span> {p.title}</h4><p>{p.plan}</p><p className="muted">该方案的风险：{p.risks}</p></div>)}<details><summary>查看本次发送内容</summary>{a.sentPayload ? <CallPayloads value={a.sentPayload} /> : <p className="field-hint">旧版记录没有保存完整发送内容。</p>}</details><details><summary>查看当时的资料快照</summary><PayloadView value={a.snapshot} /></details></details>)}</details>}
      <PrivacyNote />
    </div><aside className="advisor-column"><div className="advisor-heading"><span className="advisor-icon"><Sparkles size={18} /></span><div><h2>AI 分析</h2><p>{latestAnalysis && data.context.nickname ? `好的，${data.context.nickname}，这三个独立角度供你比较。` : '三个独立角度，供你比较。'}</p></div></div>
      {latestAnalysis ? <>{!analysisCurrent && <div className="stale-notice"><TriangleAlert size={16} /><p>资料已经变化，以下是之前的分析。请重新分析后用于当前决定。</p></div>}<AnalysisWarnings analysis={latestAnalysis} />{latestAnalysis.result.riskSummary && <div className="risk-note"><span><Lightbulb size={15} />对你的初步打算的提醒</span><p>{latestAnalysis.result.riskSummary}</p></div>}{latestAnalysis.result.perspectives.map((perspective, i) => <PerspectiveCard key={latestAnalysis.id + perspective.id} perspective={perspective} index={i} disabled={locked || !analysisCurrent} canChoose={full} onChoose={() => openFinal('adopt', perspective.plan, perspective.id)} />)}{latestAnalysis.result.unknowns.length > 0 && <details className="unknowns"><summary>信息缺口与待确认事项</summary><ul>{latestAnalysis.result.unknowns.map((item, i) => <li key={i}>{item}</li>)}</ul></details>}<details className="sent-payload-details"><summary>查看本次发送内容</summary>{latestAnalysis.sentPayload ? <CallPayloads value={latestAnalysis.sentPayload} /> : <p>旧版记录没有保存发送内容。</p>}</details><p className="advisor-footnote">基于你提供的信息 · {dateText(latestAnalysis.createdAt)}<br />用户描述是依据，分析是推测，请结合实际判断。</p></> : <div className="advisor-empty"><Sparkles size={25} strokeWidth={1.4} /><h3>分析将在这里显示</h3><p>{full ? '写下问题和初步决定，员工画像可选。' : '描述背景和问题，即可得到三个角度。'}</p>{!data.connection.hasKey && <button className="text-button" disabled={locked} onClick={() => navigate('/settings')}>连接 AI 服务<ArrowRight size={13} /></button>}</div>}
    </aside></div>

    {modal === 'soul' && <Modal title="写下你的初步打算" eyebrow={channelLabels[channel]} onClose={() => setModal(null)} busy={locked}><p className="modal-intro">准备怎么做，为什么？独立方案不会收到这段内容。</p><TextArea label="初步打算和理由" rows={6} autoFocus maxLength={8000} value={soul} onValue={setSoul} placeholder="我准备让……负责……，因为……。" disabled={locked} /><FormError message={error} /><div className="modal-actions"><button className="secondary" disabled={locked || !meaningful(soul)} onClick={() => prepareAnalysis(true, false)}>只保存</button><button className="primary" disabled={locked || !meaningful(soul)} onClick={() => prepareAnalysis(true)}>{busy ? <Spinner label="保存中…" /> : <>继续<ArrowRight size={15} /></>}</button></div></Modal>}
    {modal === 'preview' && preview && <Modal title={preview.kind === 'review' ? '确认复盘资料' : '确认发送资料'} onClose={() => setModal(null)} busy={locked} wide><p className="modal-intro">记录保存在本机。以下资料将发送给已配置的 AI 服务，云端处理与留存遵循服务商政策。</p>{preview.kind === 'analysis' ? <CallPayloads value={preview.payload} compact /> : <details className="payload-panel"><summary>查看本次复盘发送内容</summary><PayloadView value={preview.payload} /></details>}<label className="consent-checkbox"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={locked} /><span>已核对使用代号，同意发送这些内容。</span></label><FormError message={error} />{!data.connection.hasKey && <p className="inline-warning">尚未配置 AI 密钥，输入已经保存在本机。</p>}<div className="modal-actions"><button className="secondary" disabled={locked} onClick={() => setModal(null)}>返回</button>{data.connection.hasKey ? <button className="primary" disabled={locked || !consent} onClick={sendPreview}>{busy === 'analysis' ? <Spinner label="分析中…" /> : <><Sparkles size={15} />{preview.kind === 'review' ? '发送并复盘' : '发送并分析'}</>}</button> : <button className="primary" disabled={locked} onClick={() => { setModal(null); navigate('/settings'); }}>去配置 AI<ArrowRight size={15} /></button>}</div>{busy === 'analysis' && <p className="field-hint" role="status">正在请求真实模型，最多约 45 秒。输入会保留，失败后可重试。</p>}</Modal>}
    {modal === 'final' && <Modal title="确认最终决定" onClose={() => setModal(null)} busy={locked}><div className="final-mode-tabs">{(['maintain', 'revise', 'adopt'] as Mode[]).map(mode => <button key={mode} type="button" className={finalMode === mode ? 'selected' : ''} disabled={locked || (mode === 'maintain' ? !hasPlan : !analysisCurrent)} onClick={() => { setFinalMode(mode); setFinalSource(mode === 'maintain' ? null : latestAnalysis?.id || null); setAdoptedOptionId(null); setFinalText(draft.initialPlan.trim()); }}>{modeLabels[mode]}</button>)}</div>{finalMode !== 'maintain' && <label className="field"><span className="field-title">采用的角度（按实际选择记录）</span><select value={adoptedOptionId || ''} disabled={locked} onChange={e => { const perspective = latestAnalysis?.result.perspectives.find(p => p.id === e.target.value); setAdoptedOptionId(perspective?.id || null); if (perspective) setFinalText(perspective.plan); }}><option value="">未选具体角度，由我综合整理</option>{latestAnalysis?.result.perspectives.map(p => <option key={p.id} value={p.id}>{p.angleType} · {p.title}</option>)}</select></label>}<TextArea label="最终安排" rows={7} maxLength={12000} value={finalText} onValue={setFinalText} readOnly={finalMode === 'maintain'} disabled={locked} hint={finalMode === 'maintain' ? '原样保留初步打算。若需独立修改，请先返回修改初步打算。' : '请修改到你愿意执行的程度，再确认。'} />{full && <label className="field followup-control"><span className="field-title">预计何时能看到结果？</span><select disabled={locked} value={followupDays ?? 'none'} onChange={e => setFollowupDays(e.target.value === 'none' ? null : Number(e.target.value) as 14 | 30 | 90)}><option value={14}>2 周后</option><option value={30}>1 个月后</option><option value={90}>3 个月后</option><option value="none">不设回访</option></select></label>}<FormError message={error} /><div className="modal-actions"><button className="secondary" disabled={locked} onClick={() => setModal(null)}>返回</button><button className="primary" disabled={locked || !finalText.trim()} onClick={confirmFinal}>{busy === 'final' ? <Spinner label="保存中…" /> : <><CheckCheck size={16} />确认决定</>}</button></div></Modal>}
    {modal === 'upgrade' && <Modal title="进入深度决策" onClose={() => setModal(null)} busy={locked}><p className="modal-intro">可关联员工画像，也可以不选。写下你的初步打算后，可以确认最终决定并跟进结果，原有分析仍会保留。</p><EmployeePicker employees={employees.filter(e => !e.archived)} selected={upgradeEmployees} disabled={locked} onToggle={id => setUpgradeEmployees(items => items.includes(id) ? items.filter(item => item !== id) : [...items, id])} onAdd={() => openEmployee('upgrade')} hint="可选；不关联也能分析。" /><TextArea label="初步打算和理由" rows={5} maxLength={8000} value={upgradePlan} onValue={setUpgradePlan} disabled={locked} placeholder="我准备……，因为……。" /><FormError message={error} /><div className="modal-actions"><button className="secondary" disabled={locked} onClick={() => setModal(null)}>暂不进入</button><button className="primary" disabled={locked || !meaningful(upgradePlan)} onClick={upgrade}>{busy === 'upgrade' ? <Spinner label="保存中…" /> : '进入并准备分析'}</button></div></Modal>}
    {modal === 'candidates' && <Modal title="确认要新增的员工画像" onClose={() => setModal(null)} busy={locked} wide><p className="modal-intro">以下内容从你本次描述中提取。确认后会新增一位员工并自动分配代号，请先核对是否与已有员工重复。</p>{candidates.map(candidate => <div className="profile-candidate" key={candidate.id}><h3>{candidate.alias} · {candidate.status === 'pending' ? '候选画像' : candidate.status === 'saved' ? '已新增为' + (employees.find(e => e.id === candidate.employeeId)?.alias || '员工画像') : '已跳过'}</h3><p className="field-hint">原文依据：{candidate.evidence}</p>{candidate.status === 'pending' ? <><TextArea label="准备新增的主观描述（可修改）" rows={3} maxLength={3000} value={candidateTexts[candidate.id] ?? candidate.description} onValue={text => setCandidateTexts(values => ({ ...values, [candidate.id]: text }))} disabled={locked} /><div className="button-group"><button className="primary" disabled={locked || !(candidateTexts[candidate.id] ?? candidate.description).trim()} onClick={() => resolveCandidate(candidate, 'save')}>确认新增员工</button><button className="text-button" disabled={locked} onClick={() => resolveCandidate(candidate, 'skip')}>跳过</button></div></> : <p>{candidate.description}</p>}</div>)}<FormError message={error} /><div className="modal-actions"><button className="secondary" disabled={locked} onClick={() => setModal(null)}>完成</button></div></Modal>}
    {modal === 'employee' && <Modal title="添加员工画像" onClose={() => setModal(employeeReturnTo)} busy={locked}><p className="modal-intro">使用昵称、职责和你的一句话观察；系统会另行生成员工代号。</p><label className="field"><span className="field-title">昵称</span><input autoFocus maxLength={80} value={employeeNickname} onChange={e => setEmployeeNickname(e.target.value)} placeholder="例如：小李" disabled={locked || Boolean(createdEmployee.current)} /></label><label className="field"><span className="field-title">职责</span><input maxLength={120} value={employeeRole} onChange={e => setEmployeeRole(e.target.value)} placeholder="例如：产品研发" disabled={locked || Boolean(createdEmployee.current)} /></label><TextArea label="我目前对他的看法" rows={4} maxLength={3000} value={employeeDescription} onValue={setEmployeeDescription} disabled={locked || Boolean(createdEmployee.current)} placeholder="例如：研发能力强，但处理跨部门分歧时比较直接。" /><FormError message={error} /><div className="modal-actions"><button className="secondary" disabled={locked} onClick={() => setModal(employeeReturnTo)}>返回</button><button className="primary" disabled={locked || !employeeNickname.trim() || !employeeRole.trim() || !employeeDescription.trim()} onClick={addEmployee}>{busy === 'employee' ? <Spinner label="保存中…" /> : '保存并选入本次决策'}</button></div></Modal>}
    {modal === 'delete' && <Modal title="删除这条决策？" onClose={() => setModal(null)} busy={locked}><p className="modal-intro">初步打算、分析、决定和反馈都将删除。已确认到员工档案中的内容及历史仍会保留。</p><FormError message={error} /><div className="modal-actions"><button className="secondary" disabled={locked} onClick={() => setModal(null)}>取消</button><button className="danger-button" disabled={locked} onClick={deleteDecision}>{busy ? <Spinner label="删除中…" /> : '确认删除'}</button></div></Modal>}
    {suggestion && <Modal title={suggestion.alias + ' · 确认画像修改'} onClose={() => setSuggestion(null)} busy={locked} wide><div className="profile-comparison"><div><h3>当前画像 · 第 {selectedEmployee?.version} 版</h3><p className="preserve-lines">{selectedEmployee?.description}</p></div><TextArea label="准备更新为（可修改）" rows={7} maxLength={3000} value={suggestionText} onValue={setSuggestionText} disabled={locked} /></div><div className="evidence-note"><strong>实际反馈依据</strong><p>{suggestion.evidence}</p><span>{suggestion.reason}</span></div>{changedProfile && <label className="consent-checkbox"><input type="checkbox" checked={acknowledge} disabled={locked} onChange={e => setAcknowledge(e.target.checked)} /><span>画像在建议生成后有修改。我已核对当前版本，确认以上内容。</span></label>}<FormError message={error} /><div className="modal-actions"><button className="secondary" disabled={locked} onClick={() => setSuggestion(null)}>暂不更新</button><button className="primary" disabled={locked || !selectedEmployee || !suggestionText.trim() || (changedProfile && !acknowledge)} onClick={() => resolveSuggestion(suggestion, 'accept')}>{busy === 'suggestion' ? <Spinner label="更新中…" /> : <><Check size={15} />确认更新</>}</button></div></Modal>}
  </div>;
}

function EmployeePicker({ employees, selected, disabled, onToggle, onAdd, hint }: { employees: Employee[]; selected: string[]; disabled: boolean; onToggle: (id: string) => void; onAdd: () => void; hint: string }) {
  return <div className="people-picker"><span><UsersRound size={15} />使用哪些员工画像？<small>{hint}</small></span><div className="people-chips">{employees.map(e => <button key={e.id} type="button" disabled={disabled} aria-pressed={selected.includes(e.id)} className={selected.includes(e.id) ? 'person-chip selected' : 'person-chip'} title={e.description} onClick={() => onToggle(e.id)}>{e.alias}{e.archived ? '（已归档）' : ''}{selected.includes(e.id) && <Check size={12} />}</button>)}<button className="person-chip add" disabled={disabled} onClick={onAdd}><Plus size={13} />添加画像</button></div></div>;
}

function CallPayloads({ value, compact = false }: { value: unknown; compact?: boolean }) {
  const payload = value as { independent?: unknown; risk?: unknown };
  if (!payload || typeof payload !== 'object' || !('independent' in payload)) return <PayloadView value={value} />;
  return <div className="call-payloads"><div className="payload-call"><strong>① 独立方案</strong><p className="field-hint">发送背景、选中画像和问题，不包含初步打算。</p><details open={compact ? undefined : true}><summary>查看独立方案的实际发送内容</summary><PayloadView value={payload.independent} /></details></div><div className="payload-call"><strong>② 初步打算风险检查</strong>{payload.risk ? <><p className="field-hint">单独发送必要背景与初步打算，只检查风险与遗漏。</p><details open={compact ? undefined : true}><summary>查看风险检查的实际发送内容</summary><PayloadView value={payload.risk} /></details></> : <p className="field-hint">未写初步打算，本次不发起风险检查。</p>}</div></div>;
}

function AnalysisWarnings({ analysis }: { analysis: Analysis }) {
  return <>{!meaningful(analysis.snapshot.initialPlan) && <p className="independent-note">未写初步打算：本次提供备选角度，不评价你的原方案。</p>}{analysis.result.riskError && <p className="inline-warning">独立方案已完成，风险检查未完成：{analysis.result.riskError}</p>}{analysis.result.qualityFlags.angleTypesDuplicated && <p className="inline-warning">本次未能生成足够的差异化角度。以下保留真实结果，可重新分析。</p>}{analysis.result.qualityFlags.degraded && !analysis.result.qualityFlags.angleTypesDuplicated && !analysis.result.riskError && <p className="inline-warning">本次分析部分完成，请结合信息缺口判断，或重新分析。</p>}</>;
}

function ChoiceRecord({ decision, finalId }: { decision: Decision; finalId: string }) {
  const final = decision.finals.find(f => f.id === finalId);
  if (!final) return null;
  const option = final.adoptedOptionId ? decision.analyses.find(a => a.id === final.analysisId)?.result.perspectives.find(p => p.id === final.adoptedOptionId) : null;
  return <p className="choice-record">当时的选择：{modeLabels[final.mode]}{option ? ' · ' + (option.angleType || '历史角度') + '「' + option.title + '」' : final.mode === 'maintain' ? '' : ' · 未指定具体角度'}</p>;
}

function PerspectiveCard({ perspective: p, index, disabled, canChoose, onChoose }: { perspective: Analysis['result']['perspectives'][number]; index: number; disabled: boolean; canChoose: boolean; onChoose: () => void }) {
  return <article className="perspective-card"><div className="perspective-eyebrow"><span>角度 {index + 1}</span><span className="angle-tag">{p.angleType || '历史记录'}</span></div><h3>{p.title}</h3><p className="perspective-plan">{p.plan}</p><div className="perspective-general-risk"><strong>该方案的风险</strong><p>{p.risks}</p></div><details><summary>依据与待确认事项<ChevronDown size={14} /></summary><div className="perspective-detail"><h4>用户描述是依据</h4><p>{p.basis}</p><h4>拍板前确认</h4><p>{p.questions}</p></div></details>{canChoose && <button className="text-button" disabled={disabled} onClick={onChoose}>采用此角度起草<ArrowRight size={14} /></button>}</article>;
}
