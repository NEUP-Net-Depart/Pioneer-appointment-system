import { trackRequest, reportClientError } from './telemetry-client.js';
import { routeFor } from './telemetry.js';
let staffSession = false;
export function useStaffSession() { staffSession = true; }
export function clearSession() {
  ['pioneerRole','pioneerMemberId','pioneerAccount','pioneerToken','pioneerCampuses'].forEach(key => sessionStorage.removeItem(key));
}
function deadline(timeoutMs, signal) {
  if (!timeoutMs) return { signal, timedOut: () => false, dispose() {} };
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  let expired = false;
  const timer = setTimeout(() => { expired = true; controller.abort(); }, timeoutMs);
  return { signal: controller.signal, timedOut: () => expired, dispose() { clearTimeout(timer); signal?.removeEventListener('abort', abort); } };
}
export async function apiFetch(input, { json, suppressAuthExpired = false, timeoutMs, telemetryPoll = false, telemetryDeadline, ...options } = {}) {
  const headers = new Headers(options.headers || {});
  if (json !== undefined) { headers.set('Content-Type', 'application/json'); options.body = JSON.stringify(json); }
  const token = staffSession ? sessionStorage.getItem('pioneerToken') : null;
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const limit = deadline(timeoutMs, options.signal);
  const started = Date.now(), method = (options.method || 'GET').toUpperCase();
  if (telemetryPoll && method === 'GET') headers.set('X-Telemetry-Poll', '1');
  let response;
  try { response = await fetch(input, { ...options, headers, signal: limit.signal }); }
  catch (error) {
    const code = limit.timedOut() || telemetryDeadline?.timedOut() ? 'REQUEST_TIMEOUT' : options.signal?.aborted ? 'REQUEST_CANCELLED' : 'NETWORK_ERROR';
    trackRequest(input, method, null, Date.now() - started, error, code);
    throw error;
  } finally { limit.dispose(); }
  trackRequest(input, method, response, Date.now() - started);
  if (response.status === 401 && token && token === sessionStorage.getItem('pioneerToken') && !suppressAuthExpired) { clearSession(); window.dispatchEvent(new CustomEvent('auth-expired')); }
  return response;
}
export async function apiJson(input, { timeoutMs, ...options } = {}) {
  const limit = deadline(timeoutMs, options.signal);
  try {
  const response = await apiFetch(input, { ...options, signal: limit.signal, telemetryDeadline: limit });
  let payload;
  try { payload = await response.json(); } catch (error) {
    if (!options.signal?.aborted || limit.timedOut()) reportClientError(error, limit.timedOut() ? 'REQUEST_TIMEOUT' : 'INVALID_RESPONSE', { route: routeFor(input, options.method || 'GET'), requestId: response.headers.get('X-Request-ID') });
    throw error;
  }
  if (!response.ok) {
    const error = new Error(payload.error || '请求失败，请稍后重试');
    error.requestId = response.headers.get('X-Request-ID') || payload.requestId;
    error.status = response.status;
    error.code = payload.code;
    error.fields = payload.fields;
    throw error;
  }
  return payload;
  } finally { limit.dispose(); }
}
/**
 * @param {string} input
 * @param {RequestInit & { timeoutMs?: number }} [options]
 */
export async function apiBlob(input, options = {}) {
  const { timeoutMs = 30000, ...requestOptions } = options;
  const limit = deadline(timeoutMs, requestOptions.signal);
  try {
    const response = await apiFetch(input, { ...requestOptions, signal: limit.signal, telemetryDeadline: limit });
    if (!response.ok) { const error = new Error('附件暂时无法读取，请重试。'); error.status = response.status; error.requestId = response.headers.get('X-Request-ID'); throw error; }
    try { return await response.blob(); } catch (error) {
      if (!requestOptions.signal?.aborted || limit.timedOut()) reportClientError(error, limit.timedOut() ? 'REQUEST_TIMEOUT' : 'INVALID_RESPONSE', { route: routeFor(input), requestId: response.headers.get('X-Request-ID') });
      throw error;
    }
  } finally { limit.dispose(); }
}
