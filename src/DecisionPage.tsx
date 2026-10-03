import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, PencilLine, Sparkles, ThumbsUp } from 'lucide-react';
import { meaningfulInitialPlan, resultStatusLabels, type Decision, type ProfileSuggestion, type Review } from '../shared/model';
import type { PageProps } from './App';
import { api, dateText, errorText } from './api';
import { FormError, Modal, Spinner, TextArea } from './ui';
import { useDecision } from './useDecision';
import { SupportLink } from './Support';
import EmployeeSelection from './EmployeeSelection';

type ResultStatus = keyof typeof resultStatusLabels;
function ReadableText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 240;
  return <div><p className={'angle-text preserve-lines' + (long && !expanded ? ' angle-collapsed' : '')}>{text}</p>{long && <button className="text-button expand-text" onClick={() => setExpanded(!expanded)}>{expanded ? '收起全文' : '展开全文'}</button>}</div>;
}

export default function DecisionPage({ decisionId, data, refresh, notify, navigate, analyzeOnOpen = false, registerGuard, onHelpfulRecorded }: PageProps & { decisionId: string; analyzeOnOpen?: boolean; registerGuard: (fn: (() => Promise<void>) | null) => void; onHelpfulRecorded: () => void }) {
  const { decision, draft, update, save, apply, loadError, refreshAfterWrite } = useDecision(decisionId, refresh, notify, registerGuard);
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [modal, setModal] = useState<'edit' | 'done' | null>(null);
  const [outcome, setOutcome] = useState(''), [resultStatus, setResultStatus] = useState<ResultStatus | null>(null);
  const [suggestion, setSuggestion] = useState<ProfileSuggestion | null>(null), [suggestionText, setSuggestionText] = useState(''), [acknowledge, setAcknowledge] = useState(false);
  const autoStarted = useRef(false), working = useRef(false), mounted = useRef(true);
  const requestIds = useRef(new Map<string, string>());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const requestId = (key: string) => { if (!requestIds.current.has(key)) requestIds.current.set(key, crypto.randomUUID()); return requestIds.current.get(key)!; };
  const reviewMode = !analyzeOnOpen && Boolean(decision && decision.channel === 'full' && ['helpful', 'decided', 'reviewed'].includes(decision.status));
  const recordedSelection = decision?.helpfulSelections.at(-1);
  const analysis = reviewMode && recordedSelection ? decision?.analyses.find(a => a.id === recordedSelection.analysisId) : decision?.analyses.at(-1);
  const reviewSection = useRef<HTMLElement>(null);
  const [addingFeedback, setAddingFeedback] = useState(false);
  const selectedProfile = data.employees.find(e => e.id === suggestion?.employeeId);
  const changedProfile = Boolean(suggestion && selectedProfile && suggestion.baseVersion !== selectedProfile.version);
  const locked = Boolean(busy);
  const currentAnalysis = Boolean(analysis && decision?.status !== 'draft');

  async function accept(next: Decision) { apply(next); await refreshAfterWrite(); }
  async function generate(current: Decision, review?: Review) {
    const root = '/decisions/' + decisionId;
    const preview = await api<{ fingerprint: string }>(review ? root + '/reviews/' + review.id + '/preview' : root + '/analysis-preview');
    const key = [review?.id || 'analysis', current.revision, preview.fingerprint].join(':');
    const next = await api<Decision>(review ? root + '/reviews/' + review.id + '/analyze' : root + '/analyze', 'POST', { fingerprint: preview.fingerprint, revision: current.revision, requestId: requestId(key), consent: true });
    await accept(next);
  }
  async function analyze() {
    if (working.current) return;
    working.current = true; setBusy('analysis'); setError('');
    try { const current = await save(); setModal(null); await generate(current); }
    catch (e) { if (mounted.current) setError(errorText(e)); }
    finally { working.current = false; if (mounted.current) setBusy(''); }
  }
  useEffect(() => {
    if (analyzeOnOpen && decision && !autoStarted.current) { autoStarted.current = true; if (decision.status === 'draft') void analyze(); }
  }, [analyzeOnOpen, decision]);

  async function markHelpful(source: 'original' | 'ai', perspectiveId: string | null = null) {
    if (working.current || !analysis) return;
    working.current = true; setBusy('helpful'); setError('');
    try {
      const current = await save();
      await accept(await api<Decision>('/decisions/' + decisionId + '/helpful', 'POST', { source, analysisId: analysis.id, perspectiveId, revision: current.revision, requestId: requestId(['helpful', analysis.id, source, perspectiveId].join(':')) }));
      onHelpfulRecorded();
      if (mounted.current) setModal('done');
    } catch (e) { if (mounted.current) setError(errorText(e)); }
    finally { working.current = false; if (mounted.current) setBusy(''); }
  }
  async function saveFeedback() {
    if (working.current || !resultStatus) return;
    working.current = true; setBusy('feedback'); setError('');
    try {
      const current = await save();
      const next = await api<Decision>('/decisions/' + decisionId + '/reviews', 'POST', { resultStatus, outcome, revision: current.revision });
      await accept(next); setOutcome(''); setAddingFeedback(false);
      if (resultStatus !== 'pending') { setBusy('review'); await generate(next, next.reviews.at(-1)!); }
      notify(resultStatus === 'pending' ? '已记录，等有实际结果后再来反馈。' : '复盘已生成，请查看总结和画像建议，再确认完成。');
    } catch (e) { setError(errorText(e)); }
    finally { working.current = false; setBusy(''); }
  }
  async function retryReview(review: Review) {
    if (working.current) return;
    working.current = true; setBusy('review'); setError('');
    try { await generate(await save(), review); } catch (e) { setError(errorText(e)); }
    finally { working.current = false; setBusy(''); }
  }
  async function confirmReview(review: Review) {
    if (working.current) return;
    working.current = true; setBusy('confirm'); setError('');
    try {
      const current = await save();
      await accept(await api<Decision>('/decisions/' + decisionId + '/reviews/' + review.id + '/confirm', 'POST', { revision: current.revision }));
      notify('复盘已确认，已移入“已复盘”。');
      navigate('/library');
    } catch (e) { setError(errorText(e)); }
    finally { working.current = false; setBusy(''); }
  }
  async function keepProfile(item: ProfileSuggestion) {
    if (working.current) return;
    working.current = true; setBusy('suggestion'); setError('');
    try {
      const current = await save();
      await accept(await api<Decision>('/decisions/' + decisionId + '/suggestions/' + item.id + '/resolve', 'POST', { action: 'reject', revision: current.revision }));
    } catch (e) { setError(errorText(e)); }
    finally { working.current = false; setBusy(''); }
  }
  async function openSuggestion(item: ProfileSuggestion) {
    setError('');
    try { await refresh(); setSuggestion(item); setSuggestionText(item.proposedDescription); setAcknowledge(false); } catch (e) { setError(errorText(e)); }
  }
  async function resolveSuggestion(action: 'accept' | 'reject') {
    if (!suggestion || working.current) return;
    working.current = true; setBusy('suggestion'); setError('');
    try {
      const current = await save();
      await accept(await api<Decision>('/decisions/' + decisionId + '/suggestions/' + suggestion.id + '/resolve', 'POST', { action, revision: current.revision, ...(action === 'accept' ? { description: suggestionText, expectedVersion: selectedProfile?.version, acknowledgeChanged: acknowledge } : {}) }));
      setSuggestion(null); notify(action === 'accept' ? '已按你的确认更新画像，旧版本已保留。' : '已保留原画像。');
    } catch (e) { setError(errorText(e)); } finally { working.current = false; setBusy(''); }
  }
  if (!decision) return <div className="loading-page">{loadError ? <FormError message={loadError} /> : <Spinner label="正在打开记录…" />}</div>;
  const employees = analysis && currentAnalysis ? analysis.snapshot.employees : data.employees.filter(e => draft.employeeIds.includes(e.id));
  const currentReviews = decision.reviews.filter(r => recordedSelection ? r.selectionId === recordedSelection.id : r.finalId === decision.finals.at(-1)?.id);
  const latestReview = currentReviews.at(-1);
  const showFeedback = reviewMode && (!latestReview || latestReview.resultStatus === 'pending' || addingFeedback);
  const selectionMatches = recordedSelection?.analysisId === analysis?.id;
  const feedbackLabels: Record<ResultStatus, string> = { smooth: '效果符合预期', mixed: '部分有效', problem: '未达预期', pending: '还没结果' };
  const ownerPlan = currentAnalysis ? analysis!.snapshot.initialPlan : draft.initialPlan;
  const problem = currentAnalysis ? analysis!.snapshot.problem : draft.problem;
  const recentSelection = decision.helpfulSelections.at(-1);

  return <div className="page focused-results">
    <div className="result-toolbar"><button className="text-button" disabled={locked} onClick={() => navigate('/library')}><ArrowLeft size={14} />决策库</button><div>{reviewMode && <button className="primary" disabled={locked} onClick={() => reviewSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{latestReview?.summary ? '查看复盘与确认' : '回看与反馈'}</button>}<button className="text-button" disabled={locked} onClick={() => { setError(''); setModal('edit'); }}><PencilLine size={14} />编辑</button></div></div>
    <section className="result-question"><span className="result-eyebrow">这次的问题</span><ReadableText text={problem || '还没有填写问题'} /></section>
    <p className="result-meta">{employees.length ? '关联员工：' + employees.map(e => e.nickname || e.alias).join('、') : '未关联员工画像'}{recentSelection && currentAnalysis && <span> · 已记录有帮助的角度</span>}</p>
    {!reviewMode && !modal && !suggestion && <><FormError message={error} />{error && <SupportLink />}</>}
    {busy === 'analysis' ? <div className="analysis-progress" role="status"><Spinner label="正在从三个角度看这件事…" /><p>你的初判已保留，不会提供给本次 AI 分析。</p></div> : <>
      <div className="helpfulness-caption">{reviewMode ? '当时的判断与参考角度' : '哪个角度对你有帮助？'}<span>{reviewMode ? '已标出当时认为有帮助的角度' : '记录参考，不代表最终采纳'}</span></div>
      <div className="angle-list">
        <article className="angle-row owner-angle"><div className="angle-content"><div className="angle-heading"><span className="angle-index">你</span><h3>你的初步判断</h3><small>保留原文</small></div><ReadableText text={ownerPlan || '请先补充你的初步判断。'} /></div>{reviewMode ? selectionMatches && recentSelection?.source === 'original' && <span className="recorded-angle"><Check size={15} />当时选了这个</span> : <button className="helpful-button" disabled={locked || !currentAnalysis || !ownerPlan.trim()} onClick={() => markHelpful('original')}><ThumbsUp size={15} />有帮助</button>}</article>
        {currentAnalysis && analysis!.result.perspectives.map((p, index) => <article className={'angle-row ai-angle' + (reviewMode && selectionMatches && recentSelection?.perspectiveId === p.id ? ' recorded-row' : '')} key={p.id}><div className="angle-content"><div className="angle-heading"><span className="angle-index">0{index + 1}</span><h3>{p.title}</h3></div><ReadableText text={p.plan} /></div>{reviewMode ? selectionMatches && recentSelection?.perspectiveId === p.id && <span className="recorded-angle"><Check size={15} />当时选了这个</span> : <button className="helpful-button" disabled={locked} onClick={() => markHelpful('ai', p.id)}><ThumbsUp size={15} />有帮助</button>}</article>)}
      </div>
      {!currentAnalysis && <div className="result-start"><button className="primary" disabled={locked || !draft.problem.trim() || !meaningfulInitialPlan(draft.initialPlan)} onClick={analyze}><Sparkles size={15} />{analysis ? '按修改后的内容分析' : '分析三个角度'}</button>{(!draft.problem.trim() || !meaningfulInitialPlan(draft.initialPlan)) && <p className="field-hint">点“编辑”补充问题和初步判断。</p>}</div>}
    </>}
    {reviewMode && <section className="review-workspace" ref={reviewSection} aria-label="回看与反馈">
      <header><h2>{latestReview?.confirmedAt ? '已完成的复盘' : '回看与反馈'}</h2><p>结合实际效果，回看当时的判断；画像是否修改，由你决定。</p></header>
      {showFeedback && <div className="inline-feedback">
        <h3>这次的效果怎么样？</h3>
        <div className="review-result-options">{Object.entries(feedbackLabels).map(([value, label]) => <button disabled={locked} aria-pressed={resultStatus === value} className={resultStatus === value ? 'selected' : ''} key={value} onClick={() => setResultStatus(value as ResultStatus)}>{label}</button>)}</div>
        <TextArea label="补充反馈（可选）" value={outcome} onValue={setOutcome} disabled={locked} rows={3} maxLength={8000} placeholder="实际采用了什么做法？哪些有效，哪些细节需要调整？" />
        <div className="review-submit"><p>可以只选择效果。有具体反馈时，复盘和画像建议会更有依据。</p><button className="primary" disabled={locked || !resultStatus} onClick={saveFeedback}>{locked ? <Spinner label="正在处理…" /> : resultStatus === 'pending' ? '记录进展' : '生成完整复盘'}</button></div>
      </div>}
      {busy === 'review' && <div className="analysis-progress" role="status"><Spinner label="正在结合实际反馈生成完整复盘…" /></div>}
      {latestReview && <article className="feedback-record">
        <div className="review-block"><h3>你的实际反馈</h3><small>{dateText(latestReview.createdAt)} · {latestReview.resultStatus ? feedbackLabels[latestReview.resultStatus] : '历史反馈'}</small><ReadableText text={latestReview.outcome} /></div>
        {latestReview.summary ? <>
          <div className="review-block"><h3>这次决策的完整复盘</h3><p className="review-summary preserve-lines">{latestReview.summary}</p></div>
          {employees.length > 0 && <div className="review-block"><h3>员工画像调整建议</h3>{latestReview.suggestions.length === 0 && <p className="review-empty">这次反馈没有足够依据修改员工画像，保留现有描述。</p>}{latestReview.suggestions.map(s => <div className="compact-suggestion" key={s.id}>
            <div><strong>{data.employees.find(e => e.id === s.employeeId)?.nickname || s.alias}</strong><p className="suggestion-description">{s.appliedDescription || s.proposedDescription}</p><small>{s.reason}</small><p className="field-hint">{s.status === 'accepted' ? '画像已更新' : s.status === 'rejected' ? '已保留原画像' : '仅为建议，尚未修改画像'}</p></div>
            {s.status === 'pending' && <div className="suggestion-actions"><button className="secondary" disabled={locked} onClick={() => openSuggestion(s)}><PencilLine size={14} />查看并修改</button><button className="text-button" disabled={locked} onClick={() => keepProfile(s)}>保留原画像</button></div>}
          </div>)}</div>}
          <div className="review-confirmation">{latestReview.confirmedAt ? <p><Check size={16} />已于 {dateText(latestReview.confirmedAt)} 确认完成复盘</p> : <><p>{latestReview.suggestions.some(s => s.status === 'pending') ? '请先选择修改画像或保留原画像，再确认完成。' : '看完总结后确认，记录才会移入“已复盘”。'}</p><button className="primary" disabled={locked || latestReview.suggestions.some(s => s.status === 'pending')} onClick={() => confirmReview(latestReview)}><Check size={16} />确认完成复盘</button></>}</div>
        </> : latestReview.resultStatus !== 'pending' && busy !== 'review' && <div className="review-block"><p>反馈已保存，复盘尚未生成。</p><button className="primary" disabled={locked} onClick={() => retryReview(latestReview)}>重新生成复盘</button></div>}
        {!showFeedback && <button className="text-button" disabled={locked} onClick={() => { setAddingFeedback(true); setResultStatus(null); setOutcome(''); }}>补充新的实际反馈</button>}
      </article>}
      <FormError message={error} />{error && <SupportLink />}
      {decision.reviews.length > 1 && <details className="result-history"><summary>之前的反馈与复盘</summary>{decision.reviews.slice(0, -1).reverse().map(r => <article className="feedback-record" key={r.id}><small>{dateText(r.createdAt)}</small><ReadableText text={r.outcome} />{r.summary && <p className="review-summary">{r.summary}</p>}</article>)}</details>}
    </section>}
    {!analyzeOnOpen && (decision.analyses.length > 1 || decision.finals.length > 0 || decision.helpfulSelections.length > 0) && <details className="result-history"><summary>查看历史记录</summary>{decision.helpfulSelections.map(s => <div className="feedback-record" key={s.id}><small>{dateText(s.createdAt, true)} · {s.source === 'original' ? '自己的初判' : 'AI 角度'}有帮助</small><ReadableText text={s.text} /></div>)}{decision.finals.map(f => <div className="feedback-record" key={f.id}><small>{dateText(f.createdAt, true)} · 之前确认的决定</small><ReadableText text={f.text} /></div>)}{decision.analyses.slice(0, -1).map(a => <details className="feedback-record" key={a.id}><summary>{dateText(a.createdAt, true)} · 之前的分析</summary>{a.result.perspectives.map(p => <div key={p.id}><h4>{p.title}</h4><ReadableText text={p.plan} /></div>)}</details>)}</details>}

    {modal === 'edit' && <Modal title="编辑这次问题" onClose={() => setModal(null)} busy={locked}><label className="field"><span className="field-title">决策名称</span><input value={draft.title} maxLength={100} onChange={e => update({ title: e.target.value })} /></label><TextArea label="你遇到了什么问题？" value={draft.problem} onValue={problem => update({ problem })} maxLength={8000} rows={4} /><TextArea label="你打算怎么做？" value={draft.initialPlan} onValue={initialPlan => update({ initialPlan })} maxLength={8000} rows={3} /><details><summary>关联员工与补充背景（可选）</summary><EmployeeSelection employees={data.employees} groups={data.groups} selected={draft.employeeIds} onChange={employeeIds => update({ employeeIds })} /><TextArea label="补充背景" value={draft.temporaryContext} onValue={temporaryContext => update({ temporaryContext })} maxLength={4000} rows={2} /></details><FormError message={error} /><div className="modal-actions"><button className="secondary" disabled={locked} onClick={async () => { try { await save(); setModal(null); } catch (e) { setError(errorText(e)); } }}>保存</button><button className="primary" disabled={locked || !draft.problem.trim() || !meaningfulInitialPlan(draft.initialPlan)} onClick={analyze}>保存并分析</button></div></Modal>}
    {modal === 'done' && <Modal title="希望能帮助到你" onClose={() => navigate('/')}><div className="completion-mark"><Check size={26} /></div><p className="completion-text">已记入决策库。之后可以回来反馈实际做法与结果，帮助你校准判断、补充员工画像，让后续分析更贴合情况。</p><p className="field-hint">画像修正建议仍由你确认，不会自动更新。</p><div className="modal-actions"><button className="primary" onClick={() => navigate('/')}>完成</button></div></Modal>}
    {suggestion && <Modal title="确认画像修正建议" busy={locked} onClose={() => setSuggestion(null)} wide><div className="profile-comparison"><div><h3>目前的画像</h3><p>{selectedProfile?.description}</p></div><TextArea label="建议修改为（可以编辑）" value={suggestionText} onValue={setSuggestionText} maxLength={3000} rows={5} /></div><div className="evidence-note"><strong>来自你的实际反馈</strong><p>{suggestion.evidence}</p><span>{suggestion.reason}</span></div>{changedProfile && <label className="consent-checkbox"><input type="checkbox" checked={acknowledge} onChange={e => setAcknowledge(e.target.checked)} />画像已有新版本，我已核对当前内容。</label>}<FormError message={error} /><div className="modal-actions"><button className="secondary" disabled={locked} onClick={() => resolveSuggestion('reject')}>保留原画像</button><button className="primary" disabled={locked || !suggestionText.trim() || !selectedProfile || selectedProfile.archived || (changedProfile && !acknowledge)} onClick={() => resolveSuggestion('accept')}>确认更新画像</button></div></Modal>}
  </div>;
}
