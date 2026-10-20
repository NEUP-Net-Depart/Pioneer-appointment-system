import { fail } from '../lib/http.js';
import { parseAppointmentSearch } from '../../shared/appointment-search.js';
import { scanCode, verifyScanCode } from '../lib/scan-code.js';
import { onsiteBookingInput, stringField } from '../lib/validation.js';
import { dateKey } from '../../shared/time.js';
import { TIME_SLOTS } from '../../shared/constants.js';
import { requireCampus } from './permissions.js';

export function scanService(appointments, service, secret, clock = () => new Date(), field, previousSecrets = []) {
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
    config() { return { enabled: true }; },
    async code(id, token) {
      const item = await service.lookup(id, token);
      return { id: item.id, code: scanCode(item.id, secret) };
    },
    async resolve(input, actor) {
      const id = input.code !== undefined ? verifyScanCode(input.code, [secret, ...previousSecrets]) : stringField(input.id, '预约编号', 80, true);
      if (!/^(?:reserve|reverse)?[01]\d{8}-\d{2,}$/.test(id)) fail(400, '请输入完整预约编号');
      return locate(id, actor);
    },
    async search(input, actor) {
      const query = parseAppointmentSearch(input.q);
      if (!query) fail(400, '请输入预约编号中的数字');
      if (!query.ready) return { items: [], hasMore: false };
      return field.search(actor,query);
    },
    async current(actor, registrationRequestId) {
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
      return { items: await Promise.all(items.map(item => { requireCampus(actor, item.campus); return field.detail(actor,item.id); })), pending: pending ? await locate(pending.id, actor) : null, registration };
    },
    async onsite(input, actor) {
      const key = stringField(input.requestId || input.registrationKey, '登记请求编号', 36, true);
      if (!/^[a-f0-9-]{36}$/.test(key)) fail(400, '登记请求编号不正确');
      const now = clock();
      await expire(now, { campuses: actor.authorizedCampuses });
      const previous = await appointments.findRegistration(actor.account, key);
      if (previous) return locate(previous.id, actor);
      if (input.registrationFlow !== 'frontdesk') {
        if (await appointments.pendingRegistration(actor.account)) fail(409, '请先签到或取消当前临时登记');
        if ((await appointments.inProgress(actor.account)).length) fail(409, '请先完成当前维修，再登记下一台设备');
      }
      const data = onsiteBookingInput({ ...input, date: dateKey(now), timeSlot: TIME_SLOTS[0], agreementAt: now.toISOString(), agreementVersion: 'v1.0' });
      requireCampus(actor, data.campus);
      const item = await service.createOnsite(data, actor, key, input.registrationFlow);
      return locate(item.id, actor);
    }
  };
}
