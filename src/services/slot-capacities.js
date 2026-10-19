import { fail } from '../lib/http.js';
import { requireRole, requireGrantScope, requireCampus } from './permissions.js';
import { validDate } from '../../shared/time.js';
import { campusId } from '../modules/authorization/scopes.js';

export function slotCapacityService(repository, staff = null, days=null) {
  async function authorize(actor, campuses = []) {
    if (!staff?.field?.enabled) {
      requireRole(actor, 'admin');
      if (campuses.length) requireGrantScope(actor, campuses);
      return actor;
    }
    actor = await staff.scopedActor(actor, 'settings.manage');
    for (const campus of campuses) requireCampus(actor, campus);
    return actor;
  }
  return {
    async serviceDay(actor,query) {
      if(!validDate(query.date)||!['南湖','浑南'].includes(query.campus)) fail(400,'请选择有效日期和校区');
      await authorize(actor,[query.campus]);
      const id=campusId(query.campus);
      return {item:await days.serviceDay(query.date,id),affected:await days.affectedServiceDay(query.date,id)};
    },
    async saveServiceDay(actor,input) {
      const campus={'campus-nanhu':'南湖','campus-hunnan':'浑南'}[input.campusId];
      if(!campus||!validDate(input.businessDate)||typeof input.paused!=='boolean'||!Number.isInteger(input.revision)||typeof input.requestId!=='string'||input.requestId.length>128||!input.requestId||typeof input.reason!=='string'||input.reason.length>200)fail(400,'请核对日期、校区、状态、版本与说明');
      actor=await authorize(actor,[campus]);
      if(input.businessDate<new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}))fail(400,'历史服务日不能改写，请通过考勤修正处理');
      const result=await days.saveServiceDay(input,actor);
      if(!result||result.replay&&!result.matches)fail(409,'配置或权限已变化，请重新读取后确认');
      return result.result;
    },
    async actual(actor, { date, campus }) {
      actor = await authorize(actor, [campus]); requireCampus(actor, campus);
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
      actor = await authorize(actor);
      return { items: await repository.list(actor.authorizedCampuses) };
    },
    async update(input, actor) {
      await authorize(actor, [input.campus]);
      const item = await repository.update(input);
      if (!item) fail(409, '预约人数配置已更新，请重新读取后重试');
      return item;
    },
    async updateMany(items, actor) {
      await authorize(actor, [...new Set(items.map(item => item.campus))]);
      const updated = await repository.updateMany(items);
      if (!updated || updated.length !== items.length) fail(409, '预约人数配置已更新，请重新读取后重试');
      return { items: updated };
    }
  };
}
