import { cleanEvent, knownControl, knownView, releaseId, routeFor } from './telemetry.js';

// Load one browser bundle from both the native student app and the Vite staff app.
const loadPostHog = () =>
  import(/* @vite-ignore */ '/assets/posthog.js').then((module) => module.default);

// PostHog-only dimensions. The legacy Analytics Engine column contract stays unchanged.
function businessProperties(fields) {
  const properties = {};
  for (const key of ['reason', 'errorCode'])
    if (typeof fields[key] === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(fields[key]))
      properties[key] = fields[key];
  for (const key of ['failureFields', 'missingFields', 'invalidFields'])
    if (Array.isArray(fields[key]))
      properties[key] = [...new Set(fields[key])]
        .filter((field) => typeof field === 'string' && /^[a-zA-Z][\w.]{0,63}$/.test(field))
        .sort()
        .slice(0, 30);
  return properties;
}

export function createTelemetryClient({
  config = {},
  win = globalThis.window,
  doc = globalThis.document,
  clock = Date.now,
  loadSDK = loadPostHog
} = {}) {
  const reported = new WeakSet(),
    reportedRequests = new Set(),
    dialogs = new WeakMap(),
    pending = [];
  let lastInteraction = -Infinity,
    view = 'unknown',
    disposed = false,
    sdk,
    failed = false;
  const enabled = config.enabled === true && !!config.posthog?.token;
  const release = releaseId(config.release);
  const surface = /^\/staff(?:\/|$)/.test(win?.location?.pathname || '') ? 'staff' : 'student';
  const context = () => ({ environment: config.environment, release, surface, view });
  function send(method, ...args) {
    if (!enabled || disposed || failed) return;
    try {
      if (sdk) sdk[method](...args);
      // Only buffer while the local SDK chunk loads. The SDK owns batching and retries.
      else if (pending.length < 1000) pending.push([method, ...args]);
    } catch {
      /* Collection must never interrupt the application. */
    }
  }
  const ready = enabled
    ? Promise.resolve()
        .then(loadSDK)
        .then((loaded) => {
          if (disposed) return;
          loaded.init(config.posthog.token, {
            api_host: config.posthog.host,
            defaults: '2026-08-30',
            autocapture: config.interactions !== false,
            capture_pageview: false,
            capture_pageleave: true,
            capture_heatmaps: config.interactions !== false,
            capture_dead_clicks: config.interactions !== false,
            // Our early listeners and React/API bridges share one deduplicating error path.
            // captureException still sends native PostHog Error Tracking exceptions.
            capture_exceptions: false,
            capture_performance: true,
            enable_recording_console_log: true,
            disable_session_recording: config.posthog.replay === false,
            session_recording: {
              sampleRate: config.posthog.replaySampleRate ?? 1,
              captureCanvas: { recordCanvas: true }
            },
            person_profiles: 'identified_only',
            cross_subdomain_cookie: false,
            // Separate both identity and replay sessions across same-origin applications.
            // Include the project token because persistence_name replaces the SDK token key.
            persistence_name: `pioneer_${config.posthog.token}_${config.environment || 'local'}_${surface}`,
            // Accommodate legitimate bursts without imposing a daily application budget.
            rate_limiting: { events_per_second: 100, events_burst_limit: 1000 },
            loaded(instance) {
              instance.register(context());
            }
          });
          sdk = loaded;
          for (const [method, ...args] of pending.splice(0)) send(method, ...args);
        })
        .catch(() => {
          failed = true;
          pending.length = 0;
        })
    : Promise.resolve();

  function track(name, fields = {}) {
    if (['ui.click', 'ui.change', 'ui.submit', 'ui.invalid'].includes(name))
      lastInteraction = clock();
    try {
      if (name.startsWith('ui.') && config.interactions === false) return;
      const event = cleanEvent({
        ...fields,
        name,
        view: fields.view || view,
        release,
        at: clock()
      });
      if (!event) return;
      // Preserve every event and request ID; do not aggregate sequences used by funnels.
      send('capture', name, { ...context(), ...event, ...businessProperties(fields) });
    } catch {
      /* Collection must never interrupt the application. */
    }
  }
  function report(error, code = 'CLIENT_RUNTIME_ERROR', fields = {}) {
    try {
      if (error && typeof error === 'object') {
        if (reported.has(error)) return;
        reported.add(error);
      }
      const requestId = error?.requestId || fields.requestId;
      if (requestId) {
        if (reportedRequests.has(requestId)) return;
        reportedRequests.add(requestId);
        if (reportedRequests.size > 128)
          reportedRequests.delete(reportedRequests.values().next().value);
      }
      send('captureException', error ?? new Error(code), {
        ...context(),
        ...fields,
        errorCode: code,
        requestId,
        result: 'error'
      });
    } catch {
      /* Error reporting is best effort. */
    }
  }
  function identify(user) {
    const memberId = user?.memberId || user?.actor?.memberId;
    if (!memberId) return;
    send('identify', `staff:${memberId}`, { role: user.role });
    send('register', { audience: 'staff', role: user.role });
  }
  function reset() {
    send('reset', true);
    send('register', { ...context(), audience: 'anonymous', role: null });
  }
  function page(next) {
    next = knownView(next);
    if (view === next) return;
    view = next;
    send('register', context());
    send('capture', '$pageview', context());
    send('capture', 'app.view', context());
  }
  function control(event) {
    lastInteraction = clock();
    const target = event.target?.closest?.('[data-track]');
    if (!target || target.disabled || target.closest('[inert]')) return;
    const hidden = target.closest('[hidden]');
    if (hidden && !(hidden === target && target.type === 'file' && event.type === 'change')) return;
    const id = knownControl(target.getAttribute('data-track'));
    if (!id) return;
    // PostHog owns normal DOM interactions; keep early interactions and unsupported events.
    if (sdk && ['click', 'change', 'submit'].includes(event.type)) return;
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
    const location = event.target?.src || event.target?.href || event.filename;
    const resource = typeof location === 'string' ? location : '';
    // A blocked analytics script is not an application resource failure.
    if (
      resource.includes('/assets/posthog.js') ||
      /^https:\/\/(?:us|eu)(?:-assets)?\.i\.posthog\.com\//.test(resource)
    )
      return;
    if (event.error) report(event.error);
    else
      report(
        new Error(event.message || 'Resource failed to load'),
        event.target === win ? 'CLIENT_RUNTIME_ERROR' : 'RESOURCE_LOAD_ERROR',
        { resource }
      );
  };
  const onRejection = (event) => report(event.reason, 'UNHANDLED_REJECTION');
  const onModule = (event) => report(event.payload, 'MODULE_LOAD_ERROR');
  let observer;
  if (win && doc) {
    // Interaction recency also classifies React Query polling when analytics is disabled.
    for (const type of ['click', 'change', 'submit', 'invalid', 'toggle'])
      doc.addEventListener(type, control, true);
  }
  if (enabled && win && doc) {
    win.addEventListener('error', onError, true);
    win.addEventListener('unhandledrejection', onRejection);
    win.addEventListener('vite:preloadError', onModule);
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
  }
  if (win && doc) {
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
    ready,
    identify,
    cancel(error, fields) {
      if (error && typeof error === 'object') reported.add(error);
      track('flow.result', { ...fields, result: 'cancelled' });
    },
    reset,
    page,
    recentlyActive: () => clock() - lastInteraction < 3000,
    dispose() {
      disposed = true;
      pending.length = 0;
      observer?.disconnect();
      if (!doc || !win) return;
      for (const type of ['click', 'change', 'submit', 'invalid', 'toggle'])
        doc.removeEventListener(type, control, true);
      win.removeEventListener('error', onError, true);
      win.removeEventListener('unhandledrejection', onRejection);
      win.removeEventListener('vite:preloadError', onModule);
    }
  };
}

