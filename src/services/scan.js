import { fail } from '../lib/http.js';
import { parseAppointmentSearch } from '../../shared/appointment-search.js';
import { scanCode, verifyScanCode } from '../lib/scan-code.js';
import { onsiteBookingInput, stringField } from '../lib/validation.js';
import { dateKey } from '../../shared/time.js';
import { TIME_SLOTS } from '../../shared/constants.js';
import { requireCampus } from './permissions.js';

export function scanService(appointments, service, secret, clock = () => new Date(), field) {
  const expire = (now, scope) => appointments.expirePending(now.toISOString(), scope);
  async function locate(id, actor) {
    const now = clock();
    const original = await appointments.find(id);
    if (!original) fail(404, '预约不存在，请检查编号');
    requireCampus(actor, original.campus);
    await expire(now, { id });
    const item = await appointments.find(id);
    if (!item) fail(404, '预约不存在，请检查编号');
    return field.detail(actor, item.id);
  }
  return {
    async code(id, token) {
      const item = await service.lookup(id, token);
      return { id: item.id, code: scanCode(item.id, secret) };
    },
    async relatedCode(parentId, childId, token) {
      const item = await service.lookup(parentId, token);
      const relation = await appointments.relatedForScan(item.id, childId);
      if (!relation) fail(404, '返修预约不存在或已完成');
      await expire(clock(), { id: relation.id });
      if ((await appointments.find(relation.id))?.status !== 'booked')
        fail(404, '返修预约不存在或已完成');
      return { id: relation.id, code: scanCode(relation.id, secret) };
    },
    async resolve(input, actor) {
      const id = input.code !== undefined ? verifyScanCode(input.code, secret) : stringField(input.id, '预约编号', 80, true);
      if (!/^(?:reserve|reverse)?[01]\d{8}-\d{2,}$/.test(id)) fail(400, '请输入完整预约编号');
      return locate(id, actor);
    },
    async search(input, actor) {
      const query = parseAppointmentSearch(input.q);
      if (!query) fail(400, '请输入预约编号、完整学号、姓名或完整联系方式');
      if (input.mode !== undefined && !['number', 'contact', 'identity', 'studentId'].includes(input.mode))
        fail(400, '查询方式不正确');
      if (input.mode === 'studentId' && !query.studentId) fail(400, '请输入完整学号');
      if (!query.ready) return { items: [], hasMore: false };
      return field.search(actor,{ ...query, mode: input.mode, campusId: input.campusId });
    },
    async onsite(input, actor) {
      const key = stringField(input.requestId, '登记请求编号', 36, true);
      if (!/^[a-f0-9-]{36}$/.test(key)) fail(400, '登记请求编号不正确');
      const now = clock();
      await expire(now, { campuses: actor.authorizedCampuses });
      const previous = await appointments.findRegistration(actor.account, key);
      if (previous) return {...await locate(previous.id,actor),accessToken:await service.registrationCredential(previous,actor)};
      const data = onsiteBookingInput({ ...input, date: dateKey(now), timeSlot: TIME_SLOTS[0], agreementAt: now.toISOString(), agreementVersion: 'v1.0' });
      requireCampus(actor, data.campus);
      const item = await service.createOnsite({...data,parentAppointmentId:input.parentAppointmentId || null,linkKind:input.linkKind || null,sameDeviceAndFault:input.sameDeviceAndFault,sameDeviceAndRepairRelated:input.sameDeviceAndRepairRelated}, actor, key);
      const visible=await locate(item.id,actor);
      return {...visible,...(visible.name!==undefined && visible.social!==undefined ? {accessToken:item.accessToken} : {})};
    }
  };
}
