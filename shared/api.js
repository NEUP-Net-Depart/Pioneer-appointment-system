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
  if (response.status === 401 && token && !suppressAuthExpired) { clearSession(); window.dispatchEvent(new CustomEvent('auth-expired')); }
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
export async function apiBlob(input, { timeoutMs = 30000, ...options } = {}) {
  const limit = deadline(timeoutMs, options.signal);
  try {
    const response = await apiFetch(input, { ...options, signal: limit.signal });
    if (!response.ok) { const error = new Error('附件暂时无法读取，请重试。'); error.status = response.status; throw error; }
    return await response.blob();
  } finally { limit.dispose(); }
}
