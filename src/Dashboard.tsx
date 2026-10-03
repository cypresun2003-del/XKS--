import { useState } from 'react';
import { Clock3, Search, Plus, BookOpen, PencilLine, Trash2 } from 'lucide-react';
import { statusLabels, type Decision } from '../shared/model';
import type { PageProps } from './App';
import { api, dateText, errorText } from './api';
import { EmptyState, FormError, Modal, Spinner } from './ui';

const filters = [
  { key: 'all', label: '全部' }, { key: 'draft', label: '思考中' },
  { key: 'analyzed', label: '待确认' }, { key: 'decided', label: '已确认' }, { key: 'reviewed', label: '已复盘' },
];
const isDue = (decision: Decision) => { const f = decision.finals.at(-1)?.followup; return decision.channel === 'full' && f?.status === 'pending' && Boolean(f.dueAt) && Date.parse(f.dueAt!) <= Date.now(); };

export default function Dashboard({ data, navigate, refresh, notify }: PageProps) {
  const [filter, setFilter] = useState('all'), [search, setSearch] = useState(''), [deleting, setDeleting] = useState<Decision | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const query = search.trim().toLowerCase();
  const records = data.decisions.filter(d => (filter === 'all' || (filter === 'due' ? isDue(d) : d.status === filter)) && (d.title + ' ' + d.problem).toLowerCase().includes(query));
  const due = data.decisions.filter(isDue).length;
  async function remove() {
    if (!deleting) return;
    setBusy(true); setError('');
    try {
      await api('/decisions/' + deleting.id, 'DELETE', undefined, { 'X-Decision-Revision': String(deleting.revision) });
      setDeleting(null); notify('决策记录已删除。');
      try { await refresh(); } catch { /* Committed delete; only retry reading. */ }
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <div className="page library-page">
    <div className="page-heading"><div><h1>决策库</h1><p className="page-description">每一个决定，都可以继续思考和回看。</p></div><button className="primary" onClick={() => navigate('/')}><Plus size={16} />新建决策</button></div>
    <section className="journal-section"><div className="section-heading"><div className="library-summary"><h2>全部记录<span>{data.decisions.length}</span></h2>{due > 0 && <button className={'text-button due-filter ' + (filter === 'due' ? 'selected' : '')} onClick={() => setFilter(filter === 'due' ? 'all' : 'due')}><Clock3 size={14} />{due} 条待回访</button>}</div><label className="search-box"><Search size={16} /><input aria-label="搜索决策" placeholder="搜索决策" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
      <div className="filter-tabs" role="tablist" aria-label="决策状态">{filters.map(item => <button key={item.key} role="tab" aria-selected={filter === item.key} className={filter === item.key ? 'selected' : ''} onClick={() => setFilter(item.key)}>{item.label}<small>{item.key === 'all' ? data.decisions.length : data.decisions.filter(d => d.status === item.key).length}</small></button>)}</div>
      {records.length ? <div className="decision-list"><div className="decision-list-head" aria-hidden="true"><span>状态</span><span>决策名</span><span>关联员工</span><span>更新日期</span><span>操作</span></div>{records.map(d => {
        const names = d.employeeIds.map(id => data.employees.find(e => e.id === id)).filter(e => e !== undefined).map(e => e.nickname || e.alias);
        const title = d.title || '未命名决策';
        return <article className="decision-row" key={d.id} aria-label={title}>
          <span className={'status status-' + d.status}><i />{statusLabels[d.status]}</span>
          <button className="decision-row-title" title={title} onClick={() => navigate('/decisions/' + d.id)}>{title}{isDue(d) && <small>待回访</small>}</button>
          <span className="decision-row-people" title={names.join('、') || '未关联员工'}>{names.length ? names.slice(0, 2).join('、') + (names.length > 2 ? ' +' + (names.length - 2) : '') : '未关联员工'}</span>
          <time className="decision-row-date" dateTime={d.updatedAt} title={dateText(d.updatedAt, true)}>{dateText(d.updatedAt)}</time>
          <div className="decision-row-actions"><button className="text-button" onClick={() => navigate('/decisions/' + d.id)}><PencilLine size={14} />编辑</button><button className="danger-text" onClick={() => { setDeleting(d); setError(''); }}><Trash2 size={14} />删除</button></div>
        </article>;
      })}</div> : <EmptyState icon={<BookOpen size={24} />} title={data.decisions.length ? '没有匹配的记录' : '决策库还是空的'} action={!data.decisions.length && <button className="secondary" onClick={() => navigate('/')}><Plus size={15} />写下第一个问题</button>}>{data.decisions.length ? '换一个关键词或状态试试。' : '首页可以直接开始。'}</EmptyState>}
    </section>
    {deleting && <Modal title="删除这条决策？" onClose={() => setDeleting(null)} busy={busy}><p>将删除“{deleting.title || '未命名决策'}”及其分析、确认和复盘记录。已确认的员工画像更新不会撤销。</p><FormError message={error} /><div className="modal-actions"><button className="secondary" disabled={busy} onClick={() => setDeleting(null)}>取消</button><button className="danger-button" disabled={busy} onClick={remove}>{busy ? <Spinner label="删除中…" /> : '确认删除决策'}</button></div></Modal>}
  </div>;
}
