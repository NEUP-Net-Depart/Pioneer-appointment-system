import { $, $$, showToast, escapeHtml } from '/shared/utils.js';
import { apiJson } from '/shared/api.js';

const roleNames = { student: '学生', technician: '维修人员', admin: '管理者', superadmin: '最高权限者' };
import { roleLevel } from '/shared/constants.js';


export function initUsers() {
  const users = [];
  let generation = 0;
  const currentRole = () => sessionStorage.getItem('pioneerRole') || 'student';
  const isSuperAdmin = () => currentRole() === 'superadmin';
  const canManage = user => currentRole() !== 'student' && !user.protected && roleLevel[currentRole()] > (roleLevel[user.role] ?? 99);
  async function syncUsers() {
    const current = ++generation;
    try {
      const payload = await apiJson('/api/users');
      if (current !== generation) return;
      users.splice(0, users.length, ...payload.items); render();
    } catch (error) { if (current === generation) showToast(error.message || '无法连接服务器'); }
  }
  function render() {
    const query = $('#user-search').value.trim().toLowerCase();
    const rows = users.filter(user => !query || [user.account, user.name, user.campus, roleNames[user.role] || user.role].some(value => String(value).toLowerCase().includes(query)));
    $('#users-table').innerHTML = rows.map(user => {
      const workload = user.workload;
      const canPromoteStudent = currentRole() === 'admin' && user.role === 'student' && canManage(user);
      const roleCell = (isSuperAdmin() && canManage(user)) || canPromoteStudent ? `<select class="user-role-select" data-role-account="${escapeHtml(user.account)}"><option value="${user.role}" selected>${roleNames[user.role]}</option>${user.role === 'student' ? '<option value="technician">维修人员</option>' : ''}${isSuperAdmin() && user.role !== 'admin' ? '<option value="admin">管理员</option>' : ''}</select>` : `<span class="user-role">${roleNames[user.role] || user.role}</span>`;
      const canDelete = canManage(user);
      const actions = user.protected ? '<span class="cell-muted">系统保护</span>' : canManage(user) ? `<button class="record-btn" data-toggle-user="${escapeHtml(user.account)}">${user.active ? '停用' : '启用'}</button><button class="record-btn user-action" data-reset-user="${escapeHtml(user.account)}">重置密码</button>${canDelete ? `<button class="record-btn danger-action" data-delete-user="${escapeHtml(user.account)}">删除账号</button>` : ''}` : '<button class="record-btn permission-denied" data-permission-denied="true">权限不足</button>';
      return `<tr><td><span class="person-name">${escapeHtml(user.account)}</span><span class="person-code">创建于 ${escapeHtml(user.createdAt || '未记录')}</span></td><td>${escapeHtml(user.name)}</td><td>${roleCell}</td><td>${escapeHtml(user.campus)}</td><td><span class="user-status ${user.active ? 'is-active' : 'is-disabled'}">${user.active ? '启用' : '已停用'}</span></td><td>${workload} 条记录</td><td>${actions}</td></tr>`;
    }).join('');
    $('#users-empty').hidden = rows.length > 0;
    $$('[data-toggle-user]').forEach(button => button.addEventListener('click', async () => {
      const user = users.find(item => item.account === button.dataset.toggleUser);
      if (!user) return;
      try {
        await apiJson(`/api/users/${encodeURIComponent(user.account)}`, { method: 'PATCH', json: { active: !user.active } });
        await syncUsers(); showToast(user.active ? '账号已停用' : '账号已启用');
      } catch (error) { showToast(error.message); }
    }));
    $$('[data-reset-user]').forEach(button => button.addEventListener('click', async () => {
      const password = window.prompt('请输入新的初始密码（至少 8 位）');
      if (!password) return;
      try {
        await apiJson(`/api/users/${encodeURIComponent(button.dataset.resetUser)}`, { method: 'PATCH', json: { password } });
        showToast('密码已重置');
      } catch (error) { showToast(error.message); }
    }));
    $$('[data-delete-user]').forEach(button => button.addEventListener('click', async () => {
      if (!window.confirm(`确认永久删除 ${button.dataset.deleteUser} 吗？历史预约记录会保留，但账号将无法登录。`)) return;
      try {
        await apiJson(`/api/users/${encodeURIComponent(button.dataset.deleteUser)}`, { method: 'DELETE' });
        await syncUsers(); showToast('账号已删除，历史预约记录已保留');
      } catch (error) { showToast(error.message); }
    }));
    $$('[data-permission-denied]').forEach(button => button.addEventListener('click', () => showToast('权限不足：只能管理权限低于自己的账号')));
    $$('.user-role-select').forEach(select => select.addEventListener('change', async () => {
      const user = users.find(item => item.account === select.dataset.roleAccount);
      if (!user || !(isSuperAdmin() || (currentRole() === 'admin' && user.role === 'student'))) return;
      try {
        const updated = await apiJson(`/api/users/${encodeURIComponent(user.account)}`, { method: 'PATCH', json: { role: select.value } });
        await syncUsers(); showToast(`${user.account} 已更新为${roleNames[updated.role]}`);
      } catch (error) { showToast(error.message); render(); }
    }));
  }
  $('#user-form').addEventListener('submit', async event => {
    event.preventDefault();
    const account = $('#user-account').value.trim();
    if (!/^\d{6,20}$/.test(account)) { showToast('学号应为 6 至 20 位数字'); return; }
    if (users.some(user => user.account === account)) { showToast('学号已存在'); return; }
    const draft = { account, name: $('#user-name').value.trim(), campus: $('#user-campus').value, password: $('#user-password').value };
    try {
      await apiJson('/api/users', { method: 'POST', json: draft });
      $('#user-form').reset(); await syncUsers(); showToast('工作人员账号已创建，可继续分配权限');
    } catch (error) { showToast(error.message); }
  });
  $('#user-search').addEventListener('input', render);
  $('#reset-user-form').addEventListener('click', () => $('#user-form').reset());
  render();
  return { refresh: syncUsers, clear() { generation++; users.splice(0); render(); } };
}
