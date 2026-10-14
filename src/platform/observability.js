import { nowIso } from './time.js';

const SAFE_KEYS = ['module', 'action', 'resource', 'result', 'durationMs', 'requestId', 'schemaVersion', 'codeVersion'];

export function requestTrace(request) {
  const incoming = request.headers.get('x-request-id') || request.headers.get('x-correlation-id');
  return typeof incoming === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(incoming) ? incoming : crypto.randomUUID();
}

export function observation(context, fields = {}) {
  const data = { at: nowIso(), requestId: context.requestId, ...fields };
  return Object.fromEntries(SAFE_KEYS.filter(key => data[key] !== undefined).map(key => [key, data[key]]));
}

export function timed(context, fields, operation) {
  const started = Date.now();
  return Promise.resolve().then(operation).then(result => {
    const record = observation(context, { ...fields, result: 'ok', durationMs: Date.now() - started });
    context.observe?.(record);
    return result;
  }, error => {
    const record = observation(context, { ...fields, result: 'error', durationMs: Date.now() - started });
    context.observe?.(record);
    throw error;
  });
}
