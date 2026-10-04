export const $ = (selector, parent = document) => parent.querySelector(selector);
export const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
export function localDateString(date = new Date()) { const offset = date.getTimezoneOffset() * 60000; return new Date(date.getTime() - offset).toISOString().slice(0, 10); }
export function formatDate(value) { if (!value) return ''; const [year, month, day] = value.slice(0, 10).split('-'); return `${year}年${Number(month)}月${Number(day)}日`; }
export function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('show'), 2400); }
export function generateId(appointments, campus, date) { const campusCode = campus === '浑南' ? '1' : '0'; const day = date.replaceAll('-', ''); const count = appointments.filter(item => item.campus === campus && item.date === date).length + 1; return `${campusCode}${day}-${String(count).padStart(2, '0')}`; }
export function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
export async function apiFetch(input, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = sessionStorage.getItem('pioneerToken');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(input, { ...options, headers });
  if (response.status === 401) window.dispatchEvent(new CustomEvent('auth-expired'));
  return response;
}
