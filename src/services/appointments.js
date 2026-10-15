import { fail } from '../lib/http.js';
import { encryptText, decryptText } from '../lib/privacy.js';
import { addDays, dateKey, serviceDay, slotDeadline, expirationDeadline, weekRange } from '../../shared/time.js';
import { issueAccessToken } from '../lib/access-tokens.js';
import { guestAppointment } from './access.js';
import { repairOutcomes } from '../../shared/constants.js';
import { appointmentScope, requireRole, requireAppointmentAccess, requireCampus, ownsRepair, ownsRegistration } from './permissions.js';

export async function presentAppointment(item, encryptionKey, { staff = false } = {}) {
  const [phone, social] = await Promise.all([decryptText(item.phone, encryptionKey), decryptText(item.social, encryptionKey)]);
  const visible = { ...item, phone, social };
  delete visible.registrationKey;
  if (!staff) { delete visible.assignedToName; delete visible.assignedMemberId; delete visible.registeredMemberId; }
  return visible;
}
export function appointmentService(appointments, users, encryptionKey, clock = () => new Date(), staffPlatform = null) {
  const present = (item, staff = false) => presentAppointment(item, encryptionKey, { staff });
  const expire = (instant, scope) => appointments.expirePending(instant.toISOString(), scope);
  async function assignee(value, campus) {
    let user = await users.find(value.toLowerCase());
    if (!user) {
      const matches = await users.findByName(value);
      if (matches.length > 1) fail(400, '有多个同名工作人员，请输入学号');
      user = matches[0];
    }
    if (user?.status !== 'enabled' || user.memberStatus === 'inactive') fail(400, '维修人员账号不存在或未启用');
    requireCampus(user, campus);
    return user.account;
  }
  function repairResult(outcome, note) {
    if (!repairOutcomes.includes(outcome) || !note?.trim()) fail(400, '请选择维修结果并填写维修说明');
  }
  function repeated(item, input, user, action) {
    return !action && ownsRepair(user, item) && (
      (input.status === 'in_progress' && item.status === 'in_progress' && input.frontPhotoId === item.frontPhotoId && input.backPhotoId === item.backPhotoId) ||
      (input.status === 'completed' && item.status === 'completed' && input.outcome === item.outcome && input.repairNote === item.repairNote)
    );
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
      if(staffPlatform?.field?.enabled) {
        const result=await appointments.list({...query,q:''},scope);
        const visible=await staffPlatform.field.projectList(user,result.items);
        const q=(query.q || '').toLowerCase();
        const items=visible.filter(item=>!q || [item.id,item.repairNumber,item.deviceModel,item.campus,item.name,item.studentId].some(value=>String(value || '').toLowerCase().includes(q)));
        return {...result,items};
      }
      const result = await appointments.list(query, scope);
      const items = await Promise.all(result.items.map(async item => {
        if (user.role === 'technician' && (item.status === 'booked' || (!ownsRepair(user, item) && !(item.source === 'onsite' && ownsRegistration(user, item))))) {
          return Object.fromEntries(['id','revision','campus','date','timeSlot','deviceType','brand','deviceModel','faultType','status','createdAt','expiresAt'].map(key => [key, item[key]]));
        }
        return present(item, true);
      }));
      return { ...result, items };
    },
    async createOnsite(data, actor, requestId, registrationFlow = 'technician_intake') {
      requireRole(actor, 'technician'); requireCampus(actor, data.campus);
      if (staffPlatform && !['admin', 'superadmin'].includes(actor.role)) {
        await staffPlatform.requirePermission(actor, registrationFlow === 'frontdesk' ? 'onsite.frontdesk.create' : 'onsite.create', { campusId: data.campus });
      }
      if (staffPlatform?.field?.enabled) await staffPlatform.requirePermission(actor, registrationFlow === 'frontdesk' ? 'onsite.frontdesk.create' : 'onsite.create', { campusId: data.campus });
      return this.create(data, { actor: actor.account, requestId, registrationFlow });
    },
    async create(data, onsite) {
      const instant = clock(), today = dateKey(instant);
      const expiresAt = expirationDeadline(data.date);
      if (!onsite) {
        if (data.date < today || data.date > addDays(today, 3)) fail(400, '预约日期必须为今天起 3 天内');
        if (!serviceDay(data.date)) fail(400, '预约日期必须为周一至周四');
        const schedule = await appointments.schedule(data.date, data.campus);
        if (!schedule.some(slot => slot.time_slot === data.timeSlot)) fail(409, '该日期的时段安排已更新，请重新选择');
        if (Date.parse(slotDeadline(data.date, data.timeSlot)) <= instant.getTime()) fail(400, '该预约时段已经结束');
      } else if (data.date !== today || instant.getTime() >= Date.parse(expiresAt)) fail(400, '当天临时登记有效期限已结束');
      const timestamp = instant.toISOString(), credential = issueAccessToken();
      const [phone, social] = await Promise.all([encryptText(data.phone, encryptionKey), encryptText(data.social, encryptionKey)]);
      const item = { ...data, status: 'booked', assignedTo: '', repairNote: '', outcome: null, startedAt: null, completedAt: null, expiresAt,
        repairNumber: null, frontPhotoId: null, backPhotoId: null,
        source: onsite ? 'onsite' : 'booking', registeredBy: onsite?.actor || null, registrationKey: onsite?.requestId || null, registrationFlow: onsite?.registrationFlow || 'technician_intake',
        createdAt: timestamp, agreementAt: timestamp, agreementVersion: data.agreementVersion || 'v1.0',
        accessTokenHash: credential.hash, credentialRotatedAt: timestamp, phone, social };
      return { ...await present(await appointments.create(item), !!onsite), accessToken: credential.token };
    },
    async lookup(id, accessToken) {
      const item = await guestAppointment(appointments, id, accessToken);
      await expire(clock(), { id: item.id });
      return present(await guestAppointment(appointments, item.id, accessToken));
    },
    async transfer(id, input, actor) {
      const item = await appointments.find(id); if (!item) fail(404, '预约不存在');
      const receipt = staffPlatform?.field?.enabled ? await staffPlatform.field.receipt(actor, 'repairs.transferred', { ...input, id }, id) : null;
      if (receipt?.replay) return receipt.replay;
      if (actor.role === 'admin' || actor.role === 'superadmin') requireRole(actor, 'admin');
      else if (staffPlatform) await staffPlatform.requirePermission(actor, 'repair.transfer', { campusId: item.campus });
      else requireRole(actor, 'admin');
      requireCampus(actor, item.campus); const account = await assignee(input.assignedTo, item.campus);
      if (!input.reason || input.reason.trim().length < 2) fail(400, '请填写转派原因');
      if (input.revision !== undefined && input.revision !== item.revision) fail(409, '预约已被其他工作人员修改，请刷新后重试');
      const eligibility = staffPlatform?.field?.enabled ? await staffPlatform.field.assertTransfer(actor, item, account) : null;
      const workflow = eligibility ? { eligibility, actor, action: 'repairs.transferred', reason: input.reason, requestId: input.requestId, payloadHash:receipt.payloadHash, at: clock().toISOString() } : null;
      const updated = await appointments.update(item, { assignedTo: account }, undefined, workflow);
      if (!updated) fail(409, '预约已被其他操作修改，请刷新后重试');
      if (staffPlatform && !workflow) {
        const context = await staffPlatform.contextFor(actor);
        await staffPlatform.recordAudit({ actorMemberId: context.actor.memberId, actorAccount: actor.account, action: 'repairs.transferred',
          sourceRef: { module: 'repairs', type: 'appointment', id: updated.id }, before: item, after: updated, reason: input.reason, requestId: input.requestId || '' });
      }
      return workflow ? staffPlatform.field.detail(actor, updated.id) : present(updated);
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
    async update(id, { patch: input, revision, action, correctionReason = '', requestId = '', reason = '', verification }, user, accessToken) {
      if (!Object.keys(input).length) fail(400, '没有可更新的字段');
      let item = user ? await appointments.find(id) : await guestAppointment(appointments, id, accessToken);
      if (!item) fail(404, '预约不存在');
      if (user) requireCampus(user, item.campus);
      const workflowAction = input.status === 'in_progress' ? 'repairs.started' : input.status === 'completed' ? 'repairs.completed' : 'repairs.updated';
      const receipt = user && staffPlatform?.field?.enabled && !action ? await staffPlatform.field.receipt(user, workflowAction, {input,revision,requestId,reason,verification,id},id) : null;
      if (receipt?.replay) return receipt.replay;
      const instant = clock(), timestamp = instant.toISOString();
      await expire(instant, { id: item.id });
      item = user ? await appointments.find(item.id) : await guestAppointment(appointments, item.id, accessToken);
      // A lost response can be retried with the original revision and photo IDs.
      // Only an exact repeat by the recorded owner is treated as success.
      if (repeated(item, input, user, action)) return staffPlatform?.field?.enabled ? staffPlatform.field.detail(user,item.id) : present(item,true);
      if (revision !== undefined && revision !== item.revision) fail(409, '预约已更新，请刷新后重试');
      if ((input.frontPhotoId !== undefined || input.backPhotoId !== undefined) &&
          (action === 'correct' || input.status !== 'in_progress')) fail(400, '签到照片只能在签到时记录');
      if (input.expiresAt !== undefined && action !== 'correct') fail(400, '有效截止时间只能由管理员纠错设置');
      let patch, eligibility;
      if (action === 'correct') {
        if (user?.role === 'admin' || user?.role === 'superadmin') requireRole(user, 'admin');
        else if (staffPlatform) await staffPlatform.requirePermission(user, 'repair.correct', { campusId: item.campus });
        else requireRole(user, 'admin');
        requireCampus(user, item.campus);
        const status = input.status || item.status;
        if (input.expiresAt !== undefined && status !== 'booked') fail(400, '有效截止时间只能在恢复为已预约时设置');
        if (['in_progress','completed'].includes(status) && ['booked','cancelled','expired'].includes(item.status)) fail(409, '请先恢复为已预约，再通过签到上传照片并开始维修');
        if (input.outcome !== undefined && status !== 'completed') fail(400, '仅已完成工单可以填写维修结果');
        patch = { ...input, status };
        if (status === 'booked') {
          const late = instant.getTime() >= Date.parse(expirationDeadline(item.date));
          if (late && input.expiresAt === undefined) fail(409, '已过原有效期限，请填写纠错原因并指定新的有效截止时间');
          if ((late || input.expiresAt !== undefined) && (correctionReason.trim().length < 8 || correctionReason.length > 300)) fail(400, '请填写 8 至 300 字的纠错原因');
          const expiresAt = input.expiresAt ?? item.expiresAt;
          if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= instant.getTime()) fail(409, '新的有效截止时间必须晚于当前时间');
          patch = { status, expiresAt, assignedTo: '', startedAt: null, completedAt: null, outcome: null, repairNote: '', frontPhotoId: null, backPhotoId: null };
        } else {
          const account = input.assignedTo ?? item.assignedTo;
          if (account) patch.assignedTo = status === 'in_progress' || account !== item.assignedTo ? await assignee(account, item.campus) : account;
          else if (status === 'in_progress' || repairOutcomes.includes(input.outcome ?? item.outcome)) fail(400, '请指定维修人员');
          if (status === 'in_progress') {
            patch.completedAt = null; patch.outcome = null;
          } else if (status === 'completed') {
            patch.outcome = input.outcome ?? item.outcome;
            if (!(item.status === 'completed' && item.outcome === 'legacy_unknown' && input.outcome === undefined)) repairResult(patch.outcome, input.repairNote ?? item.repairNote);
            patch.completedAt = item.status === 'completed' ? item.completedAt : timestamp;
          } else {
            if (status === 'expired' && (item.startedAt || item.status === 'in_progress' || item.status === 'completed')) fail(409, '已记录维修开始的工单不能改为已逾期');
            if (status === 'expired' && instant.getTime() < Date.parse(item.expiresAt)) fail(409, '尚未到有效截止时间');
            patch.outcome = null;
            patch.completedAt = item.status === status ? item.completedAt : timestamp;
          }
        }
      } else if (!user) {
        if (input.status !== 'cancelled' || input.outcome !== undefined) fail(403, '学生仅可取消尚未开始维修的预约');
        if (item.status !== 'booked') fail(409, '当前状态不能取消');
        patch = { status: 'cancelled', outcome: null, completedAt: timestamp };
      } else if (item.status === 'booked' && input.status === 'cancelled' && input.outcome === undefined &&
          item.source === 'onsite' && ownsRegistration(user, item)) {
        patch = { status: 'cancelled', outcome: null, completedAt: timestamp };
      } else {
        const starting = item.status === 'booked' && input.status === 'in_progress';
        requireAppointmentAccess(user, item, { start: starting });
        if (input.assignedTo !== undefined) fail(403, '维修人员由签到记录，转派请使用管理员纠错');
        if (starting) {
          if (staffPlatform?.field?.enabled) {
            eligibility = await staffPlatform.field.requireEligible(user, item.campus);
            if (!verification) fail(400, '请完成现场设备核验');
          }
          if (input.outcome !== undefined) fail(400, '开始维修不能填写结束结果');
          if (!await appointments.intakePhotos(item.id, user.account, input.frontPhotoId, input.backPhotoId, timestamp)) fail(400, '请由本次签到人员上传电脑正面和反面照片');
          patch = { status: 'in_progress', assignedTo: user.account, startedAt: timestamp, completedAt: null, outcome: null, frontPhotoId: input.frontPhotoId, backPhotoId: input.backPhotoId };
        } else if (item.status === 'booked' && input.status === 'cancelled' && input.outcome === undefined) {
          requireRole(user, 'admin');
          patch = { status: 'cancelled', outcome: null, completedAt: timestamp };
        } else if (item.status === 'in_progress' && input.status === 'completed') {
          if (staffPlatform?.field?.enabled) {
            if (!ownsRepair(user, item)) fail(403, '只能完成本人当前维修');
            await staffPlatform.requirePermission(user, 'repair.finish.own', { campusId: item.campus, assignedMemberId: item.assignedMemberId });
          }
          repairResult(input.outcome, input.repairNote);
          patch = { status: 'completed', outcome: input.outcome, repairNote: input.repairNote, completedAt: timestamp };
        } else if (item.status === 'in_progress' && input.status === undefined && input.outcome === undefined && input.repairNote !== undefined) {
          if (staffPlatform?.field?.enabled) {
            if (!ownsRepair(user,item)) fail(403,'只能编辑本人当前维修');
            await staffPlatform.requirePermission(user,'repair.finish.own',{campusId:item.campus,assignedMemberId:item.assignedMemberId});
          }
          patch = { repairNote: input.repairNote };
        } else fail(409, '当前状态不能执行此操作，修正记录请使用管理员纠错');
      }
      const correction = action === 'correct' ? { actor: user.account, reason: correctionReason.trim(), instant: timestamp } : undefined;
      const workflow = user && staffPlatform?.field?.enabled && !correction ? { eligibility, actor: user, action: workflowAction, verification, reason, requestId, payloadHash:receipt.payloadHash, at: timestamp } : null;
      const updated = await appointments.update(item, patch, correction, workflow);
      if (!updated) {
        const latest = await appointments.find(item.id);
        if (latest && repeated(latest, input, user, action)) return staffPlatform?.field?.enabled ? staffPlatform.field.detail(user,latest.id) : present(latest,true);
        fail(409, '预约已被其他工作人员修改，请刷新后重试');
      }
      if (user && staffPlatform && !workflow) {
        const context = await staffPlatform.contextFor(user);
        await staffPlatform.recordAudit({ actorMemberId: context.actor.memberId, actorAccount: user.account,
          action: action === 'correct' ? 'repairs.corrected' : updated.status === 'in_progress' ? 'repairs.started' : updated.status === 'completed' ? 'repairs.completed' : 'repairs.updated',
          sourceRef: { module: 'repairs', type: 'appointment', id: updated.id }, after: updated, requestId, reason });
      }
      return workflow ? staffPlatform.field.detail(user, updated.id) : present(updated, !!user);
    }
  };
}
