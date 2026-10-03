import { useState } from 'react';
import { ArrowRight, ArrowUpRight, Clock3, Search, Plus, BookOpen } from 'lucide-react';
import { statusLabels, type Decision } from '../shared/model';
import type { PageProps } from './App';
import { dateText } from './api';
import { EmptyState } from './ui';

const filters = [
  { key: 'all', label: '全部' }, { key: 'draft', label: '思考中' },
  { key: 'analyzed', label: '待确认' }, { key: 'decided', label: '已确认' }, { key: 'reviewed', label: '已复盘' },
];

export default function Dashboard({ data, navigate }: PageProps) {
  const [filter, setFilter] = useState('all'), [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const records = data.decisions.filter(decision => (filter === 'all' || decision.status === filter) && (decision.title + ' ' + decision.problem).toLowerCase().includes(query));
  const due = data.decisions.filter(decision => {
    const followup = decision.finals.at(-1)?.followup;
    return (decision.channel || 'full') === 'full' && followup?.status === 'pending' && Boolean(followup.dueAt) && Date.parse(followup.dueAt!) <= Date.now();
  }).sort((a, b) => Date.parse(a.finals.at(-1)!.followup!.dueAt!) - Date.parse(b.finals.at(-1)!.followup!.dueAt!));

  return <div className="page library-page">
    <div className="page-heading"><div><h1>决策库</h1><p className="page-description">正在思考、待确认和已经完成的决策都保存在这里。</p></div><button className="primary" onClick={() => navigate('/')}><Plus size={16} />新建决策</button></div>
    {due.length > 0 && <section className="followup-section" aria-label="待回访"><div className="section-heading"><div><h2><Clock3 size={18} />待回访<span>{due.length}</span></h2><p>记录实际结果，继续完善你的决策判断。</p></div></div><div className="followup-list">{due.map(decision => <button key={decision.id} className="followup-row" onClick={() => navigate('/decisions/' + decision.id)}><div><strong>{decision.title || '未命名决策'}</strong><span>预计回访 {dateText(decision.finals.at(-1)!.followup!.dueAt!)}</span></div><span>填写结果<ArrowRight size={16} /></span></button>)}</div></section>}
    <section className="journal-section"><div className="section-heading"><div><h2>全部记录<span>{data.decisions.length}</span></h2></div><label className="search-box"><Search size={16} /><input aria-label="搜索决策" placeholder="搜索问题" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
      <div className="filter-tabs" role="tablist" aria-label="决策状态">{filters.map(item => <button key={item.key} role="tab" aria-selected={filter === item.key} className={filter === item.key ? 'selected' : ''} onClick={() => setFilter(item.key)}>{item.label}<small>{item.key === 'all' ? data.decisions.length : data.decisions.filter(decision => decision.status === item.key).length}</small></button>)}</div>
      {records.length ? <div className="decision-grid">{records.map(decision => <DecisionCard key={decision.id} decision={decision} navigate={navigate} names={data.employees.filter(employee => decision.employeeIds.includes(employee.id)).map(employee => employee.nickname || employee.alias)} />)}</div> : <EmptyState icon={<BookOpen size={24} />} title={data.decisions.length ? '没有匹配的记录' : '决策库还是空的'} action={!data.decisions.length && <button className="secondary" onClick={() => navigate('/')}><Plus size={15} />写下第一个问题</button>}>{data.decisions.length ? '换一个关键词或状态试试。' : '首页的大输入区可以直接开始。'}</EmptyState>}
    </section>
  </div>;
}

function DecisionCard({ decision, navigate, names }: { decision: Decision; navigate: (path: string) => void; names: string[] }) {
  return <button className="decision-card" onClick={() => navigate('/decisions/' + decision.id)}><div className="card-top"><span className={'status status-' + decision.status}><i />{statusLabels[decision.status]}</span><ArrowUpRight size={15} /></div><h3>{decision.title || '未命名决策'}</h3><p>{decision.finals.at(-1)?.text || decision.problem || '尚未填写问题'}</p><div className="card-people">{names.length ? names.slice(0, 3).map(name => <span key={name}>{name}</span>) : <span>未关联员工</span>}</div><div className="card-footer"><span>{dateText(decision.updatedAt)}</span><span>{decision.finals.length ? '已确认 · 第 ' + decision.finals.length + ' 版' : '点击继续'}</span></div></button>;
}
