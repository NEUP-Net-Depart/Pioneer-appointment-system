import {
  cleanEvent,
  errorFields,
  isErrorEvent,
  knownControl,
  knownView,
  TELEMETRY_ENDPOINT,
  releaseId,
  routeFor
} from './telemetry.js';

const BUDGET_KEY = 'pioneerTelemetryBudgetV1';
export function createTelemetryClient({
  config = {},
  win = globalThis.window,
  doc = globalThis.document,
  clock = Date.now,
  fetcher,
  storage,
  beacon
} = {}) {
  const queue = new Map(),
    reported = new WeakSet(),
    dialogs = new WeakMap();
  let lastInteraction = -Infinity;
  let view = 'unknown',
    timer,
    lastSend = -Infinity,
    memoryBudget,
    disposed = false;
  const enabled = config.enabled === true;
  const release = releaseId(config.release);
  const priority = (event) =>
    isErrorEvent(event) ? 3 : event.name === 'flow.result' ? 2 : event.name === 'page.view' ? 1 : 0;
  const transport = fetcher || ((...args) => win.fetch(...args));
  function budget(error) {
    const day = new Date(clock()).toISOString().slice(0, 10);
    let current = memoryBudget;
    try {
      current = JSON.parse((storage || win.localStorage).getItem(BUDGET_KEY)) || current;
    } catch {
      /* Private browsing. */
    }
    if (!current || current.day !== day) current = { day, ordinary: 0, errors: 0 };
    const key = error ? 'errors' : 'ordinary',
      limit = error ? 20 : 120;
    current[key] = Number.isSafeInteger(current[key]) && current[key] >= 0 ? current[key] : 0;
    if (current[key] >= limit) return false;
    current[key]++;
    memoryBudget = current;
    try {
      (storage || win.localStorage).setItem(BUDGET_KEY, JSON.stringify(current));
    } catch {
      /* Memory fallback. */
    }
    return true;
  }
  function track(name, fields = {}) {
    try {
      if (!enabled || disposed || (name.startsWith('ui.') && config.interactions === false)) return;
      const event = cleanEvent({
        ...fields,
        name,
        view: fields.view || view,
        release,
        at: clock()
      });
      if (!event) return;
      if (['ui.click', 'ui.change', 'ui.submit', 'ui.invalid'].includes(name))
        lastInteraction = clock();
      const key = JSON.stringify([
        event.name,
        event.view,
        event.control,
        event.route,
        event.result,
        event.status,
        event.errorName,
        event.errorCode,
        event.frames
      ]);
      const previous = queue.get(key);
      if (previous) {
        previous.count = Math.min(10000, previous.count + event.count);
        previous.durationMs = Math.min(3600000, previous.durationMs + event.durationMs);
        return;
      }
      if (queue.size >= 100) {
        const candidate = [...queue].sort((a, b) => priority(a[1]) - priority(b[1]))[0];
        if (priority(candidate[1]) > priority(event)) return;
        queue.delete(candidate[0]);
      }
      queue.set(key, event);
    } catch {
      /* Analytics cannot interrupt an event handler. */
    }
  }
  function report(error, code = 'CLIENT_RUNTIME_ERROR', fields = {}) {
    try {
      if (error && typeof error === 'object') {
        if (reported.has(error)) return;
        reported.add(error);
      }
      track('client.error', {
        ...fields,
        ...errorFields(error, code),
        requestId: error?.requestId || fields.requestId,
        result: 'error'
      });
    } catch {
      /* User-supplied thrown values are not telemetry data. */
    }
  }
  function flush({ closing = false } = {}) {
    try {
      if (!enabled || disposed || !queue.size) return;
      if (!closing && clock() - lastSend < 30000) return;
      if (win?.navigator?.onLine === false) {
        queue.clear();
        return;
      }
      const errors = [...queue.values()].some(isErrorEvent);
      const chosen = [...queue].filter(([, event]) => isErrorEvent(event) === errors).slice(0, 20);
      let body;
      while (chosen.length) {
        body = JSON.stringify({ version: 1, events: chosen.map(([, event]) => event) });
        if (new TextEncoder().encode(body).byteLength <= 16 * 1024) break;
        chosen.pop();
      }
      for (const [key] of chosen) queue.delete(key);
      if (!chosen.length || !budget(errors)) return;
      lastSend = clock();
      if (closing) {
        const send = beacon || win?.navigator?.sendBeacon?.bind(win.navigator);
        if (send?.(TELEMETRY_ENDPOINT, new Blob([body], { type: 'application/json' }))) return;
      }
      // Deliberately bypass apiFetch: no credentials, retries or recursive errors.
      void Promise.resolve(
        transport(TELEMETRY_ENDPOINT, {
          method: 'POST',
          body,
          headers: { 'Content-Type': 'application/json' },
          credentials: 'omit',
          keepalive: true
        })
      ).catch(() => {});
    } catch {
      /* Drop failed batches; never retain an offline backlog. */
    }
  }
  function page(next) {
    next = knownView(next);
    if (view === next) return;
    view = next;
    track('page.view');
  }
  function control(event) {
    lastInteraction = clock();
    const target = event.target?.closest?.('[data-track]');
    if (!target || target.disabled || target.closest('[inert]')) return;
    const hidden = target.closest('[hidden]');
    if (hidden && !(hidden === target && target.type === 'file' && event.type === 'change')) return;
    const id = knownControl(target.getAttribute('data-track'));
    if (!id) return;
    track(`ui.${event.type}`, {
      control: id,
      result:
        event.type === 'toggle'
          ? target.open
            ? 'open'
            : 'closed'
          : event.type === 'invalid'
            ? 'rejected'
            : 'ok'
    });
  }
  const surfaceSelector =
    '[role="dialog"][data-track], dialog[data-track], [role="listbox"][data-track], [role="tooltip"][data-track]';
  const surfaceEvent = (node) =>
    ['listbox', 'tooltip'].includes(node.getAttribute('role')) ? 'ui.toggle' : 'ui.dialog';
  function scanDialogs() {
    for (const node of doc.querySelectorAll(surfaceSelector)) {
      const open = !node.closest('[hidden], [inert]') && (node.tagName !== 'DIALOG' || node.open);
      const previous = dialogs.get(node);
      if (previous !== open) {
        dialogs.set(node, open);
        if (open || previous === true)
          track(surfaceEvent(node), {
            control: node.getAttribute('data-track'),
            result: open ? 'open' : 'closed'
          });
      }
    }
  }
  const onError = (event) => {
    if (event.error) report(event.error);
    else report(null, event.target === win ? 'CLIENT_RUNTIME_ERROR' : 'RESOURCE_LOAD_ERROR');
  };
  const onRejection = (event) => report(event.reason, 'UNHANDLED_REJECTION');
  const onModule = (event) => report(event.payload, 'MODULE_LOAD_ERROR');
  const onHide = () => {
    if (doc.hidden) flush({ closing: true });
  };
  const onPageHide = () => flush({ closing: true });
  let observer;
  if (enabled && win && doc) {
    for (const type of ['click', 'change', 'submit', 'invalid', 'toggle'])
      doc.addEventListener(type, control, true);
    win.addEventListener('error', onError, true);
    win.addEventListener('unhandledrejection', onRejection);
    win.addEventListener('vite:preloadError', onModule);
    win.addEventListener('pagehide', onPageHide);
    doc.addEventListener('visibilitychange', onHide);
    observer = new win.MutationObserver((records) => {
      for (const record of records)
        for (const removed of record.removedNodes) {
          if (removed.isConnected || removed.nodeType !== 1) continue;
          for (const node of [removed, ...removed.querySelectorAll(surfaceSelector)]) {
            if (dialogs.get(node) !== true) continue;
            dialogs.set(node, false);
            track(surfaceEvent(node), {
              control: node.getAttribute('data-track'),
              result: 'closed'
            });
          }
        }
      scanDialogs();
    });
    observer.observe(doc.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['hidden', 'open', 'inert']
    });
    scanDialogs();
    timer = win.setInterval(() => flush(), 30000);
    const token = config.webAnalyticsToken;
    if (
      /^[a-f\d]{32}$/i.test(token || '') &&
      !doc.querySelector('script[data-cf-beacon]') &&
      !win.__cfBeacon
    ) {
      const script = doc.createElement('script');
      script.defer = true;
      script.src = 'https://static.cloudflareinsights.com/beacon.min.js';
      script.setAttribute('data-cf-beacon', JSON.stringify({ token, spa: false }));
      doc.head.append(script);
    }
  }
  return {
    track,
    report,
    flush,
    page,
    recentlyActive: () => clock() - lastInteraction < 3000,
    snapshot: () => [...queue.values()].map((event) => ({ ...event })),
    dispose() {
      disposed = true;
      queue.clear();
      observer?.disconnect();
      win?.clearInterval(timer);
      if (!doc || !win) return;
      for (const type of ['click', 'change', 'submit', 'invalid', 'toggle'])
        doc.removeEventListener(type, control, true);
      win.removeEventListener('error', onError, true);
      win.removeEventListener('unhandledrejection', onRejection);
      win.removeEventListener('vite:preloadError', onModule);
      win.removeEventListener('pagehide', onPageHide);
      doc.removeEventListener('visibilitychange', onHide);
    }
  };
}

const client = createTelemetryClient({ config: globalThis.window?.pioneerTelemetry || {} });
export const recentlyActive = () => client.recentlyActive();
export const track = (name, fields) => client.track(name, fields);
export const reportClientError = (error, code, fields) => client.report(error, code, fields);
export const trackPage = (view) => client.page(view);
export function trackRequest(input, method, response, durationMs, error, code) {
  const route = routeFor(input, method);
  if (route === 'unknown') return;
  const fields = {
    route,
    durationMs,
    status: response?.status || 0,
    requestId: response?.headers.get('X-Request-ID') || ''
  };
  if (error) {
    if (code === 'REQUEST_CANCELLED') track('flow.result', { ...fields, result: 'cancelled' });
    else reportClientError(error, code, fields);
  } else if (!['GET', 'HEAD'].includes(method) || !response.ok) {
    track('flow.result', {
      ...fields,
      result: response.status >= 500 ? 'error' : response.ok ? 'ok' : 'rejected'
    });
  }
}
