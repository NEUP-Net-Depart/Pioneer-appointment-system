import { createHash } from 'node:crypto';
import { fail } from '../lib/http.js';
import { issueAccessToken } from '../lib/access-tokens.js';
import { guestAppointment } from './access.js';
import { requireCampus } from './permissions.js';
import { requestId, stableJson } from '../platform/contracts.js';
import { dateKey, expirationDeadline, serviceDay, slotDeadline, validDate } from '../../shared/time.js';
import { TIME_SLOTS } from '../../shared/constants.js';
import { campusId } from '../modules/authorization/scopes.js';

const hash = (value) => createHash('sha256').update(stableJson(value)).digest('hex');

export function repairFollowupService(appointments, staffPlatform, clock = () => new Date()) {
  async function parent(id) {
    const item = await appointments.find(id);
    if (!item) fail(404, '原维修工单不存在');
    if (item.status !== 'completed') fail(409, '仅已完成维修的工单可以申报返修');
    return item;
  }

  async function manager(actor, item) {
    requireCampus(actor, item.campus);
    await staffPlatform.requirePermission(actor, 'repair.followup.manage', {
      campusId: campusId(item.campus),
      id: item.id
    }, dateKey(clock()));
  }

  async function existingRequest(id, parentId, fingerprint) {
    const existing = await appointments.followupByRequestId(id);
    if (!existing) return null;
    if (existing.parentAppointmentId !== parentId || existing.requestHash !== fingerprint)
      fail(409, '请求编号已用于其他返修内容', 'REQUEST_CONFLICT');
    return { id: existing.id, status: existing.status, idempotent: true };
  }

  return {
    async request(id, input, accessToken) {
      const item = await guestAppointment(appointments, id, accessToken);
      if (item.status !== 'completed') fail(409, '仅已完成维修的工单可以申报返修');
      const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
      const operationId = requestId(input?.requestId);
      if (!operationId) fail(400, '请刷新页面后重新提交返修申请');
      if (reason.length < 2 || reason.length > 3000) fail(400, '请填写 2 至 3000 字的返修情况');
      const fingerprint = hash({ parentAppointmentId: item.id, reason, requestSource: 'customer' });
      const replay = await existingRequest(operationId, item.id, fingerprint);
      if (replay) return replay;
      const result = await appointments.createRepairFollowup({
        parentAppointmentId: item.id,
        reason,
        requestId: operationId,
        requestHash: fingerprint
      }, null, clock().toISOString());
      if (!result) fail(409, '原工单状态已变化，请刷新后重试');
      return result;
    },

    async createByStaff(parentId, input, actor) {
      const item = await parent(parentId);
      await manager(actor, item);
      await staffPlatform.requirePermission(actor, 'repair.correct', {
        campusId: campusId(item.campus),
        id: item.id
      }, dateKey(clock()));
      const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
      const operationId = requestId(input?.requestId);
      if (!operationId) fail(400, '请刷新工单后重试');
      if (reason.length < 2 || reason.length > 3000) fail(400, '请填写 2 至 3000 字的返修情况');
      const fingerprint = hash({ parentAppointmentId: item.id, reason, requestSource: 'staff' });
      const replay = await existingRequest(operationId, item.id, fingerprint);
      if (replay) return replay;
      const result = await appointments.createRepairFollowup({ parentAppointmentId: item.id, reason,
        requestId: operationId, requestHash: fingerprint }, actor, clock().toISOString());
      if (!result) fail(409, '原工单状态已变化，请刷新后重试');
      return result;
    },

    async list(actor, query = {}) {
      actor = await staffPlatform.scopedActor(actor, 'repair.followup.manage');
      const campuses = actor.authorizedCampuses || [];
      const status = ['pending', 'scheduled', 'rejected'].includes(query.status) ? query.status : 'pending';
      const rows = await appointments.listRepairFollowups(campuses, status);
      const projected = await Promise.all(rows.map(async (row) => ({
        followup: row.followup,
        appointment: await staffPlatform.field.detail(actor, row.appointment.id)
      })));
      return { items: projected };
    },

    async slots(actor, query = {}) {
      const campus = query.campus;
      if (!['南湖','浑南'].includes(campus) || !validDate(query.date) || !serviceDay(query.date))
        fail(400, '请选择有效的校区和周一至周四维修日期');
      actor = await staffPlatform.scopedActor(actor, 'repair.followup.manage');
      requireCampus(actor, campus);
      await staffPlatform.requirePermission(actor, 'repair.followup.manage', { campusId: campusId(campus) }, dateKey(clock()));
      const now = clock();
      if (query.date < dateKey(now)) fail(400, '不能安排到已经过去的日期');
      if ((await appointments.serviceDay(query.date, campus))?.paused)
        return { items: [], paused: true, reason: '该校区当日暂停维修' };
      const schedule = await appointments.schedule(query.date, campus);
      return {
        items: schedule.filter((slot) => Number(slot.capacity) > 0 &&
          TIME_SLOTS.includes(slot.time_slot) && Date.parse(slotDeadline(query.date, slot.time_slot)) > now.getTime())
          .map((slot) => slot.time_slot),
        paused: false
      };
    },

    async resolve(followupId, input, actor) {
      const operationId = requestId(input?.requestId);
      if (!operationId) fail(400, '请求编号无效，请重新操作');
      const snapshot = await appointments.followupById(followupId);
      if (!snapshot) fail(404, '返修申请不存在');
      const item = await parent(snapshot.parentAppointmentId);
      await manager(actor, item);
      const action = input?.action;
      if (!['schedule', 'reject'].includes(action)) fail(400, '请选择安排返修或退回申请');
      const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
      if (action === 'reject' && (reason.length < 2 || reason.length > 500))
        fail(400, '请填写 2 至 500 字的退回原因');
      const date = input.date;
      const timeSlot = input.timeSlot;
      const revision = Number(input.revision);
      if (!Number.isSafeInteger(revision) || revision < 0) fail(400, '返修申请版本无效，请刷新后重试');
      const timestamp = clock();
      const decisionHash = hash({ action, followupId, revision, date: action === 'schedule' ? date : '',
        timeSlot: action === 'schedule' ? timeSlot : '', reason });
      const prior = await appointments.followupByDecisionRequestId(operationId);
      if (prior) {
        if (prior.id !== followupId || prior.decisionHash !== decisionHash)
          fail(409, '请求编号已用于其他返修操作', 'REQUEST_CONFLICT');
        return { id: prior.id, status: prior.status, appointmentId: prior.scheduledAppointmentId, idempotent: true };
      }
      if (snapshot.status !== 'pending' || snapshot.revision !== revision)
        fail(409, '返修申请已被其他人员处理，请刷新后核对');
      let child = null;
      if (action === 'schedule') {
        if (!validDate(date) || !serviceDay(date) || date < dateKey(timestamp))
          fail(400, '请选择今天或之后有效的维修日期');
        if (!TIME_SLOTS.includes(timeSlot)) fail(400, '请选择有效的半小时维修时段');
        const schedule = await appointments.schedule(date, item.campus);
        if (!schedule.some((slot) => slot.time_slot === timeSlot && Number(slot.capacity) > 0))
          fail(409, '该日期的维修时段不可用，请选择其他时段', 'SLOT_CHANGED');
        if ((await appointments.serviceDay(date, item.campus))?.paused)
          fail(409, '该日期暂停维修，不能安排返修', 'SERVICE_DAY_PAUSED');
        if (Date.parse(slotDeadline(date, timeSlot)) <= timestamp.getTime())
          fail(409, '所选维修时段已经结束', 'SLOT_ENDED');
        await appointments.ensureDefaultLocation(date, item.campus, timestamp.toISOString());
        const credential = issueAccessToken();
        child = {
          campus: item.campus,
          date,
          timeSlot,
          expiresAt: expirationDeadline(date),
          accessTokenHash: credential.hash
        };
      }
      if (action === 'schedule') {
        const result = await appointments.scheduleRepairFollowup({ followupId, revision,
          decisionRequestId: operationId, decisionHash, reason: '' }, item, child, actor, timestamp.toISOString());
        if (!result) fail(409, '排期、权限或维修日期已变化，请刷新后核对');
        return { ...result.followup, appointment: await staffPlatform.field.detail(actor, result.appointment.id) };
      }
      const result = await appointments.rejectRepairFollowup({ followupId, revision,
        decisionRequestId: operationId, decisionHash, reason }, item, actor, timestamp.toISOString());
      if (!result) fail(409, '返修申请、权限或原工单状态已变化，请刷新后核对');
      return result;
    },

  };
}
