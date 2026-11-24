const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' };

export const $ = (selector: string, parent: ParentNode = document) => parent.querySelector(selector);
export const $$ = (selector: string, parent: ParentNode = document) => [...parent.querySelectorAll(selector)];
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function showToast(message: string) {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}
export function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, char => entities[char]); }
export function assigneeLabel(account: string | null | undefined, name = '') {
  const label = String(name || '').trim();
  return account ? label ? `${label}（${account}）` : String(account) : '';
}
