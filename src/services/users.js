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
    async create(input) {
      if (await users.find(input.account)) fail(409, '学号已存在');
      return users.create({ ...input, role: 'student', passwordHash: hashPassword(input.password), createdAt: dateKey() });
    },
    async update(id, input, actor) {
      const target = await manageable(id, actor), patch = { ...input };
      if (patch.role !== undefined) {
        const allowed = actor.role === 'superadmin' ? ['student','technician','admin'] : target.role === 'student' ? ['technician'] : [];
        if (!allowed.includes(patch.role)) fail(403, '权限不足：当前账号只能将学生提升为维修人员');
      }
      if (patch.password !== undefined) { patch.passwordHash = hashPassword(patch.password); delete patch.password; }
      if (!Object.keys(patch).length) fail(400, '没有可更新的字段');
      const updated = await users.update(target, patch);
      if (!updated) fail(409, '账号已被其他操作修改，请刷新');
      return updated;
    },
    async delete(id, actor) {
      const target = await manageable(id, actor);
      if (!await users.delete(target)) fail(409, '账号已被其他操作修改，请刷新');
      return { ok: true, account: target.account, message: '账号已删除，历史预约记录保留' };
    }
  };
}
