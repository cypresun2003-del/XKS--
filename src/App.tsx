import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, UsersRound, Settings2, X, CircleHelp, UserRound } from 'lucide-react';
import type { Bootstrap, Decision, DraftInput } from '../shared/model';
import { api, errorText } from './api';
import { DataBadge, Spinner, Modal } from './ui';
import Dashboard from './Dashboard';
import Team from './Team';
import Settings from './Settings';
import DecisionPage from './DecisionPage';
import Composer from './Composer';
import UserInfo from './UserInfo';

export type Notify = (message: string, error?: boolean) => void;
export type ThemeMode = 'graphite' | 'blue';
export type PageProps = { data: Bootstrap; refresh: () => Promise<void>; notify: Notify; navigate: (path: string) => void; theme: ThemeMode; setTheme: (theme: ThemeMode) => void };
const getRoute = () => window.location.hash.slice(1) || '/';

export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null), [route, setRoute] = useState(getRoute), [failure, setFailure] = useState(''), [refreshFailure, setRefreshFailure] = useState('');
  const [theme, setTheme] = useState<ThemeMode>(() => { try { return localStorage.getItem('second-perspective-theme') === 'blue' ? 'blue' : 'graphite'; } catch { return 'graphite'; } });
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const [composerVersion, setComposerVersion] = useState(0);
  const creatingRef = useRef(false);
  const composerDecisionId = useRef<string | null>(null);
  const guard = useRef<null | (() => Promise<void>)>(null), toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committedRoute = useRef(route), navigationVersion = useRef(0), refreshVersion = useRef(0);
  const leaving = useRef<{ guard: () => Promise<void>; promise: Promise<void> } | null>(null);
  const notify = useCallback<Notify>((message, error = false) => { setToast({ message, error }); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), error ? 12000 : 4500); }, []);
  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    try {
      const next = await api<Bootstrap>('/bootstrap');
      if (version === refreshVersion.current) { setData(next); setFailure(''); setRefreshFailure(''); }
    } catch (error) {
      if (version === refreshVersion.current) setRefreshFailure('记录列表暂未刷新，页面仍显示上次加载的资料。已完成的保存无需再次提交。');
      throw error;
    }
  }, []);
  useEffect(() => { refresh().catch(e => setFailure(errorText(e))); return () => { if (toastTimer.current) clearTimeout(toastTimer.current); }; }, [refresh]);
  const saveBeforeLeaving = useCallback(() => {
    const currentGuard = guard.current;
    if (!currentGuard) return Promise.resolve();
    if (leaving.current?.guard === currentGuard) return leaving.current.promise;
    const entry = { guard: currentGuard, promise: Promise.resolve().then(currentGuard) };
    entry.promise = entry.promise.finally(() => { if (leaving.current === entry) leaving.current = null; });
    leaving.current = entry;
    return entry.promise;
  }, []);
  const changeRoute = useCallback(async (path: string, fromHistory = false) => {
    const version = ++navigationVersion.current;
    try {
      if (path !== committedRoute.current) await saveBeforeLeaving();
      if (version !== navigationVersion.current) return;
      // pushState does not emit hashchange, so button navigation runs the guard only once.
      if (!fromHistory && getRoute() !== path) window.history.pushState(window.history.state, '', '#' + path);
      committedRoute.current = path; setRoute(path);
    } catch (error) {
      if (version !== navigationVersion.current) return;
      // Keep the editor mounted and restore its URL without starting another transition.
      window.history.replaceState(window.history.state, '', '#' + committedRoute.current);
      notify('当前输入尚未保存，已留在本页。' + errorText(error), true);
    }
  }, [notify, saveBeforeLeaving]);
  useEffect(() => {
    const onHashChange = (event: HashChangeEvent) => {
      const path = new URL(event.newURL).hash.slice(1) || '/';
      if (path === getRoute()) void changeRoute(path, true);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [changeRoute]);
  const navigate = useCallback((path: string) => changeRoute(path), [changeRoute]);
  const chooseTheme = useCallback((next: ThemeMode) => { setTheme(next); try { localStorage.setItem('second-perspective-theme', next); } catch { /* Theme still applies for this visit. */ } }, []);
  const startDecision = useCallback(async (input: DraftInput) => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    try {
      const navigationAtStart = ++navigationVersion.current;
      await saveBeforeLeaving();
      if (navigationAtStart !== navigationVersion.current) return;
      const decision = await api<Decision>('/decisions', 'POST', input);
      composerDecisionId.current = decision.id;
      setData(current => current ? { ...current, decisions: [decision, ...current.decisions.filter(item => item.id !== decision.id)] } : current);
      try { await refresh(); } catch { /* The decision was saved; the refresh banner offers a read-only retry. */ }
      if (navigationAtStart === navigationVersion.current) await navigate('/decisions/' + decision.id + '?analyze=1');
      else notify('决策已保存，可在决策库中打开。');
    } finally { creatingRef.current = false; }
  }, [navigate, notify, refresh, saveBeforeLeaving]);
  const registerGuard = useCallback((fn: (() => Promise<void>) | null) => { guard.current = fn; }, []);
  const panel = route.startsWith('/decisions/') ? 'decision' : (['profile', 'team', 'library', 'settings'].find(item => route === '/' + item) || null);
  const active = panel || 'home';
  const props = data ? { data, refresh, notify, navigate, theme, setTheme: chooseTheme } : null;
  const openPanel = (next: 'profile' | 'team' | 'library' | 'settings') => { void navigate('/' + next); };
  const closePanel = () => { void navigate('/'); };
  return <div className="app-shell" data-theme={theme}>
    <header className="workspace-header">
      <button className="brand" onClick={() => navigate('/')} aria-label="第二视角首页"><i className="brand-mark" aria-hidden="true" /><span>第二视角<small>个人决策助手</small></span></button>
      <p className="topbar-advisory">AI 提供参考，决策由你确认</p>
      <DataBadge />
    </header>
    <aside className="sidebar">
      <nav aria-label="主导航" data-guide="navigation">
        <button className={active === 'profile' ? 'nav-item nav-profile active' : 'nav-item nav-profile'} data-guide="profile" onClick={() => openPanel('profile')}><UserRound size={19} /><span>用户信息</span></button>
        <button className={active === 'team' ? 'nav-item active' : 'nav-item'} data-guide="team" onClick={() => openPanel('team')}><UsersRound size={18} /><span>员工画像</span></button>
        <button className={active === 'library' ? 'nav-item active' : 'nav-item'} data-guide="library" onClick={() => openPanel('library')}><BookOpen size={18} /><span>决策库</span></button>
        <button className={active === 'settings' ? 'nav-item active' : 'nav-item'} data-guide="settings" onClick={() => openPanel('settings')}><Settings2 size={18} /><span>设置</span></button>
      </nav>
    </aside>
    <main className="main-shell">
      {data && refreshFailure && <div className="inline-banner" role="status"><span>{refreshFailure}</span><button className="text-button" onClick={() => refresh().catch(() => {})}>重试刷新</button></div>}
      {!data ? <div className="loading-page">{failure ? <><CircleHelp size={32} /><h2>暂时连接不到你的空间</h2><p>{failure}</p><button className="primary" onClick={() => refresh().catch(e => setFailure(errorText(e)))}>重新连接</button></> : <Spinner label="正在打开你的私人空间…" />}</div> : props && <Composer key={composerVersion} {...props} startDecision={startDecision} />}
      <footer className="page-footer"><span>第二视角</span><span>员工画像和决策记录保存在本机。</span></footer>
    </main>
    {panel && props && <Modal title={panel === 'profile' ? '用户信息' : panel === 'team' ? '员工画像' : panel === 'library' ? '决策库' : panel === 'decision' ? (route.includes('analyze=1') ? '换个角度看' : '决策回看')  : '设置'} onClose={closePanel} wide className={'workspace-panel ' + (panel === 'decision' ? 'decision-panel' : '')}>
      {panel === 'profile' ? <UserInfo {...props} /> : panel === 'team' ? <Team {...props} /> : panel === 'library' ? <Dashboard {...props} /> : panel === 'settings' ? <Settings {...props} /> : <DecisionPage key={route} {...props} decisionId={route.split('/')[2].split('?')[0]} analyzeOnOpen={route.includes('analyze=1')} registerGuard={registerGuard} onHelpfulRecorded={() => { if (composerDecisionId.current === route.split('/')[2].split('?')[0]) { composerDecisionId.current = null; setComposerVersion(version => version + 1); } }} />}
    </Modal>}
    {toast && <div className={'toast ' + (toast.error ? 'toast-error' : '')} role={toast.error ? 'alert' : 'status'}><span>{toast.message}</span><button aria-label="关闭提示" onClick={() => setToast(null)}><X size={16} /></button></div>}
  </div>;
}
