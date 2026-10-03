import { useCallback, useEffect, useRef, useState } from 'react';
import type { Decision, DraftInput } from '../shared/model';
import type { Notify } from './App';
import { api, errorText } from './api';

type EditableDraft = Omit<DraftInput, 'channel' | 'revision'>;
export const draftOf = (d: Decision): EditableDraft => ({ title: d.title, problem: d.problem, temporaryContext: d.temporaryContext, initialPlan: d.initialPlan, employeeIds: d.channel === 'full' ? d.employeeIds : [] });
const same = (d: Decision, draft: EditableDraft) => JSON.stringify(draftOf(d)) === JSON.stringify(draft);
export function useDecision(decisionId: string, refresh: () => Promise<void>, notify: Notify, registerGuard: (fn: (() => Promise<void>) | null) => void) {
  const [decision, setDecision] = useState<Decision | null>(null), [draft, setDraft] = useState<EditableDraft>({ title: '', problem: '', temporaryContext: '', initialPlan: '', employeeIds: [] });
  const [saveStatus, setSaveStatus] = useState('saved'), [loadError, setLoadError] = useState('');
  const current = useRef<Decision | null>(null), input = useRef(draft), queue = useRef<Promise<unknown>>(Promise.resolve()), mounted = useRef(true);
  const apply = useCallback((d: Decision, replaceInput = true) => {
    current.current = d;
    if (replaceInput) input.current = draftOf(d);
    if (mounted.current) { setDecision(d); if (replaceInput) setDraft(input.current); setSaveStatus(same(d, input.current) ? 'saved' : 'dirty'); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    setLoadError('');
    api<Decision>('/decisions/' + decisionId).then(d => { if (active && mounted.current) apply(d); }).catch(e => { if (active && mounted.current) setLoadError(errorText(e)); });
    return () => { active = false; mounted.current = false; };
  }, [decisionId, apply]);
  const update = useCallback((patch: Partial<EditableDraft>) => { input.current = { ...input.current, ...patch }; setDraft(input.current); setSaveStatus('dirty'); }, []);
  const refreshAfterWrite = useCallback(async () => {
    try { await refresh(); return true; }
    catch { return false; } // App shows a refresh warning; a committed write must stay successful.
  }, [refresh]);
  const save = useCallback(async (): Promise<Decision> => {
    const work = async () => {
      if (!current.current) throw new Error('记录还未加载完成。');
      do {
        let changed = false;
        while (!same(current.current, input.current)) {
          if (mounted.current) setSaveStatus('saving');
          const sent = input.current;
          const result = await api<Decision>('/decisions/' + decisionId, 'PUT', { ...sent, revision: current.current.revision });
          // Normalize whitespace only when no newer keystrokes arrived during this save.
          if (JSON.stringify(sent) === JSON.stringify(input.current)) {
            input.current = draftOf(result);
            if (mounted.current) setDraft(input.current);
          }
          apply(result, false); changed = true;
        }
        if (changed) await refreshAfterWrite();
        // A user may continue typing while the list refresh is in flight.
      } while (!same(current.current, input.current));
      if (mounted.current) setSaveStatus('saved');
      return current.current;
    };
    const result = queue.current.then(work, work);
    queue.current = result;
    try { return await result; } catch (e) { if (mounted.current) setSaveStatus('error'); throw e; }
  }, [decisionId, apply, refreshAfterWrite]);
  useEffect(() => {
    if (!decision || same(decision, draft)) return;
    const timer = setTimeout(() => { save().catch(e => notify(errorText(e), true)); }, 950);
    return () => clearTimeout(timer);
  }, [draft, decision, save, notify]);
  useEffect(() => { registerGuard(async () => { if (current.current) await save(); }); return () => registerGuard(null); }, [save, registerGuard]);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (current.current && !same(current.current, input.current)) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent);
  }, []);
  return { decision, draft, update, save, apply, saveStatus, loadError, refreshAfterWrite };
}
