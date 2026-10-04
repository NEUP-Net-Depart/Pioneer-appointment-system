import { $, $$, showToast } from './utils.js';

let hideStaffEntry = false;

export const roleLabels = { guest: '访客预约', student: '学生账号', technician: '维修人员 / 学生', admin: '管理者 / 维修人员', superadmin: '最高权限者' };
export const roleAccess = { guest: ['guest'], student: ['guest', 'student'], technician: ['guest', 'student', 'technician'], admin: ['guest', 'student', 'technician', 'admin'], superadmin: ['guest', 'student', 'technician', 'admin', 'superadmin'] };

function applyAccess(role) {
  const access = roleAccess[role] || roleAccess.guest;
  $$('[data-role-allow]').forEach(element => { element.hidden = !element.dataset.roleAllow.split(',').some(item => access.includes(item)); });
}

function enterGuest(onLogin) {
  sessionStorage.removeItem('pioneerRole');
  sessionStorage.removeItem('pioneerAccount');
  sessionStorage.removeItem('pioneerToken');
  $('#login-view').hidden = true;
  $('#app-shell').hidden = false;
  $('#account-role').textContent = roleLabels.guest;
  $('#staff-login-btn').hidden = hideStaffEntry;
  $('#logout-btn').hidden = true;
  applyAccess('guest');
  onLogin?.('guest');
}

function enterStaffApp(payload, onLogin) {
  const { role, account, token } = payload;
  sessionStorage.setItem('pioneerRole', role);
  sessionStorage.setItem('pioneerAccount', account);
  if (token) sessionStorage.setItem('pioneerToken', token);
  $('#login-view').hidden = true;
  $('#app-shell').hidden = false;
  $('#account-role').textContent = `${roleLabels[role]} · ${account}`;
  $('#staff-login-btn').hidden = true;
  $('#logout-btn').hidden = false;
  applyAccess(role);
  onLogin?.(role);
}

function errorMessage(response, fallback) { return response.json().then(body => body.error || fallback).catch(() => fallback); }
function showLoginMessage(message, kind = 'error') { const target = $('#login-message'); target.textContent = message; target.dataset.kind = kind; target.hidden = !message; }

export function initAuth({ onLogin, onLogout }) {
  const params = new URLSearchParams(window.location.search);
  const pageMode = params.get('mode') === 'staff' ? 'staff' : 'user';
  hideStaffEntry = params.get('entry') === 'user';
  const savedRole = sessionStorage.getItem('pioneerRole'); const savedAccount = sessionStorage.getItem('pioneerAccount'); const savedToken = sessionStorage.getItem('pioneerToken');
  const enterCurrentMode = () => {
    if (pageMode === 'staff') {
      $('#login-view').hidden = false;
      $('#app-shell').hidden = true;
      $('#login-hint').hidden = true;
      $('#cancel-staff-login').textContent = '返回用户预约';
      $('#cancel-staff-login').onclick = () => { window.location.href = '/user.html'; };
    } else {
      enterGuest(onLogin);
    }
  };
  enterCurrentMode();
  $('#staff-login-btn').addEventListener('click', () => { if (pageMode === 'staff') return; $('#login-view').hidden = false; $('#login-id').focus(); });
  if (pageMode !== 'staff') $('#cancel-staff-login').addEventListener('click', () => { $('#login-view').hidden = true; showLoginMessage(''); });
  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; if (!form.checkValidity()) { form.reportValidity(); return; }
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account: $('#login-id').value.trim(), password: $('#login-password').value }) });
      if (!response.ok) { showLoginMessage(await errorMessage(response, '账号或密码不正确')); return; }
      showLoginMessage('');
      const payload = await response.json(); enterStaffApp(payload, onLogin); showToast(`${roleLabels[payload.role]}登录成功`);
    } catch { showLoginMessage('无法连接服务器，请稍后重试'); }
  });
  ['#login-id', '#login-password'].forEach(selector => $(selector).addEventListener('input', () => showLoginMessage('')));
  $('#logout-btn').addEventListener('click', async () => {
    const token = sessionStorage.getItem('pioneerToken');
    if (token) await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    $('#login-form').reset(); showLoginMessage(''); if (pageMode === 'staff') { sessionStorage.removeItem('pioneerRole'); sessionStorage.removeItem('pioneerAccount'); sessionStorage.removeItem('pioneerToken'); $('#app-shell').hidden = true; $('#login-view').hidden = false; applyAccess('guest'); onLogout?.(); } else enterGuest(onLogout);
  });
  window.addEventListener('auth-expired', () => {
    if (!$('#app-shell').hidden && !$('#logout-btn').hidden) { $('#login-form').reset(); if (pageMode === 'staff') { $('#app-shell').hidden = true; $('#login-view').hidden = false; } else enterGuest(onLogout); showLoginMessage('登录已过期，请重新登录'); }
  });
  if (savedRole && savedAccount && savedToken && roleLabels[savedRole] && savedRole !== 'guest') fetch('/api/auth/me', { headers: { Authorization: `Bearer ${savedToken}` } }).then(async response => { if (!response.ok) throw new Error('expired'); const current = await response.json(); enterStaffApp({ role: current.role, account: current.account, token: savedToken }, onLogin); }).catch(() => { sessionStorage.removeItem('pioneerRole'); sessionStorage.removeItem('pioneerAccount'); sessionStorage.removeItem('pioneerToken'); if (pageMode === 'staff') { $('#app-shell').hidden = true; $('#login-view').hidden = false; } else enterGuest(onLogin); showLoginMessage('登录已过期，请重新登录'); });
}
