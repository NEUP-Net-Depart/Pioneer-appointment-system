import { fail } from '../lib/http.js';
import { encryptText, decryptText } from '../lib/privacy.js';
import { addDays, dateKey, serviceDay, slotDeadline, noShowDeadline, expiredBookingDate, weekRange } from '../../shared/time.js';
import { issueAccessToken } from '../lib/access-tokens.js';
import { guestAppointment } from './access.js';
import { repairOutcomes, LEGACY_TIME_SLOTS } from '../../shared/constants.js';
import { scanCode as makeScanCode, verifyScanCode } from '../lib/scan-code.js';
import { appointmentScope, requireRole, requireAppointmentAccess, requireCampus } from './permissions.js';

export async function presentAppointment(item, encryptionKey) {
  const [phone, social] = await Promise.all([decryptText(item.phone, encryptionKey), decryptText(item.social, encryptionKey)]);
  return { ...item, phone, social };
}
export function appointmentService(appointments, users, encryptionKey, clock = () => new Date(), staffPlatform = null, scanSecret = '') {
  const present = item => presentAppointment(item, encryptionKey);
  const expire = (instant, scope) => (appointments.expirePending || appointments.endNoShows)(expiredBookingDate(instant), instant.toISOString(), scope);
  async function assignee(value, campus) {
    let user = await users.find(value.toLowerCase());
    if (!user) {
      const matches = await users.findByName(value);
      if (matches.length > 1) fail(400, '有多个同名工作人员，请输入学号');
      user = matches[0];
    }
    if (user?.status !== 'enabled') fail(400, '维修人员账号不存在或未启用');
    requireCampus(user, campus);
    return user.account;
  }
  function repairResult(outcome, note) {
    if (!repairOutcomes.includes(outcome) || !note?.trim()) fail(400, '请选择维修结果并填写维修说明');
  }
  return {
    async overview(user) {
      const instant = clock(), start = dateKey(instant), end = addDays(start, 6);
      const { campuses } = appointmentScope(user);
      await expire(instant, { campuses });
      const week = weekRange(start);
      const { totals, capacities } = await appointments.overview(week.start, end, campuses);
      const dates = Array.from({ length: 7 }, (_, index) => addDays(start, index)).filter(serviceDay);
      const makeItems = days => capacities.filter(row => days.includes(row.date)).map(row => {
        const { campus, date, time_slot: timeSlot, capacity } = row;
        const total = totals.find(row => row.campus === campus && row.date === date && row.time_slot === timeSlot);
        const occupied = total?.occupied ?? 0;
        return { campus, date, timeSlot, capacity, occupied, remaining: Math.max(0, capacity - occupied),
          booked: total?.booked ?? 0, inProgress: total?.in_progress ?? 0,
          ended: Date.parse(slotDeadline(date, timeSlot)) <= instant.getTime() };
      });
      const weekDates = Array.from({ length: 7 }, (_, index) => addDays(week.start, index)).filter(serviceDay);
      return { start, end, dates, campuses, items: makeItems(dates), week: { ...week, dates: weekDates, items: makeItems(weekDates) }, updatedAt: instant.toISOString() };
    },
    async list(query, user) {
      const scope = appointmentScope(user);
      await expire(clock(), { campuses: scope.campuses });
      const result = await appointments.list(query, scope);
      const items = await Promise.all(result.items.map(async item => {
        if (user.role === 'technician' && (item.status === 'booked' || item.assignedTo !== user.account)) {
          return Object.fromEntries(['id','revision','campus','date','timeSlot','deviceType','brand','deviceModel','faultType','status','createdAt'].map(key => [key, item[key]]));
        }
        return present(item);
      }));
      return { ...result, items };
    },
    async create(data) {
      const instant = clock(), today = dateKey(instant);
      if (data.date < today || data.date > addDays(today, 3)) fail(400, '预约日期必须为今天起 3 天内');
      if (!serviceDay(data.date)) fail(400, '预约日期必须为周一至周四');
      const schedule = await appointments.schedule(data.date, data.campus);
      // Legacy two-hour slots remain readable during the migration window. New
      // bookings use weekday half-hour templates; old clients can still submit
      // an existing legacy slot and let the database snapshot its capacity.
      if (!schedule.some(slot => slot.time_slot === data.timeSlot) && !LEGACY_TIME_SLOTS.includes(data.timeSlot)) fail(409, '该日期的时段安排已更新，请重新选择');
      if (Date.parse(slotDeadline(data.date, data.timeSlot)) <= instant.getTime()) fail(400, '该预约时段已经结束');
      const timestamp = instant.toISOString(), credential = issueAccessToken();
      const [phone, social] = await Promise.all([encryptText(data.phone, encryptionKey), encryptText(data.social, encryptionKey)]);
      const item = { ...data, status: 'booked', assignedTo: '', repairNote: '', outcome: null, startedAt: null, completedAt: null,
        repairNumber: null, frontPhotoId: null, backPhotoId: null,
        createdAt: timestamp, agreementAt: timestamp, agreementVersion: data.agreementVersion || 'v1.0',
        accessTokenHash: credential.hash, credentialRotatedAt: timestamp, phone, social };
      return { ...await present(await appointments.create(item)), accessToken: credential.token };
    },
    async lookup(id, accessToken) {
      const item = await guestAppointment(appointments, id, accessToken);
      await expire(clock(), { id: item.id });
      return present(await guestAppointment(appointments, item.id, accessToken));
    },
    async resolveScan(code, user) {
      if (typeof code !== 'string' || !code.trim()) fail(400, '维修码不正确');
      const raw = code.trim().replace(/^pioneer:repair:v1:/, '');
      const normalized = raw.includes('.') ? verifyScanCode(raw, scanSecret) : raw;
      const item = await appointments.findByCode(normalized);
      if (!item) fail(404, '维修预约不存在');
      requireCampus(user, item.campus);
      const own = item.assignedTo === user.account;
      if (user.role === 'technician' && item.status !== 'booked' && !own) fail(403, '只能访问本人维修的预约');
      const visible = user.role === 'technician' && !own && item.status === 'booked'
        ? Object.fromEntries(['id','revision','campus','date','timeSlot','deviceType','brand','deviceModel','faultType','status','source'].map(key => [key, item[key]]))
        : await present(item);
      return { ...visible, actions: item.status === 'booked' ? ['repair.start'] : own && item.status === 'in_progress' ? ['repair.finish.own'] : [], scanType: 'repair' };
    },
    async scanCode(id, accessToken) {
      const item = await guestAppointment(appointments, id, accessToken);
      return { id: item.id, code: makeScanCode(item.id, scanSecret) };
    },
    async current(user) {
      requireRole(user, 'technician');
      const item = await appointments.currentRepair(user.account);
      return item ? await present(item) : null;
    },
    async createOnsite(input, actor) {
      requireRole(actor, 'technician'); requireCampus(actor, input.campus);
      if (staffPlatform && actor.role !== 'admin' && actor.role !== 'superadmin') {
        await staffPlatform.requirePermission(actor, input.registrationFlow === 'frontdesk' ? 'onsite.frontdesk.create' : 'onsite.create', { campusId: input.campus });
      }
      const existing = await appointments.findOnsiteByKey?.(actor.account, input.registrationKey);
      if (existing) return { ...await present(existing), registrationKey: existing.registrationKey, registrationFlow: input.registrationFlow, idempotent: true };
      const timestamp = clock().toISOString(); const credential = issueAccessToken();
      const [phone, social] = await Promise.all([encryptText(input.phone || '', encryptionKey), encryptText(input.social || '', encryptionKey)]);
      const item = { ...input, id: input.id || `onsite-${crypto.randomUUID()}`, source: 'onsite', registeredBy: actor.account, signature: '',
        registrationKey: input.registrationKey || crypto.randomUUID(), status: 'booked', assignedTo: '', repairNote: '', outcome: null,
        startedAt: null, completedAt: null, repairNumber: null, frontPhotoId: null, backPhotoId: null,
        createdAt: timestamp, agreementAt: timestamp, agreementVersion: input.agreementVersion || 'v1.0', accessTokenHash: credential.hash,
        credentialRotatedAt: timestamp, phone, social };
      let created;
      try {
        created = await appointments.createOnsite(item);
      } catch (error) {
        if (!`${error.message || ''}`.includes('idx_onsite_request')) throw error;
        created = await appointments.findOnsiteByKey(actor.account, item.registrationKey);
        if (!created) throw error;
        return { ...await present(created), registrationKey: created.registrationKey, registrationFlow: input.registrationFlow, idempotent: true };
      }
      return { ...await present(created), accessToken: credential.token, registrationKey: item.registrationKey, registrationFlow: input.registrationFlow, idempotent: false };
    },
    async transfer(id, input, actor) {
      const item = await appointments.find(id); if (!item) fail(404, '预约不存在');
      if (actor.role === 'admin' || actor.role === 'superadmin') requireRole(actor, 'admin');
      else if (staffPlatform) await staffPlatform.requirePermission(actor, 'repair.transfer', { campusId: item.campus });
      else requireRole(actor, 'admin');
      requireCampus(actor, item.campus); const account = await assignee(input.assignedTo, item.campus);
      if (!input.reason || input.reason.trim().length < 2) fail(400, '请填写转派原因');
      if (input.revision !== undefined && input.revision !== item.revision) fail(409, '预约已被其他工作人员修改，请刷新后重试');
      const updated = await appointments.update(item, { assignedTo: account });
      if (!updated) fail(409, '预约已被其他操作修改，请刷新后重试');
      if (staffPlatform) {
        const context = await staffPlatform.contextFor(actor);
        await staffPlatform.recordAudit({ actorMemberId: context.actor.memberId, actorAccount: actor.account, action: 'repairs.transferred',
          sourceRef: { module: 'repairs', type: 'appointment', id: updated.id }, before: item, after: updated, reason: input.reason, requestId: input.requestId || '' });
      }
      return present(updated);
    },
    async recover(id, input, actor) {
      const item = await appointments.find(id);
      if (!item) fail(404, '预约不存在');
      requireRole(actor, 'admin'); requireAppointmentAccess(actor, item);
      if (input.identityVerified !== true || typeof input.reason !== 'string' || input.reason.trim().length < 8 || input.reason.length > 300) fail(400, '请确认已人工核验身份，并记录至少 8 字的核验说明');
      const credential = issueAccessToken();
      if (!await appointments.rotateCredential(item, credential.hash, actor.account, input.reason.trim(), clock().toISOString())) fail(409, '预约已更新，请刷新后重试');
      return { id: item.id, accessToken: credential.token };
    },
    async update(id, { patch: input, revision, action, requestId = '', reason = '' }, user, accessToken) {
      if (!Object.keys(input).length) fail(400, '没有可更新的字段');
      let item = user ? await appointments.find(id) : await guestAppointment(appointments, id, accessToken);
      if (!item) fail(404, '预约不存在');
      if (user) requireCampus(user, item.campus);
      const instant = clock(), timestamp = instant.toISOString();
      await expire(instant, { id: item.id });
      item = user ? await appointments.find(item.id) : await guestAppointment(appointments, item.id, accessToken);
      if (revision !== undefined && revision !== item.revision) fail(409, '预约已更新，请刷新后重试');
      if ((input.frontPhotoId !== undefined || input.backPhotoId !== undefined) &&
          (action === 'correct' || input.status !== 'in_progress')) fail(400, '签到照片只能在签到时记录');
      let patch;
      if (action === 'correct') {
        if (user?.role === 'admin' || user?.role === 'superadmin') requireRole(user, 'admin');
        else if (staffPlatform) await staffPlatform.requirePermission(user, 'repair.correct', { campusId: item.campus });
        else requireRole(user, 'admin');
        requireCampus(user, item.campus);
        const status = input.status || item.status;
        if (status === 'in_progress' && (item.status === 'booked' || ['cancelled','no_show'].includes(item.outcome))) fail(409, '请先恢复为已预约，再通过签到上传照片并开始维修');
        patch = { ...input, status };
        if (status === 'booked') {
          if (instant.getTime() >= Date.parse(noShowDeadline(item.date))) fail(409, '已过自动结束时间，不能恢复为已预约');
          patch = { status, assignedTo: '', startedAt: null, completedAt: null, outcome: null, repairNote: '', frontPhotoId: null, backPhotoId: null };
        } else {
          const account = input.assignedTo ?? item.assignedTo;
          if (account) patch.assignedTo = status === 'in_progress' || account !== item.assignedTo ? await assignee(account, item.campus) : account;
          else if (status === 'in_progress' || repairOutcomes.includes(input.outcome ?? item.outcome)) fail(400, '请指定维修人员');
          if (status === 'in_progress') {
            patch.startedAt = item.status === 'booked' ? timestamp : item.startedAt;
            patch.completedAt = null; patch.outcome = null;
          } else {
            patch.outcome = input.outcome ?? item.outcome;
            if (!patch.outcome) fail(400, '请选择结束结果');
            if (repairOutcomes.includes(patch.outcome)) {
              if (item.status === 'booked') fail(409, '请先签到并开始维修');
              repairResult(patch.outcome, input.repairNote ?? item.repairNote);
            }
            if (patch.outcome === 'no_show' && instant.getTime() < Date.parse(noShowDeadline(item.date))) fail(409, '尚未到未到场判定时间');
            patch.completedAt = item.status === 'completed' ? item.completedAt : timestamp;
          }
        }
      } else if (!user) {
        if (input.status !== 'completed' || input.outcome !== 'cancelled') fail(403, '学生仅可取消尚未开始维修的预约');
        if (item.status !== 'booked') fail(409, '当前状态不能取消');
        patch = { status: 'completed', outcome: 'cancelled', completedAt: timestamp };
      } else {
        const starting = item.status === 'booked' && input.status === 'in_progress';
        requireAppointmentAccess(user, item, { start: starting });
        if (input.assignedTo !== undefined) fail(403, '维修人员由签到记录，转派请使用管理员纠错');
        if (starting) {
          if (input.outcome !== undefined) fail(400, '开始维修不能填写结束结果');
          if (!await appointments.intakePhotos(item.id, user.account, input.frontPhotoId, input.backPhotoId, timestamp)) fail(400, '请由本次签到人员上传电脑正面和反面照片');
          patch = { status: 'in_progress', assignedTo: user.account, startedAt: timestamp, completedAt: null, outcome: null, frontPhotoId: input.frontPhotoId, backPhotoId: input.backPhotoId };
        } else if (item.status === 'booked' && input.status === 'completed' && input.outcome === 'cancelled') {
          requireRole(user, 'admin');
          patch = { status: 'completed', outcome: 'cancelled', completedAt: timestamp };
        } else if (item.status === 'in_progress' && input.status === 'completed') {
          repairResult(input.outcome, input.repairNote);
          patch = { status: 'completed', outcome: input.outcome, repairNote: input.repairNote, completedAt: timestamp };
        } else if (item.status === 'in_progress' && input.status === undefined && input.outcome === undefined && input.repairNote !== undefined) {
          patch = { repairNote: input.repairNote };
        } else fail(409, '当前状态不能执行此操作，修正记录请使用管理员纠错');
      }
      const updated = await appointments.update(item, patch);
      if (!updated) fail(409, '预约已被其他工作人员修改，请刷新后重试');
      if (user && staffPlatform) {
        const context = await staffPlatform.contextFor(user);
        await staffPlatform.recordAudit({ actorMemberId: context.actor.memberId, actorAccount: user.account,
          action: action === 'correct' ? 'repairs.corrected' : updated.status === 'in_progress' ? 'repairs.started' : updated.status === 'completed' ? 'repairs.completed' : 'repairs.updated',
          sourceRef: { module: 'repairs', type: 'appointment', id: updated.id }, after: updated, requestId, reason });
      }
      return present(updated);
    }
  };
}
