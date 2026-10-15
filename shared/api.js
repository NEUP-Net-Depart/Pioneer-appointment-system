let staffSession = false;
export function useStaffSession() { staffSession = true; }
export function clearSession() {
  ['pioneerRole','pioneerMemberId','pioneerAccount','pioneerToken','pioneerCampuses'].forEach(key => sessionStorage.removeItem(key));
}
export async function apiFetch(input, { json, suppressAuthExpired = false, ...options } = {}) {
  const headers = new Headers(options.headers || {});
  if (json !== undefined) { headers.set('Content-Type', 'application/json'); options.body = JSON.stringify(json); }
  const token = staffSession ? sessionStorage.getItem('pioneerToken') : null;
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(input, { ...options, headers });
  if (response.status === 401 && token && !suppressAuthExpired) { clearSession(); window.dispatchEvent(new CustomEvent('auth-expired')); }
  return response;
}
export async function apiJson(input, options) {
  const response = await apiFetch(input, options);
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || '请求失败，请稍后重试');
    error.status = response.status;
    error.code = payload.code;
    throw error;
  }
  return payload;
}
