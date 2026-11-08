import { useEffect, useRef, useState } from 'react';
import { request } from './request.js';

// Keep each region's data and inputs stable. Hidden routes and documents stop
// querying; authorization failures discard data that is no longer accessible.
export function useWorkspaceQuery(path, active, revision) {
  const [snapshot, setSnapshot] = useState(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [loadingMore, setLoadingMore] = useState(false),
    [nextCursor, setNextCursor] = useState(null);
  const latest = useRef(0),
    paginationRef = useRef({ path: null, pages: 1 }),
    nextCursorRef = useRef(null),
    loadMoreRef = useRef(() => Promise.resolve());
  useEffect(() => {
    if (!active || !path) return;
    if (paginationRef.current.path !== path) paginationRef.current = { path, pages: 1 };
    const pagination = paginationRef.current;
    latest.current = 0;
    if (snapshot?.path !== path) {
      nextCursorRef.current = null;
      setNextCursor(null);
    }
    let controller,
      stopped = false,
      inFlight = false;
    async function read(cursor = '', append = false) {
      if (inFlight || stopped) return;
      if (document.hidden) {
        setLoading(false);
        return;
      }
      const target = cursor
        ? `${path}${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}`
        : path;
      inFlight = true;
      controller = new AbortController();
      const current = controller;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError('');
      try {
        let data = await request(target, { signal: current.signal });
        let loaded = 1;
        if (!append) {
          while (loaded < pagination.pages && data.nextCursor) {
            const page = await request(
              `${path}${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(data.nextCursor)}`,
              { signal: current.signal }
            );
            data = { ...page, items: [...(data.items || []), ...(page.items || [])] };
            loaded++;
          }
        }
        if (!stopped && !current.signal.aborted) {
          setSnapshot((previous) =>
            append && previous?.path === path
              ? {
                  path,
                  data: {
                    ...data,
                    items: [
                      ...new Map(
                        [...(previous.data?.items || []), ...(data.items || [])].map((item) => [
                          item.id,
                          item
                        ])
                      ).values()
                    ]
                  }
                }
              : { path, data }
          );
          pagination.pages = append ? pagination.pages + 1 : loaded;
          nextCursorRef.current = data.nextCursor || null;
          setNextCursor(nextCursorRef.current);
          latest.current = Date.now();
        }
      } catch (failure) {
        if (!stopped && !current.signal.aborted) {
          if ([401, 403].includes(failure.status)) {
            pagination.pages = 1;
            setSnapshot(null);
            nextCursorRef.current = null;
            setNextCursor(null);
          }
          setError(failure.message);
        }
      } finally {
        inFlight = false;
        if (!stopped && !current.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    }
    loadMoreRef.current = () =>
      nextCursorRef.current ? read(nextCursorRef.current, true) : Promise.resolve();
    read();
    const timer = setInterval(read, 30000);
    const visibility = () => {
      if (document.hidden) {
        controller?.abort();
        setLoading(false);
        setLoadingMore(false);
      } else if (Date.now() - latest.current >= 30000) read();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      stopped = true;
      controller?.abort();
      loadMoreRef.current = () => Promise.resolve();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [path, active, revision]);
  return {
    data: snapshot?.data,
    current: snapshot?.path === path,
    error,
    loading: loading || (!!active && !!path && !snapshot && !error),
    loadingMore,
    nextCursor: snapshot?.path === path ? nextCursor : null,
    loadMore: () => loadMoreRef.current()
  };
}
