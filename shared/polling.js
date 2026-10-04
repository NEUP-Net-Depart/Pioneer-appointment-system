// Pause network polling while the browser tab is hidden; refresh on return.
export function startVisiblePolling(callback, interval = 30000) {
  let timer, disposed = false, running = false;
  async function refresh() {
    if (disposed || document.hidden || running) return;
    running = true;
    try { await callback(); } finally { running = false; }
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
  function onPageHide(event) { if (!event.persisted) dispose(); }
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('pagehide', onPageHide);
  resume();
  return dispose;
}
