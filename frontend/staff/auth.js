import { $, $$, showToast } from '/shared/utils.js';
import { apiFetch, apiJson, clearSession } from '/shared/api.js';
import { roleLevel } from '/shared/constants.js';
const labels = { student: '基础工作人员', technician: '维修人员', admin: '管理者', superadmin: '最高权限者' };

export function initAuth({ onLogin, onLogout }) {
  function message(value = '') { $('#login-message').textContent = value; $('#login-message').hidden = !value; }
  function showLogin() {
    clearSession(); $('#app-shell').hidden = true; $('#login-view').hidden = false;
    $('#login-form').reset(); onLogout?.();
  }
  function enter(payload) {
    sessionStorage.setItem('pioneerRole', payload.role);
    sessionStorage.setItem('pioneerAccount', payload.account);
    if (payload.token) sessionStorage.setItem('pioneerToken', payload.token);
    $('#login-view').hidden = true; $('#app-shell').hidden = false; $('#logout-btn').hidden = false;
    $('#account-role').textContent = `${labels[payload.role]} · ${payload.account}`;
    $$('[data-role-allow]').forEach(element => {
      element.hidden = !element.dataset.roleAllow.split(',').some(role => roleLevel[payload.role] >= roleLevel[role]);
    });
    message(); onLogin(payload.role);
  }
  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button'); button.disabled = true;
    try {
      const payload = await apiJson('/api/auth/login', { method: 'POST', json: { account: $('#login-id').value.trim(), password: $('#login-password').value } });
      enter(payload); $('#login-password').value = ''; showToast('登录成功');
    } catch (error) { message(error.message || '无法连接服务器，请稍后重试'); }
    finally { button.disabled = false; }
  });
  $('#logout-btn').addEventListener('click', async () => {
    try {
      const response = await apiFetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok && response.status !== 401) throw new Error('logout failed');
    } catch { showToast('网络异常，服务器会话未撤销；本机已退出'); }
    showLogin(); message();
  });
  window.addEventListener('auth-expired', () => { showLogin(); message('登录已过期，请重新登录'); });
  if (sessionStorage.getItem('pioneerToken')) apiFetch('/api/auth/me').then(async response => {
    if (!response.ok) { showLogin(); return; }
    enter(await response.json());
  }).catch(() => message('会话验证失败，请稍后重试'));
}
