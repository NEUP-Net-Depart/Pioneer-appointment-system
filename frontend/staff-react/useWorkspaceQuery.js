import { useEffect, useRef, useState } from 'react';
import { request } from './request.js';

// Keep each region's data and inputs stable. Hidden routes and documents stop
// querying; authorization failures discard data that is no longer accessible.
export function useWorkspaceQuery(path, active, revision) {
  const [snapshot, setSnapshot] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const latest = useRef(0);
  useEffect(() => {
    if (!active || !path) return;
    latest.current = 0;
    let controller, stopped = false;
    async function read() {
      controller?.abort();
      if (document.hidden) { setLoading(false); return; }
      controller = new AbortController(); const current = controller;
      setLoading(true); setError('');
      try { const data = await request(path, { signal: current.signal }); if (!stopped && !current.signal.aborted) { setSnapshot({ path, data }); latest.current = Date.now(); } }
      catch (failure) { if (!stopped && !current.signal.aborted) { if ([401,403].includes(failure.status)) setSnapshot(null); setError(failure.message); } }
      finally { if (!stopped && !current.signal.aborted) setLoading(false); }
    }
    read();
    const timer = setInterval(read, 30000);
    const visibility = () => { if (document.hidden) { controller?.abort(); setLoading(false); } else if (Date.now() - latest.current >= 30000) read(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { stopped = true; controller?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [path, active, revision]);
  return { data: snapshot?.data, current: snapshot?.path === path, error, loading };
}
