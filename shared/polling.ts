// Pause network polling while the browser tab is hidden; refresh on return.
export function startVisiblePolling(callback: (options: { telemetryPoll: boolean }) => unknown, interval = 30000) {
  let timer: ReturnType<typeof setInterval> | undefined, disposed = false, running = false, first = true;
  async function refresh() {
    if (disposed || document.hidden || running) return;
    running = true;
    try { const telemetryPoll = !first; first = false; await callback({ telemetryPoll }); } finally { running = false; }
  }
  function stopTimer() { clearInterval(timer); timer = undefined; }
  function resume() {
    stopTimer();
    if (disposed || document.hidden) return;
    void refresh();
    timer = setInterval(() => { void refresh(); }, interval);
  }
  function dispose() {
    disposed = true;
    stopTimer();
    document.removeEventListener('visibilitychange', resume);
    window.removeEventListener('pagehide', onPageHide);
  }
  function onPageHide(event: PageTransitionEvent) { if (!event.persisted) dispose(); }
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('pagehide', onPageHide);
  resume();
  return dispose;
}
