let staffSession = false;
export function useStaffSession() { staffSession = true; }
export function clearSession() {
  ['pioneerRole','pioneerAccount','pioneerToken','pioneerCampuses'].forEach(key => sessionStorage.removeItem(key));
}
export async function apiFetch(input, { json, timeoutMs, ...options } = {}) {
  const headers = new Headers(options.headers || {});
  if (json !== undefined) { headers.set('Content-Type', 'application/json'); options.body = JSON.stringify(json); }
  const token = staffSession ? sessionStorage.getItem('pioneerToken') : null;
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let response;
  try { response = await fetch(input, { ...options, headers, ...(controller ? { signal: controller.signal } : {}) }); }
  finally { clearTimeout(timer); }
  if (response.status === 401 && token) { clearSession(); window.dispatchEvent(new CustomEvent('auth-expired')); }
  return response;
}
export async function apiJson(input, { timeoutMs, ...options } = {}) {
  const controller=timeoutMs ? new AbortController() : null;
  const timer=controller ? setTimeout(()=>controller.abort(),timeoutMs) : null;
  try {
    const response = await apiFetch(input,{...options,...(controller ? {signal:controller.signal} : {})});
    const payload = await response.json();
    if (!response.ok) { const error = new Error(payload.error || '请求失败，请稍后重试'); error.status = response.status; error.code = payload.code; error.fields = payload.fields; throw error; }
    return payload;
  } finally {clearTimeout(timer);}
}
export async function apiBlob(input, {timeoutMs=30000,...options} = {}) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response=await apiFetch(input,{...options,signal:controller.signal});
    if(!response.ok){const error=new Error('附件暂时无法读取，请重试。');error.status=response.status;throw error;}
    return await response.blob();
  } finally {clearTimeout(timer);}
}
