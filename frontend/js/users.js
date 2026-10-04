import { $, $$, showToast, escapeHtml, apiFetch } from './utils.js';

const STORAGE_KEY = 'pioneerRepairUsers';
const systemUsers = [
  { account: 'root001', name: '系统负责人 1', role: 'superadmin', campus: '南湖 / 浑南', active: true, protected: true, createdAt: '系统内置' },
  { account: 'root002', name: '系统负责人 2', role: 'superadmin', campus: '南湖 / 浑南', active: true, protected: true, createdAt: '系统内置' }
];
const seedUsers = [
  { account: '20250001', name: '王工', role: 'technician', campus: '南湖', active: true, createdAt: '2026-09-01' },
  { account: '20250002', name: '李工', role: 'technician', campus: '浑南', active: true, createdAt: '2026-09-02' },
  { account: '20250003', name: '管理员', role: 'admin', campus: '南湖', active: true, createdAt: '2026-09-01' },
  { account: '20250004', name: '管理员 2', role: 'admin', campus: '浑南', active: true, createdAt: '2026-09-01' }
];
const roleNames = { student: '学生', technician: '维修人员', admin: '管理者', superadmin: '最高权限者' };
const roleLevel = { student: 0, technician: 1, admin: 2, superadmin: 3 };

function loadUsers() { const raw = localStorage.getItem(STORAGE_KEY); if (!raw) { localStorage.setItem(STORAGE_KEY, JSON.stringify(seedUsers)); return seedUsers.map(item => ({ ...item })); } try { return JSON.parse(raw).map(item => ({ role: 'student', ...item })); } catch { return seedUsers.map(item => ({ ...item })); } }
function saveUsers(users) { localStorage.setItem(STORAGE_KEY, JSON.stringify(users)); }

