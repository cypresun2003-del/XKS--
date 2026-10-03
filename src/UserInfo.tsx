import { useState } from 'react';
import { Check, UserRound } from 'lucide-react';
import type { PageProps } from './App';
import { api, errorText } from './api';
import { FormError, PrivacyNote, Spinner, TextArea } from './ui';

export default function UserInfo({ data, refresh, notify }: PageProps) {
  const [nickname, setNickname] = useState(data.context.nickname), [industry, setIndustry] = useState(data.context.industry), [persona, setPersona] = useState(data.context.persona);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save() {
    setBusy(true); setError('');
    try { await api('/context', 'PUT', { nickname, industry, persona }); await refresh(); notify('用户信息已保存在本机。'); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  return <div className="page settings-page user-info-page">
    <div className="page-heading"><div><h1>用户信息</h1><p className="page-description">用一句话让参谋了解你的日常决策情境。</p></div></div>
    <section className="settings-card user-info-card">
      <header><span className="section-icon"><UserRound size={20} /></span><div><h2>关于你</h2><p>你填写的称呼和工作情境会作为分析背景。</p></div></header>
      <label className="field"><span className="field-title">昵称</span><input maxLength={80} value={nickname} onChange={event => setNickname(event.target.value)} placeholder="AI 回复时如何称呼你" /></label>
      <label className="field"><span className="field-title">所在行业</span><input maxLength={120} value={industry} onChange={event => setIndustry(event.target.value)} placeholder="例如：机器人行业" /></label>
      <TextArea label="用一句话介绍你的日常决策画像" rows={4} maxLength={2000} value={persona} onValue={setPersona} placeholder="例如：我负责机器人在学校的销售，主要安排渠道合作和项目交付。" hint="会作为分析背景，不需要写公司名称或真实人名。" />
      <FormError message={error} />
      <div className="section-actions"><span className="muted">只填写昵称、行业和一句介绍。</span><button className="primary" disabled={busy} onClick={save}>{busy ? <Spinner label="保存中…" /> : <><Check size={15} />保存用户信息</>}</button></div>
    </section>
    <PrivacyNote />
  </div>;
}
