import { fail } from '../lib/http.js';
import { requireRole, requireGrantScope, requireCampus } from './permissions.js';
import { validDate } from '../../shared/time.js';
import { campusId } from '../modules/authorization/scopes.js';

export function slotCapacityService(repository, staff = null) {
  return {
    async actual(actor, { date, campus }) {
      requireRole(actor, 'admin'); requireCampus(actor, campus);
      if (!validDate(date)) fail(400, '请选择有效日期');
      const dutyTypes = [];
      if (staff?.field?.enabled) {
        // Aggregate staffing follows the same management permissions as rosters.
        // A capacity editor without those grants can still inspect capacity.
        for (const type of ['repair', 'office']) {
          try { await staff.requirePermission(actor, `roster.${type}.manage`, { campusId: campusId(campus) }, date); dutyTypes.push(type); }
          catch (error) { if (error.status !== 403) throw error; }
        }
      }
      return { campus, date, ...await repository.actual(date, campus, dutyTypes) };
    },
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