export function initUsers(appointments) {
  const users = loadUsers();
  const currentRole = () => sessionStorage.getItem('pioneerRole') || 'student';
  const isSuperAdmin = () => currentRole() === 'superadmin';
  const canManage = user => currentRole() !== 'student' && !user.protected && roleLevel[currentRole()] > (roleLevel[user.role] ?? 99);
  async function syncUsers() { try { const response = await apiFetch('/api/users'); if (!response.ok) return; const payload = await response.json(); users.splice(0, users.length, ...payload.items.filter(item => !item.protected)); saveUsers(users); render(); } catch { /* Keep local user cache when the API is unavailable. */ } }
  function render() {
    const query = $('#user-search').value.trim().toLowerCase();
    const rows = [...systemUsers, ...users].filter(user => !query || [user.account, user.name, user.campus, roleNames[user.role] || user.role].some(value => String(value).toLowerCase().includes(query)));
    $('#users-table').innerHTML = rows.map(user => {
      const workload = appointments.filter(item => item.assignedTo === user.name || item.assignedTo === user.account).length;
      const canPromoteStudent = currentRole() === 'admin' && user.role === 'student' && canManage(user);
      const roleCell = (isSuperAdmin() && canManage(user)) || canPromoteStudent ? `<select class="user-role-select" data-role-account="${escapeHtml(user.account)}"><option value="${user.role}" selected>${roleNames[user.role]}</option>${user.role === 'student' ? '<option value="technician">维修人员</option>' : ''}${isSuperAdmin() && user.role !== 'admin' ? '<option value="admin">管理员</option>' : ''}</select>` : `<span class="user-role">${roleNames[user.role] || user.role}</span>`;
      const canDelete = canManage(user);
      const actions = user.protected ? '<span class="cell-muted">系统保护</span>' : canManage(user) ? `<button class="record-btn" data-toggle-user="${escapeHtml(user.account)}">${user.active ? '停用' : '启用'}</button><button class="record-btn user-action" data-reset-user="${escapeHtml(user.account)}">重置密码</button>${canDelete ? `<button class="record-btn danger-action" data-delete-user="${escapeHtml(user.account)}">删除账号</button>` : ''}` : '<button class="record-btn permission-denied" data-permission-denied="true">权限不足</button>';
      return `<tr><td><span class="person-name">${escapeHtml(user.account)}</span><span class="person-code">创建于 ${escapeHtml(user.createdAt || '未记录')}</span></td><td>${escapeHtml(user.name)}</td><td>${roleCell}</td><td>${escapeHtml(user.campus)}</td><td><span class="user-status ${user.active ? 'is-active' : 'is-disabled'}">${user.active ? '启用' : '已停用'}</span></td><td>${workload} 条记录</td><td>${actions}</td></tr>`;
    }).join('');
    $('#users-empty').hidden = rows.length > 0;
    $$('[data-toggle-user]').forEach(button => button.addEventListener('click', async () => { const user = users.find(item => item.account === button.dataset.toggleUser); if (!user) return; const nextActive = !user.active; try { const response = await apiFetch(`/api/users/${encodeURIComponent(user.account)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: nextActive }) }); if (!response.ok) { showToast('账号状态更新失败'); return; } user.active = nextActive; } catch { showToast('无法连接服务器'); return; } saveUsers(users); render(); showToast(user.active ? '账号已启用' : '账号已停用'); }));
    $$('[data-reset-user]').forEach(button => button.addEventListener('click', async () => { const password = window.prompt('请输入新的初始密码（至少 8 位）'); if (!password) return; try { const response = await apiFetch(`/api/users/${encodeURIComponent(button.dataset.resetUser)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }); if (!response.ok) { showToast('密码重置失败'); return; } showToast('密码已重置'); } catch { showToast('无法连接服务器'); } }));
    $$('[data-delete-user]').forEach(button => button.addEventListener('click', async () => { if (!window.confirm(`确认永久删除 ${button.dataset.deleteUser} 吗？历史预约记录会保留，但账号将无法登录。`)) return; try { const response = await apiFetch(`/api/users/${encodeURIComponent(button.dataset.deleteUser)}`, { method: 'DELETE' }); if (!response.ok) { const body = await response.json().catch(() => ({})); showToast(body.error || '操作失败'); return; } const index = users.findIndex(item => item.account === button.dataset.deleteUser); if (index >= 0) users.splice(index, 1); saveUsers(users); render(); showToast('账号已删除，历史预约记录已保留'); } catch { showToast('无法连接服务器'); } }));
    $$('[data-permission-denied]').forEach(button => button.addEventListener('click', () => showToast('权限不足：只能管理权限低于自己的账号')));
    $$('.user-role-select').forEach(select => select.addEventListener('change', async () => { const user = users.find(item => item.account === select.dataset.roleAccount); const canChange = isSuperAdmin() || (currentRole() === 'admin' && user?.role === 'student'); if (!user || !canChange) return; const role = select.value; const previous = user.role; try { const response = await apiFetch(`/api/users/${encodeURIComponent(user.account)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) }); if (!response.ok) { const body = await response.json().catch(() => ({})); showToast(body.error || '权限更新失败'); render(); return; } user.role = role; } catch { showToast('无法连接服务器'); render(); return; } saveUsers(users); render(); showToast(`${user.account} 已更新为${roleNames[user.role]}`); }));
  }
  $('#user-form').addEventListener('submit', async event => { event.preventDefault(); const account = $('#user-account').value.trim(); if (!/^\d{6,20}$/.test(account)) { showToast('学号应为 6 至 20 位数字'); return; } if (users.some(user => user.account === account) || systemUsers.some(user => user.account === account)) { showToast('学号已存在'); return; } const draft = { account, name: $('#user-name').value.trim(), campus: $('#user-campus').value, password: $('#user-password').value }; try { const response = await apiFetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) }); if (!response.ok) { const body = await response.json().catch(() => ({})); showToast(body.error || '账号创建失败'); return; } const created = await response.json(); users.push(created); saveUsers(users); event.currentTarget.reset(); render(); showToast('工作人员账号已创建，可继续分配权限'); } catch { showToast('无法连接服务器'); } });
  $('#user-search').addEventListener('input', render);
  $('#reset-user-form').addEventListener('click', () => $('#user-form').reset());
  render();
  return syncUsers;
}