const clientKey = Symbol.for('pioneer.telemetry');
const client = globalThis.window
  ? (window[clientKey] ||= createTelemetryClient({ config: window.pioneerTelemetry || {} }))
  : createTelemetryClient();
export const recentlyActive = () => client.recentlyActive();
export const identifyTelemetry = (user) => client.identify(user);
export const resetTelemetry = () => client.reset();
export const track = (name, fields) => client.track(name, fields);
export const reportClientError = (error, code, fields) => client.report(error, code, fields);
export const trackPage = (view) => client.page(view);
export function trackRequest(input, method, response, durationMs, error, code, payload) {
  const route = routeFor(input, method);
  if (route === 'unknown') return;
  const fields = {
    route,
    durationMs,
    status: response?.status || 0,
    requestId: response?.headers.get('X-Request-ID') || '',
    ...(!response?.ok && payload && typeof payload === 'object'
      ? businessProperties({
          errorCode: payload.code,
          failureFields: Object.keys(payload.fields || {})
        })
      : {})
  };
  if (error) {
    if (code === 'REQUEST_CANCELLED') client.cancel(error, fields);
    else reportClientError(error, code, fields);
  } else if (!['GET', 'HEAD'].includes(method) || !response.ok) {
    if (response.status >= 500)
      reportClientError(
        new Error(`HTTP ${response.status}`),
        fields.errorCode || 'HTTP_ERROR',
        fields
      );
    track('flow.result', {
      ...fields,
      result: response.status >= 500 ? 'error' : response.ok ? 'ok' : 'rejected'
    });
  }
}
