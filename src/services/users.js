import { fail } from '../lib/http.js';
import { hashPassword } from '../lib/passwords.js';
import { roleLevel } from '../../shared/constants.js';
import { dateKey } from '../../shared/time.js';
import { canManageAccount,requireGrantScope,requireRole } from './permissions.js';

export function userService(users) {
  async function manageable(id, actor) {
    const target = await users.find(id);
    if (!target) fail(404, '账号不存在');
    if (!canManageAccount(actor,target)) fail(403,'只能管理授权校区内低于自身且非保护的账号');
    return target;
  }
  return {
    async list(actor) {
      requireRole(actor,'admin');
      return {items:(await users.list()).filter(user=>actor.role==='superadmin' || canManageAccount(actor,user) || user.account===actor.account)};
    },
    async create(input, actor) {
      if (await users.find(input.account)) fail(409, '学号已存在');
      if (roleLevel[input.role] >= roleLevel[actor.role]) fail(403, '只能创建权限低于自己的账号');
      requireGrantScope(actor,input.authorizedCampuses);
      return users.create({ ...input, passwordHash: hashPassword(input.password), createdAt: dateKey() });
    },
    async update(id, input, actor) {
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
