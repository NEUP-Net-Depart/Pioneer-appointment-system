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
export async function apiFetch(input, { json, suppressAuthExpired = false, timeoutMs, telemetryPoll = false, telemetryDeadline, telemetryDeferred = false, ...options } = {}) {
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
  if (!telemetryDeferred) trackRequest(input, method, response, Date.now() - started);
  if (response.status === 401 && token && token === sessionStorage.getItem('pioneerToken') && !suppressAuthExpired) { clearSession(); window.dispatchEvent(new CustomEvent('auth-expired')); }
  return response;
}
export async function apiJson(input, { timeoutMs, ...options } = {}) {
  const limit = deadline(timeoutMs, options.signal), started = Date.now(), method = (options.method || 'GET').toUpperCase();
  try {
  const response = await apiFetch(input, { ...options, signal: limit.signal, telemetryDeadline: limit, telemetryDeferred: true });
  let payload;
  try { payload = await response.json(); } catch (error) {
    trackRequest(input, method, response, Date.now() - started, error, limit.timedOut() ? 'REQUEST_TIMEOUT' : options.signal?.aborted ? 'REQUEST_CANCELLED' : 'INVALID_RESPONSE');
    throw error;
  }
  trackRequest(input, method, response, Date.now() - started, null, null, payload);
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

// XHR exposes upload byte progress on mobile browsers; the body stays binary.
export function apiUpload(input, { body, headers: values = {}, timeoutMs = 0, onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const started = Date.now();
    let settled = false;
    const headers = new Headers(values);
    const token = staffSession ? sessionStorage.getItem('pioneerToken') : null;
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const abort = () => xhr.abort();
    const done = (error, payload, code) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      const response = xhr.status ? { status: xhr.status, ok: xhr.status >= 200 && xhr.status < 300, headers: new Headers({ 'X-Request-ID': xhr.getResponseHeader('X-Request-ID') || '' }) } : null;
      if (error) error.requestId = response?.headers.get('X-Request-ID') || undefined;
      trackRequest(input, 'POST', response, Date.now() - started, payload ? null : error, code, payload);
      if (error) reject(error); else resolve(payload);
    };
    if (signal?.aborted) { done(new DOMException('上传已取消', 'AbortError'), null, 'REQUEST_CANCELLED'); return; }
    xhr.open('POST', input);
    xhr.timeout = timeoutMs;
    headers.forEach((value, key) => xhr.setRequestHeader(key, value));
    xhr.upload.onprogress = event => onProgress?.({ loaded: event.loaded, total: event.lengthComputable ? event.total : body.size });
    xhr.upload.onload = () => onProgress?.({ loaded: body.size, total: body.size });
    xhr.onerror = () => done(Object.assign(new Error('网络连接中断，请重试。'), { code: 'NETWORK_ERROR' }), null, 'NETWORK_ERROR');
    xhr.ontimeout = () => done(new DOMException('上传超时，请重试。', 'TimeoutError'), null, 'REQUEST_TIMEOUT');
    xhr.onabort = () => done(new DOMException('上传已取消', 'AbortError'), null, 'REQUEST_CANCELLED');
    xhr.onload = () => {
      if (xhr.status === 401 && token && token === sessionStorage.getItem('pioneerToken')) {
        clearSession(); window.dispatchEvent(new CustomEvent('auth-expired'));
      }
      let payload;
      try { payload = JSON.parse(xhr.responseText); }
      catch { done(Object.assign(new Error('上传响应异常，请重试。'), { status: xhr.status }), null, 'INVALID_RESPONSE'); return; }
      if (xhr.status < 200 || xhr.status >= 300) {
        done(Object.assign(new Error(payload.error || '上传失败，请重试。'), { status: xhr.status, code: payload.code, fields: payload.fields }), payload);
      } else done(null, payload);
    };
    signal?.addEventListener('abort', abort, { once: true });
    try { xhr.send(body); } catch (error) { done(error, null, 'NETWORK_ERROR'); }
  });
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
