import { CONTROL_IDS, ROUTE_DEFINITIONS, ERROR_CODES, SOURCE_FILES } from './telemetry-catalog.js';

export const TELEMETRY_ENDPOINT = '/api/telemetry';
export const EVENT_NAMES = Object.freeze([
  'ui.click',
  'ui.change',
  'ui.submit',
  'ui.invalid',
  'ui.toggle',
  'ui.dialog',
  'page.view',
  'flow.step',
  'flow.result',
  'api.request',
  'client.error'
]);
export const VIEWS = Object.freeze([
  'student.booking',
  'student.lookup',
  'student.detail',
  'staff.login',
  'staff.activation',
  'staff.workbench',
  'staff.today',
  'staff.mine',
  'staff.duties',
  'staff.members',
  'staff.permissions',
  'staff.staff',
  'staff.stats',
  'staff.settings',
  'staff.capacity',
  'verifier',
  'unknown'
]);
export const FLOW_CONTROLS = [
  'booking.step.1',
  'booking.step.2',
  'booking.step.3',
  'booking.submit',
  'private-link.import',
  'device.scan',
  'device.ocr',
  'photo.compress',
  'captcha'
];
const controls = new Set([...CONTROL_IDS, ...FLOW_CONTROLS]);
const codes = new Set([
  ...ERROR_CODES,
  'NETWORK_ERROR',
  'REFRESH_ERROR',
  'REQUEST_TIMEOUT',
  'REQUEST_CANCELLED',
  'INVALID_RESPONSE',
  'RESOURCE_LOAD_ERROR',
  'MODULE_LOAD_ERROR',
  'REACT_RENDER_ERROR',
  'UNHANDLED_REJECTION',
  'CLIENT_RUNTIME_ERROR',
  'ATTACHMENT_COMPENSATION',
  'D1_FAILURE',
  'R2_FAILURE',
  'UPSTREAM_FAILURE',
  'PHOTO_PROCESSING_ERROR',
  'OCR_ERROR',
  'SCANNER_ERROR'
]);
const names = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'EvalError',
  'AggregateError',
  'DOMException',
  'AbortError',
  'TimeoutError',
  'HttpError'
]);
const sources = new Set(SOURCE_FILES);
const routes = ROUTE_DEFINITIONS.map((route) => ({
  ...route,
  expression: new RegExp(route.pattern)
}));
const routeIds = new Set(routes.map((route) => route.id));
const results = new Set(['ok', 'error', 'rejected', 'cancelled', 'open', 'closed', 'start']);
export const uuid = (value) =>
  typeof value === 'string' && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value)
    ? value
    : '';
export const releaseId = (value) =>
  typeof value === 'string' && /^[a-f\d]{7,40}$/i.test(value) ? value : 'local';
export const rate = (value, fallback = 1) =>
  value !== '' &&
  value !== undefined &&
  Number.isFinite(Number(value)) &&
  Number(value) >= 0 &&
  Number(value) <= 1
    ? Number(value)
    : fallback;
export const knownControl = (value) => (controls.has(value) ? value : '');
export const knownView = (value) => (VIEWS.includes(value) ? value : 'unknown');
export const knownCode = (value) => (codes.has(value) ? value : '');
export const knownRoute = (value) => (routeIds.has(value) ? value : 'unknown');
export const number = (value, max = 1e9) =>
  Number.isFinite(value) && value >= 0 ? Math.min(max, value) : 0;

export function routeFor(input, method = 'GET') {
  try {
    const path = new URL(typeof input === 'string' ? input : input.url, 'https://telemetry.invalid')
      .pathname;
    return (
      routes.find((route) => route.method === method && route.expression.test(path))?.id ||
      'unknown'
    );
  } catch {
    return 'unknown';
  }
}

// Only code locations, never messages, arguments, URL queries or local paths.
export function safeFrames(stack) {
  if (typeof stack !== 'string') return '';
  const output = [];
  for (const line of stack.slice(0, 8192).split('\n').slice(1, 20)) {
    const match = line.match(
      /((?:frontend|src|functions|shared|user|staff\/assets|warranty-verifier)\/[A-Za-z0-9_./-]+\.[jt]sx?):(\d{1,7})(?::(\d{1,7}))?/
    );
    if (!match) continue;
    const path = match[1];
    if (
      !sources.has(path) &&
      !sources.has(`frontend/${path}`) &&
      !/^staff\/assets\/[A-Za-z][A-Za-z0-9_-]{0,80}-[A-Za-z0-9_-]{8}\.js$/.test(path)
    )
      continue;
    output.push(`${path}:${match[2]}:${match[3] || '0'}`);
    if (output.length === 6) break;
  }
  return output.join('\n');
}

export function errorFields(error, code = '') {
  return {
    errorName: names.has(error?.name) ? error.name : 'Error',
    errorCode: knownCode(code || error?.code),
    frames: safeFrames(error?.stack),
    requestId: uuid(error?.requestId)
  };
}

export function cleanEvent(input) {
  if (!input || typeof input !== 'object' || !EVENT_NAMES.includes(input.name)) return null;
  if (input.name.startsWith('ui.') && !knownControl(input.control)) return null;
  return {
    name: input.name,
    view: knownView(input.view),
    control: knownControl(input.control),
    route: knownRoute(input.route),
    result: results.has(input.result) ? input.result : 'ok',
    count: Math.max(1, Math.floor(number(input.count, 10000))),
    durationMs: number(input.durationMs, 3600000),
    status: Math.floor(number(input.status, 599)),
    requestId: uuid(input.requestId),
    errorName: names.has(input.errorName) ? input.errorName : '',
    errorCode: knownCode(input.errorCode),
    frames: safeFrames(`Error\n${typeof input.frames === 'string' ? input.frames : ''}`),
    sampleWeight: Math.max(1, number(input.sampleWeight, 10000)),
    release: releaseId(input.release),
    at: number(input.at, 1e14)
  };
}

export const isErrorEvent = (event) =>
  event.name === 'client.error' || event.result === 'error' || event.status >= 500;

// Versioned column contract: see docs/observability/README.md.
export function dataPoint(event, context, metrics = {}) {
  return {
    indexes: [`${event.name}:${event.route === 'unknown' ? event.view : event.route}`.slice(0, 96)],
    blobs: [
      '1',
      event.name,
      event.route,
      event.view,
      event.control,
      event.result,
      event.requestId,
      event.errorName,
      event.errorCode,
      event.frames,
      context.environment,
      context.release,
      event.release,
      context.method || '',
      metrics.failure || ''
    ],
    doubles: [
      event.count,
      event.durationMs,
      event.status,
      event.sampleWeight,
      metrics.d1Calls || 0,
      metrics.d1Ms || 0,
      metrics.rowsRead || 0,
      metrics.rowsWritten || 0,
      metrics.metaCalls || 0,
      metrics.d1Failures || 0,
      metrics.r2Calls || 0,
      metrics.r2Ms || 0,
      metrics.r2Failures || 0,
      metrics.upstreamCalls || 0,
      metrics.upstreamMs || 0,
      metrics.upstreamFailures || 0,
      event.at || 0
    ]
  };
}
