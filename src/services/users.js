import { fail } from '../lib/http.js';
import { hashPassword } from '../lib/passwords.js';
import { roleLevel } from '../../shared/constants.js';
import { dateKey } from '../../shared/time.js';

export function userService(users) {
  async function manageable(id, actor) {
    const target = await users.find(id);
    if (!target) fail(404, '账号不存在');
    if (target.protected || roleLevel[target.role] >= roleLevel[actor.role]) fail(403, '权限不足：只能管理权限低于自己的账号');
    return target;
  }
  return {
    async list() { return { items: await users.list() }; },
    async create(input, actor) {
      if (await users.find(input.account)) fail(409, '学号已存在');
      if (roleLevel[input.role] >= roleLevel[actor.role]) fail(403, '只能创建权限低于自己的账号');
      return users.create({ ...input, passwordHash: hashPassword(input.password), createdAt: dateKey() });
    },
    async update(id, input, actor) {
      const target = await manageable(id, actor), patch = { ...input };
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
