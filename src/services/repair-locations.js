import { fail } from '../lib/http.js';
import { requireRole, requireGrantScope } from './permissions.js';

export function repairLocationService(repository) {
  return {
    async list() { return { items:await repository.list() }; },
    async update(input, actor) {
      requireRole(actor,'superadmin');
      requireGrantScope(actor,[input.campus]);
      const item = await repository.update(input,new Date().toISOString());
      if (!item) fail(409,'维修地点已被更新，请重新读取后重试');
      return item;
    }
  };
}
