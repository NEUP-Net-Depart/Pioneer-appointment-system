import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './ui';
import { dateKey } from '../../../shared/time.js';
import type { Home } from './types';
import { readWorkspaceState, writeWorkspaceState, removeWorkspaceState } from '../workspace-state.js';

type Snapshot = { value: Home; fetchedAt: number };
const freshness = 30_000;
const isFresh = (entry?: Snapshot) => !!entry && Date.now() - entry.fetchedAt < freshness && entry.value.businessDate === dateKey();

export function useField(campus: string, scene: string, sessionKey: string, initial?: Home, active = true) {
  const resource = ['desk', 'operations'].includes(scene) ? 'board' : 'home';
  const key = `field:${sessionKey}:${campus}:${resource}`;
  const cached = () => readWorkspaceState(key) as Snapshot | undefined;
  const fallback = initial?.campusId === campus ? initial : null;
  const [snapshot, setSnapshot] = useState<{ key: string; value: Home | null }>(() => ({ key, value: cached()?.value || fallback }));
  const [failure, setFailure] = useState({ key, message: '' });
  const [pending, setPending] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null), generation = useRef(0);
  const refresh = useCallback(async () => {
    if (!active) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const version = ++generation.current;
    setPending(key);
    const adopt = (value: Home) => {
      if (version !== generation.current || controller.signal.aborted) return;
      writeWorkspaceState(key, { value, fetchedAt: Date.now() });
      // A board also contains the authorized home summary for this campus.
      if (resource === 'home') removeWorkspaceState(`field:${sessionKey}:${campus}:board`);
      if (resource === 'board') writeWorkspaceState(`field:${sessionKey}:${campus}:home`, { value, fetchedAt: Date.now() });
      setSnapshot({ key, value }); setFailure({ key, message: '' });
    };
    try {
      adopt(await api<Home>(`/api/field/${resource}${campus ? '?campusId=' + encodeURIComponent(campus) : ''}`, { signal: controller.signal }));
    } catch (error) {
      if (controller.signal.aborted || version !== generation.current) return;
      const status = (error as Error & { status: number }).status;
      if (status === 403 && resource === 'board') {
        try {
          const home = await api<Home>(`/api/field/home${campus ? '?campusId=' + encodeURIComponent(campus) : ''}`, { signal: controller.signal });
          if (version !== generation.current || controller.signal.aborted) return;
          removeWorkspaceState(key);
          writeWorkspaceState(`field:${sessionKey}:${campus}:home`, { value: home, fetchedAt: Date.now() });
          if (version === generation.current && !controller.signal.aborted) { setSnapshot({ key, value: home }); setFailure({ key, message: '' }); }
          return;
        } catch { /* The original access failure remains the actionable error. */ }
      }
      if (controller.signal.aborted || version !== generation.current) return;
      if ([401, 403].includes(status)) { removeWorkspaceState(key); removeWorkspaceState(`field:${sessionKey}:${campus}:home`); removeWorkspaceState(`field:${sessionKey}:${campus}:board`); setSnapshot({ key, value: null }); }
      setFailure({ key, message: (error as Error).message });
    } finally { if (version === generation.current) setPending(null); }
  }, [active, key, resource, campus, sessionKey]);
  useEffect(() => {
    if (!active) {
      request.current?.abort();
      generation.current++;
      setPending(null);
      return;
    }
    const entry = readWorkspaceState(key) as Snapshot | undefined;
    if (entry) setSnapshot({ key, value: entry.value });
    if (!document.hidden && !isFresh(entry)) refresh();
    const timer = setInterval(() => { if (!document.hidden) refresh(); }, freshness);
    const visibility = () => {
      if (document.hidden) { request.current?.abort(); generation.current++; setPending(null); }
      else {
        const current = readWorkspaceState(key) as Snapshot | undefined;
        if (!isFresh(current)) refresh();
      }
    };
    document.addEventListener('visibilitychange', visibility);
    return () => { clearInterval(timer); generation.current++; request.current?.abort(); document.removeEventListener('visibilitychange', visibility); };
  }, [active, key, refresh]);
  const data = snapshot.key === key ? snapshot.value : cached()?.value || fallback;
  return { data, error: failure.key === key ? failure.message : '', loading: pending === key, refresh };
}
