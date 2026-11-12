let staffSession = false;
export function useStaffSession() { staffSession = true; }
export function clearSession() {
  ['pioneerRole','pioneerMemberId','pioneerAccount','pioneerToken','pioneerCampuses'].forEach(key => sessionStorage.removeItem(key));
}
function deadline(timeoutMs, signal) {
  if (!timeoutMs) return { signal, dispose() {} };
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, dispose() { clearTimeout(timer); signal?.removeEventListener('abort', abort); } };
}
export async function apiFetch(input, { json, suppressAuthExpired = false, timeoutMs, ...options } = {}) {
  const headers = new Headers(options.headers || {});
  if (json !== undefined) { headers.set('Content-Type', 'application/json'); options.body = JSON.stringify(json); }
  const token = staffSession ? sessionStorage.getItem('pioneerToken') : null;
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const limit = deadline(timeoutMs, options.signal);
  let response;
  try { response = await fetch(input, { ...options, headers, signal: limit.signal }); }
  finally { limit.dispose(); }
  if (response.status === 401 && token && token === sessionStorage.getItem('pioneerToken') && !suppressAuthExpired) { clearSession(); window.dispatchEvent(new CustomEvent('auth-expired')); }
  return response;
}
export async function apiJson(input, { timeoutMs, ...options } = {}) {
  const limit = deadline(timeoutMs, options.signal);
  try {
  const response = await apiFetch(input, { ...options, signal: limit.signal });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || '请求失败，请稍后重试');
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
    const headers = new Headers(values);
    const token = staffSession ? sessionStorage.getItem('pioneerToken') : null;
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const abort = () => xhr.abort();
    const done = (error, payload) => {
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(payload);
    };
    if (signal?.aborted) { reject(new DOMException('上传已取消', 'AbortError')); return; }
    xhr.open('POST', input);
    xhr.timeout = timeoutMs;
    headers.forEach((value, key) => xhr.setRequestHeader(key, value));
    xhr.upload.onprogress = event => onProgress?.({ loaded: event.loaded, total: event.lengthComputable ? event.total : body.size });
    xhr.upload.onload = () => onProgress?.({ loaded: body.size, total: body.size });
    xhr.onerror = () => done(Object.assign(new Error('网络连接中断，请重试。'), { code: 'NETWORK_ERROR' }));
    xhr.ontimeout = () => done(new DOMException('上传超时，请重试。', 'TimeoutError'));
    xhr.onabort = () => done(new DOMException('上传已取消', 'AbortError'));
    xhr.onload = () => {
      if (xhr.status === 401 && token && token === sessionStorage.getItem('pioneerToken')) {
        clearSession(); window.dispatchEvent(new CustomEvent('auth-expired'));
      }
      let payload;
      try { payload = JSON.parse(xhr.responseText); }
      catch { done(Object.assign(new Error('上传响应异常，请重试。'), { status: xhr.status })); return; }
      if (xhr.status < 200 || xhr.status >= 300) {
        done(Object.assign(new Error(payload.error || '上传失败，请重试。'), { status: xhr.status, code: payload.code, fields: payload.fields }));
      } else done(null, payload);
    };
    signal?.addEventListener('abort', abort, { once: true });
    try { xhr.send(body); } catch (error) { done(error); }
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
    const response = await apiFetch(input, { ...requestOptions, signal: limit.signal });
    if (!response.ok) { const error = new Error('附件暂时无法读取，请重试。'); error.status = response.status; throw error; }
    return await response.blob();
  } finally { limit.dispose(); }
}
