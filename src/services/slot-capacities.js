import { fail } from '../lib/http.js';
import { requireRole, requireGrantScope } from './permissions.js';

export function slotCapacityService(repository) {
  return {
    async list(actor) {
      requireRole(actor, 'admin');
      return { items: await repository.list(actor.authorizedCampuses) };
    },
    async update(input, actor) {
      requireGrantScope(actor, [input.campus]);
      const item = await repository.update(input);
      if (!item) fail(409, '预约人数配置已更新，请重新读取后重试');
      return item;
    },
    async updateMany(items, actor) {
      requireGrantScope(actor, [...new Set(items.map(item => item.campus))]);
      const updated = await repository.updateMany(items);
      if (!updated || updated.length !== items.length) fail(409, '预约人数配置已更新，请重新读取后重试');
      return { items: updated };
    }
  };
}
