import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { request } from './request.js';
import {
  readWorkspaceState,
  writeWorkspaceState,
  subscribeWorkspaceSession,
  workspaceSessionVersion,
  workspaceQueryVersion
} from './workspace-state.js';

const freshness = 30000;
const retention = 5 * 60000;
const cacheUsers = new WeakMap();
function prune(cache, currentPath) {
  for (const key of cache.keys()) {
    if (cache.size <= 8) break;
    if (key !== currentPath && !cacheUsers.get(cache)?.get(key)) cache.delete(key);
  }
}

export function useWorkspaceQuery(path, active, revision, { itemKey = 'id', derive } = {}) {
  const session = useSyncExternalStore(subscribeWorkspaceSession, workspaceSessionVersion);
  const scope = `query:${path?.split('?')[0]}`;
  let cache = readWorkspaceState(scope);
  if (!cache) {
    cache = new Map();
    writeWorkspaceState(scope, cache);
  }
  let entry = cache.get(path);
  if (!entry && derive) {
    entry = derive(path, cache);
    if (entry && Date.now() - entry.fetchedAt < retention) {
      cache.set(path, entry);
      prune(cache, path);
    } else entry = null;
  }
  const [snapshot, setSnapshot] = useState(null);
  const [failure, setFailure] = useState(null);
  const [pending, setPending] = useState(null);
  const previousRevision = useRef({ session, revision });
  const loadMoreRef = useRef(() => Promise.resolve());
  const selection = useRef({ path, active, session });
  useLayoutEffect(() => {
    selection.current = { path, active, session };
  }, [path, active, session]);
  const current =
    entry &&
    (Date.now() - entry.fetchedAt < retention ||
      (snapshot?.path === path && snapshot?.session === session))
      ? entry
      : null;

  useEffect(() => {
    if (
      previousRevision.current.session === session &&
      previousRevision.current.revision !== revision
    ) {
      for (const value of cache.values()) value.stale = true;
    }
    previousRevision.current = { session, revision };
    setPending(null);
    if (!active || !path) return;
    let users = cacheUsers.get(cache);
    if (!users) {
      users = new Map();
      cacheUsers.set(cache, users);
    }
    users.set(path, (users.get(path) || 0) + 1);
    let controller;
    let stopped = false;
    let inFlight = false;
    let currentEntry = cache.get(path);
    if (
      currentEntry &&
      Date.now() - currentEntry.fetchedAt >= retention &&
      !(snapshot?.path === path && snapshot?.session === session)
    ) {
      cache.delete(path);
      currentEntry = null;
    }
    if (currentEntry) setSnapshot({ ...currentEntry, path, session });
    else setSnapshot(null);
    setFailure(null);
    const publish = (value) => {
      currentEntry = value;
      cache.delete(path);
      cache.set(path, value);
      prune(cache, path);
      setSnapshot({ ...value, path, session });
    };
    async function read(append = false) {
      if (
        stopped ||
        document.hidden ||
        selection.current.path !== path ||
        selection.current.session !== session ||
        !selection.current.active ||
        (append && !currentEntry?.data.nextCursor)
      )
        return;
      if (inFlight && (!append || inFlight === 'more')) return;
      controller?.abort();
      controller = new AbortController();
      const currentController = controller;
      const version = workspaceQueryVersion();
      const baseline = currentEntry;
      const targetPages = baseline?.pages || 1;
      inFlight = append ? 'more' : 'refresh';
      setPending({ path, session, kind: append ? 'more' : 'refresh' });
      setFailure(null);
      const fetchPage = (cursor) =>
        request(
          cursor
            ? `${path}${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}`
            : path,
          { signal: currentController.signal }
        );
      try {
        let data = await fetchPage(append ? baseline.data.nextCursor : '');
        let pages = 1;
        if (append) {
          data = {
            ...data,
            items: [
              ...new Map(
                [...(baseline.data.items || []), ...(data.items || [])].map((item) => [
                  item[itemKey],
                  item
                ])
              ).values()
            ]
          };
          pages = targetPages + 1;
        } else {
          while (pages < targetPages && data.nextCursor) {
            const page = await fetchPage(data.nextCursor);
            data = { ...page, items: [...(data.items || []), ...(page.items || [])] };
            pages++;
          }
        }
        if (
          !stopped &&
          !currentController.signal.aborted &&
          session === workspaceSessionVersion()
        ) {
          if (version === workspaceQueryVersion())
            publish({ data, pages, fetchedAt: Date.now(), stale: append && !!baseline.stale });
        }
      } catch (error) {
        if (!stopped && !currentController.signal.aborted) {
          if ([401, 403].includes(error.status)) {
            cache.clear();
            currentEntry = null;
            setSnapshot(null);
          }
          setFailure({ path, session, message: error.message });
        }
      } finally {
        if (controller === currentController) {
          inFlight = false;
          if (!stopped) setPending(null);
          if (!stopped && !currentController.signal.aborted && version !== workspaceQueryVersion())
            void read();
        }
      }
    }
    loadMoreRef.current = () => read(true);
    const refreshIfStale = () => {
      const interval = currentEntry?.pages > 1 ? 120000 : freshness;
      if (!currentEntry || currentEntry.stale || Date.now() - currentEntry.fetchedAt >= interval)
        void read();
    };
    refreshIfStale();
    const timer = setInterval(refreshIfStale, freshness);
    const visibility = () => {
      if (document.hidden) {
        controller?.abort();
        inFlight = false;
        setPending(null);
      } else refreshIfStale();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      stopped = true;
      controller?.abort();
      loadMoreRef.current = () => Promise.resolve();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
      const remaining = users.get(path) - 1;
      if (remaining) users.set(path, remaining);
      else users.delete(path);
      prune(cache);
    };
  }, [path, active, revision, session, cache, itemKey]);

  const error = failure?.path === path && failure?.session === session ? failure.message : '';
  const fetching = pending?.path === path && pending?.session === session && !!active;
  return {
    data: current?.data,
    current: !!current,
    error,
    loading: !!active && !!path && !current && !error,
    refreshing: !!current && fetching && pending.kind === 'refresh',
    loadingMore: fetching && pending.kind === 'more',
    nextCursor: current?.data.nextCursor || null,
    loadMore: () => loadMoreRef.current()
  };
}
