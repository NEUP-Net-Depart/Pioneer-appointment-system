import { isObject, type ApiFailure } from './api-types.ts';

export interface ApiRequestOptions extends RequestInit {
  json?: unknown;
  suppressAuthExpired?: boolean;
  timeoutMs?: number;
  telemetryPoll?: boolean;
  telemetryDeadline?: { timedOut: () => boolean };
  telemetryDeferred?: boolean;
}

export interface UploadOptions {
  body: Blob;
  headers?: HeadersInit;
  timeoutMs?: number;
  onProgress?: (progress: { loaded: number; total: number }) => void;
  signal?: AbortSignal | null;
}

import { trackRequest, reportClientError } from './telemetry-client.ts';
import { routeFor } from './telemetry.ts';
let staffSession = false;
export function useStaffSession() { staffSession = true; }
export function clearSession() {
  ['pioneerRole','pioneerMemberId','pioneerAccount','pioneerToken','pioneerCampuses'].forEach(key => sessionStorage.removeItem(key));
}
function httpFailure(payload: unknown, status: number, requestId: string | null, fallback: string): ApiFailure {
  const details = isObject(payload) ? payload : {};
  const error: ApiFailure = new Error(typeof details.error === 'string' && details.error ? details.error : fallback);
  error.status = status;
  error.requestId = requestId || (typeof details.requestId === 'string' ? details.requestId : undefined);
  if (typeof details.code === 'string') error.code = details.code;
  if (isObject(details.fields)) {
    error.fields = Object.fromEntries(Object.entries(details.fields).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  }
  return error;
}
function deadline(timeoutMs: number | undefined, signal?: AbortSignal | null) {
  if (!timeoutMs) return { signal, timedOut: () => false, dispose() {} };
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  let expired = false;
  const timer = setTimeout(() => { expired = true; controller.abort(); }, timeoutMs);
  return { signal: controller.signal, timedOut: () => expired, dispose() { clearTimeout(timer); signal?.removeEventListener('abort', abort); } };
}
export async function apiFetch(input: string, { json, suppressAuthExpired = false, timeoutMs, telemetryPoll = false, telemetryDeadline, telemetryDeferred = false, ...options }: ApiRequestOptions = {}) {
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
export async function apiJson<T = unknown>(input: string, { timeoutMs, ...options }: ApiRequestOptions = {}): Promise<T> {
  const limit = deadline(timeoutMs, options.signal), started = Date.now(), method = (options.method || 'GET').toUpperCase();
  try {
  const response = await apiFetch(input, { ...options, signal: limit.signal, telemetryDeadline: limit, telemetryDeferred: true });
  let payload: unknown;
  try { payload = await response.json(); } catch (error) {
    trackRequest(input, method, response, Date.now() - started, error, limit.timedOut() ? 'REQUEST_TIMEOUT' : options.signal?.aborted ? 'REQUEST_CANCELLED' : 'INVALID_RESPONSE');
    throw error;
  }
  trackRequest(input, method, response, Date.now() - started, null, null, payload);
  if (!response.ok) {
    throw httpFailure(payload, response.status, response.headers.get('X-Request-ID'), '请求失败，请稍后重试');
  }
  return payload as T;
  } finally { limit.dispose(); }
}

// XHR exposes upload byte progress on mobile browsers; the body stays binary.
export function apiUpload<T = unknown>(input: string, { body, headers: values = {}, timeoutMs = 0, onProgress, signal }: UploadOptions): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const started = Date.now();
    let settled = false;
    const headers = new Headers(values);
    const token = staffSession ? sessionStorage.getItem('pioneerToken') : null;
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const abort = () => xhr.abort();
    const done = (error: unknown, payload: unknown, code?: string) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      const response = xhr.status ? { status: xhr.status, ok: xhr.status >= 200 && xhr.status < 300, headers: new Headers({ 'X-Request-ID': xhr.getResponseHeader('X-Request-ID') || '' }) } : null;
      const requestId = response?.headers.get('X-Request-ID');
      if (requestId && error instanceof Error) Object.assign(error, { requestId });
      trackRequest(input, 'POST', response, Date.now() - started, code ? error : null, code, payload);
      if (error) reject(error); else resolve(payload as T);
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
      let payload: unknown;
      try { payload = JSON.parse(xhr.responseText); }
      catch { done(Object.assign(new Error('上传响应异常，请重试。'), { status: xhr.status }), null, 'INVALID_RESPONSE'); return; }
      if (xhr.status < 200 || xhr.status >= 300) {
        done(httpFailure(payload, xhr.status, xhr.getResponseHeader('X-Request-ID'), '上传失败，请重试。'), payload);
      } else done(null, payload);
    };
    signal?.addEventListener('abort', abort, { once: true });
    try { xhr.send(body); } catch (error) { done(error, null, 'NETWORK_ERROR'); }
  });
}
export async function apiBlob(input: string, options: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 30000, ...requestOptions } = options;
  const limit = deadline(timeoutMs, requestOptions.signal);
  try {
    const response = await apiFetch(input, { ...requestOptions, signal: limit.signal, telemetryDeadline: limit });
    if (!response.ok) { const error: ApiFailure = new Error('附件暂时无法读取，请重试。'); error.status = response.status; error.requestId = response.headers.get('X-Request-ID'); throw error; }
    try { return await response.blob(); } catch (error) {
      if (!requestOptions.signal?.aborted || limit.timedOut()) reportClientError(error, limit.timedOut() ? 'REQUEST_TIMEOUT' : 'INVALID_RESPONSE', { route: routeFor(input), requestId: response.headers.get('X-Request-ID') });
      throw error;
    }
  } finally { limit.dispose(); }
}
