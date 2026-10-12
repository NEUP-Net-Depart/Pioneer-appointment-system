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
    }
  };
}
