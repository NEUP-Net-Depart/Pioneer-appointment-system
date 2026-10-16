import { fail } from '../lib/http.js';
import { hashPassword } from '../lib/passwords.js';
import { roleLevel } from '../../shared/constants.js';
import { canManageAccount,requireGrantScope,requireRole,requireCampus } from './permissions.js';

export function userService(users, staff = null) {
  async function manageable(id, actor) {
    const target = await users.find(id);
    if (!target) fail(404, '账号不存在');
    if (!canManageAccount(actor,target)) fail(403,'只能管理授权校区内低于自身且非保护的账号');
    return target;
  }
  return {
    async assignees(query, actor) {
      requireRole(actor,staff?.field?.enabled ? 'technician' : 'admin');
      if (staff?.field?.enabled) actor = await staff.scopedActor(actor, 'repair.correct');
      requireCampus(actor,query.campus);
      return { items: await users.assignees(query) };
    },
    async list(actor) {
      requireRole(actor,staff?.field?.enabled ? 'technician' : 'admin');
      if (staff?.field?.enabled) actor = await staff.scopedActor(actor, 'accounts.manage');
      return {items:(await users.list()).filter(user=>(actor.role==='superadmin' && (!staff?.field?.enabled || user.authorizedCampuses.length > 0 && user.authorizedCampuses.every(campus => actor.authorizedCampuses.includes(campus)))) || canManageAccount(actor,user) || user.account===actor.account).map(user => {
        const editable = canManageAccount(actor, user);
        return { ...user, actions: { edit: editable, changeStatus: editable, resetPassword: editable } };
      })};
    },
    async update(id, input, actor) {
      if (staff?.field?.enabled) actor = await staff.scopedActor(actor, 'accounts.manage');
      const target = await manageable(id, actor), patch = { ...input };
      if (patch.authorizedCampuses) requireGrantScope(actor,patch.authorizedCampuses);
      if (patch.role !== undefined) {
        if (!Object.hasOwn(roleLevel,patch.role) || roleLevel[patch.role] >= roleLevel[actor.role]) fail(403, '只能设置低于自身的角色');
      }
      if (patch.password !== undefined) { patch.passwordHash = hashPassword(patch.password); delete patch.password; }
      if (!Object.keys(patch).length) fail(400, '没有可更新的字段');
      const updated = await users.update(target, patch);
      if (!updated) fail(409, '账号已被其他操作修改，请刷新');
      return updated;
    }
  };
}
