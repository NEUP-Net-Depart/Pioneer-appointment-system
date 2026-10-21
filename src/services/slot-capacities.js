import { fail } from '../lib/http.js';
import { requireCampus } from './permissions.js';
import { validDate, dateKey, addDays, weekRange, serviceDay } from '../../shared/time.js';
import { campusId } from '../modules/authorization/scopes.js';

export function slotCapacityService(repository, staff, days=null) {
  async function authorize(actor, campuses = []) {

    actor = await staff.scopedActor(actor, 'settings.manage');
    for (const campus of campuses) requireCampus(actor, campus);
    return actor;
  }
  return {
    async serviceDay(actor,query) {
      if(query.start || query.end){
        if(!validDate(query.start)||!validDate(query.end)||query.end<query.start||query.end>addDays(query.start,13)||!['南湖','浑南'].includes(query.campus))fail(400,'请选择最多两周的有效日期和校区');
        await authorize(actor,[query.campus]);
        const id=campusId(query.campus),rows=await days.serviceDays(query.start,query.end);
        const dates=[];for(let day=query.start;day<=query.end;day=addDays(day,1))if(serviceDay(day))dates.push(day);
        return {campus:query.campus,serverNow:new Date().toISOString(),items:await Promise.all(dates.map(async date=>({businessDate:date,item:rows.find(row=>row.campusId===id&&row.businessDate===date)||null,affected:await days.affectedServiceDay(date,id)})))};
      }
      if(!validDate(query.date)||!['南湖','浑南'].includes(query.campus)) fail(400,'请选择有效日期和校区');
      await authorize(actor,[query.campus]);
      const id=campusId(query.campus);
      return {item:await days.serviceDay(query.date,id),affected:await days.affectedServiceDay(query.date,id)};
    },
    async saveServiceDay(actor,input) {
      if(!input || typeof input!=='object' || Array.isArray(input))fail(400,'请核对暂停日期配置');
      if(input?.items!==undefined){
        if(!Array.isArray(input.items)||!input.items.length||input.items.length>8||typeof input.requestId!=='string'||!input.requestId||input.requestId.length>128)fail(400,'请选择1至8个维修日期');
        const items=input.items,seen=new Set(),today=dateKey(),end=addDays(weekRange(today).start,10),campuses=[];
        for(const item of items){
          const campus={'campus-nanhu':'南湖','campus-hunnan':'浑南'}[item?.campusId];
          if(!campus||!validDate(item.businessDate)||!serviceDay(item.businessDate)||item.businessDate<today||item.businessDate>end||typeof item.paused!=='boolean'||!Number.isSafeInteger(item.revision)||item.revision< -1||typeof item.reason!=='string'||item.reason.length>200)fail(400,'请选择本周或下周尚未过去的周一至周四，并核对暂停说明');
          const key=`${item.campusId}:${item.businessDate}`;if(seen.has(key))fail(400,'不能重复选择同一日期');seen.add(key);campuses.push(campus);
        }
        actor=await authorize(actor,[...new Set(campuses)]);
        const result=await days.saveServiceDays({requestId:input.requestId,items:items.map(({businessDate,campusId,paused,reason,revision})=>({businessDate,campusId,paused,reason:reason.trim(),revision}))},actor);
        if(!result?.matches)fail(409,'暂停安排或权限已变化，本次操作未写入；请读取最新安排后重试','SERVICE_DAY_CONFLICT');
        return result.result;
      }
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
      {
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
