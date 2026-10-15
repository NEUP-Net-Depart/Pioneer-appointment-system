import { fail } from '../lib/http.js';
import { scanCode, verifyScanCode } from '../lib/scan-code.js';
import { onsiteBookingInput, stringField } from '../lib/validation.js';
import { dateKey } from '../../shared/time.js';
import { TIME_SLOTS } from '../../shared/constants.js';
import { requireCampus, requireAppointmentAccess } from './permissions.js';
import { presentAppointment } from './appointments.js';

export function scanService(appointments, service, encryptionKey, secret, enabled, clock = () => new Date()) {
  const present = item => presentAppointment(item, encryptionKey, { staff: true });
  function available() { if (!enabled) fail(404, '扫码工作台未启用'); }
  const expire = (now, scope) => appointments.expirePending(now.toISOString(), scope);
  async function locate(id, actor) {
    const now = clock();
    const original = await appointments.find(id);
    if (!original) fail(404, '预约不存在，请检查编号');
    requireAppointmentAccess(actor, original, { start: true });
    await expire(now, { id });
    const item = await appointments.find(id);
    if (!item) fail(404, '预约不存在，请检查编号');
    requireAppointmentAccess(actor, item, { start: true });
    if (item.status === 'booked') {
      // Before intake, reveal device information only, matching the existing queue policy.
      return Object.fromEntries(['id','revision','campus','date','timeSlot','deviceType','brand','deviceModel','serial','warranty','liquidMetal','dellG15','faultType','issue','liquidDrop','note','status','source','expiresAt'].map(key => [key, item[key]]));
    }
    return present(item);
  }
  return {
    config() { return { enabled }; },
    async code(id, token) {
      available();
      const item = await service.lookup(id, token);
      return { id: item.id, code: scanCode(item.id, secret) };
    },
    async resolve(input, actor) {
      available();
      const id = input.code !== undefined ? verifyScanCode(input.code, secret) : stringField(input.id, '预约编号', 80, true);
      if (!/^(?:reserve|reverse)?[01]\d{8}-\d{2,}$/.test(id)) fail(400, '请输入完整预约编号');
      return locate(id, actor);
    },
    async current(actor, registrationRequestId) {
      available();
      await expire(clock(), { campuses: actor.authorizedCampuses });
      let registration = null;
      if (registrationRequestId !== undefined) {
        const key = stringField(registrationRequestId, '登记请求编号', 36, true);
        if (!/^[a-f0-9-]{36}$/.test(key)) fail(400, '登记请求编号不正确');
        const found = await appointments.findRegistration(actor.account, key);
        // A receipt contains no student information and only confirms this actor's request.
        if (found) { requireCampus(actor, found.campus); registration = { id: found.id, status: found.status }; }
      }
      const items = await appointments.inProgress(actor.account);
      const pending = await appointments.pendingRegistration(actor.account);
      return { items: await Promise.all(items.map(item => { requireCampus(actor, item.campus); return present(item); })), pending: pending ? await locate(pending.id, actor) : null, registration };
    },
    async onsite(input, actor) {
      available();
      const key = stringField(input.requestId, '登记请求编号', 36, true);
      if (!/^[a-f0-9-]{36}$/.test(key)) fail(400, '登记请求编号不正确');
      const now = clock();
      await expire(now, { campuses: actor.authorizedCampuses });
      const previous = await appointments.findRegistration(actor.account, key);
      if (previous) return locate(previous.id, actor);
      if (await appointments.pendingRegistration(actor.account)) fail(409, '请先签到或取消当前临时登记');
      if ((await appointments.inProgress(actor.account)).length) fail(409, '请先完成当前维修，再登记下一台设备');
      const data = onsiteBookingInput({ ...input, date: dateKey(now), timeSlot: TIME_SLOTS[0], agreementAt: now.toISOString(), agreementVersion: 'v1.0' });
      requireCampus(actor, data.campus);
      const item = await service.createOnsite(data, actor.account, key);
      return locate(item.id, actor);
    }
  };
}
