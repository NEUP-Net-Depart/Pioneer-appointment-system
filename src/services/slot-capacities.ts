import type { SlotCapacityDto } from '../../shared/appointment-types.ts';
import type { CampusId, DutyType, StaffAccountDto } from '../../shared/staff-types.ts';
import { dutyCampusNames } from '../../shared/duty.ts';
import { failureFrom } from '../../shared/api-types.ts';
import type { slotCapacityRepository } from '../db/slot-capacities.ts';
import type { serviceDayRepository } from '../db/service-days.ts';
import type { StaffService } from './staff-platform.ts';

type CapacityRepository = ReturnType<typeof slotCapacityRepository>;
type DayRepository = ReturnType<typeof serviceDayRepository>;
import { fail } from '../lib/http.ts';
import { requireCampus } from './permissions.ts';
import { validDate, dateKey, addDays, rosterWeekKey, serviceDay } from '../../shared/time.ts';
import { campusId } from '../modules/authorization/scopes.ts';

export function slotCapacityService(repository: CapacityRepository, staff: Pick<StaffService, 'scopedActor' | 'requirePermission'>, days: DayRepository | null = null) {
  async function authorize(actor: StaffAccountDto, campuses: string[] = []) {
    actor = await staff.scopedActor(actor, 'booking.manage');
    for (const campus of campuses) requireCampus(actor, campus);
    return actor;
  }
  return {
    async serviceDay(actor: StaffAccountDto,query: { start?: string; end?: string; date?: string; campus?: string }) {
      if (!days) throw new Error('Missing service day repository');
      if(query.start || query.end){
        if(!validDate(query.start)||!validDate(query.end)||query.end<query.start||query.end>addDays(query.start,13)||query.campus !== '南湖' && query.campus !== '浑南')fail(400,'请选择最多两周的有效日期和校区');
        await authorize(actor,[query.campus]);
        const id=campusId(query.campus),rows=await days.serviceDays(query.start,query.end);
        const dates=[];for(let day=query.start;day<=query.end;day=addDays(day,1))if(serviceDay(day))dates.push(day);
        return {campus:query.campus,serverNow:new Date().toISOString(),items:await Promise.all(dates.map(async date=>({businessDate:date,item:rows.find(row=>row.campusId===id&&row.businessDate===date)||null,affected:await days.affectedServiceDay(date,id)})))};
      }
      if(!validDate(query.date)||query.campus !== '南湖' && query.campus !== '浑南') fail(400,'请选择有效日期和校区');
      await authorize(actor,[query.campus]);
      const id=campusId(query.campus);
      return {item:await days.serviceDay(query.date,id),affected:await days.affectedServiceDay(query.date,id)};
    },
    async saveServiceDay(actor: StaffAccountDto,input: Record<string, unknown>) {
      if (!days) throw new Error('Missing service day repository');
      if(!input || typeof input!=='object' || Array.isArray(input))fail(400,'请核对暂停日期配置');
      if(input?.items!==undefined){
        if(!Array.isArray(input.items)||!input.items.length||input.items.length>8||typeof input.requestId!=='string'||!input.requestId||input.requestId.length>128)fail(400,'请选择1至8个维修日期');
        const items=input.items,seen=new Set(),today=dateKey(),end=addDays(rosterWeekKey(today),10),campuses=[];
        for(const item of items){
          const campus = dutyCampusNames[item?.campusId as CampusId];
          if(!campus||!validDate(item.businessDate)||!serviceDay(item.businessDate)||item.businessDate<today||item.businessDate>end||typeof item.paused!=='boolean'||!Number.isSafeInteger(item.revision)||item.revision< -1||typeof item.reason!=='string'||item.reason.length>200)fail(400,'请选择本周或下周尚未过去的周一至周四，并核对暂停说明');
          const key=`${item.campusId}:${item.businessDate}`;if(seen.has(key))fail(400,'不能重复选择同一日期');seen.add(key);campuses.push(campus);
        }
        actor=await authorize(actor,[...new Set(campuses)]);
        const result=await days.saveServiceDays({requestId:input.requestId,items:items.map(({businessDate,campusId,paused,reason,revision})=>({businessDate,campusId,paused,reason:reason.trim(),revision}))},actor);
        if(!result?.matches)fail(409,'暂停安排或权限已变化，本次操作未写入；请读取最新安排后重试','SERVICE_DAY_CONFLICT');
        return result.result;
      }
      const campus = dutyCampusNames[input.campusId as CampusId];
      if(!campus||!validDate(input.businessDate)||typeof input.paused!=='boolean'||typeof input.revision !== 'number'||!Number.isInteger(input.revision)||typeof input.requestId!=='string'||input.requestId.length>128||!input.requestId||typeof input.reason!=='string'||input.reason.length>200)fail(400,'请核对日期、校区、状态、版本与说明');
      actor=await authorize(actor,[campus]);
      if(input.businessDate<new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}))fail(400,'历史服务日不能改写，请通过考勤修正处理');
      const result=await days.saveServiceDay({ ...input, campusId: input.campusId as CampusId, businessDate: input.businessDate, paused: input.paused, reason: input.reason, revision: input.revision, requestId: input.requestId },actor);
      if(!result||result.replay&&!result.matches)fail(409,'配置或权限已变化，请重新读取后确认');
      return result.result;
    },
    async actual(actor: StaffAccountDto, { date, campus }: { date?: string; campus?: string }) {
      actor = await authorize(actor, [campus || '']);
      if (!validDate(date)) fail(400, '请选择有效日期');
      const name = campus || '';
      const dutyTypes: DutyType[] = [];
      {
        // Aggregate staffing requires roster management for the target campus.
        for (const type of ['repair', 'office'] as const) {
          try { await staff.requirePermission(actor, 'roster.manage', { campusId: campusId(name) }, date); dutyTypes.push(type); }
          catch (error) { if (failureFrom(error).status !== 403) throw error; }
        }
      }
      return { campus, date, ...await repository.actual(date, name, dutyTypes) };
    },
    async list(actor: StaffAccountDto) {
      actor = await authorize(actor);
      return { items: await repository.list(actor.authorizedCampuses) };
    },
    async update(input: SlotCapacityDto, actor: StaffAccountDto) {
      await authorize(actor, [input.campus]);
      const item = await repository.update(input, dateKey());
      if (!item) fail(409, '预约人数配置已更新，请重新读取后重试');
      return item;
    },
    async updateMany(items: SlotCapacityDto[], actor: StaffAccountDto) {
      await authorize(actor, [...new Set(items.map(item => item.campus))]);
      const updated = await repository.updateMany(items, dateKey());
      if (!updated || updated.length !== items.length) fail(409, '预约人数配置已更新，请重新读取后重试');
      return { items: updated };
    }
  };
}
