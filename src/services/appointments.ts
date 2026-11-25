import type { AppointmentChanges, AppointmentListQuery, AppointmentRecord } from '../db/records.ts';
import type { BookingNoticeDto, RepairOutcome, RepairVerification } from '../../shared/appointment-types.ts';
import type { StaffAccountDto } from '../../shared/staff-types.ts';
import type { appointmentRepository } from '../db/appointments.ts';
import type { appointmentPatch, BookingData } from '../lib/validation.ts';
import type { FieldWorkflow } from './field-workflow.ts';
import type { StaffService } from './staff-platform.ts';
import type { StaffContext } from './staff-platform/context.ts';
import type { bookingSettingsService } from './booking-settings.ts';

type AppointmentRepository = ReturnType<typeof appointmentRepository>;
interface OnsiteRegistration { actor: string; authVersion: number; requestId?: string }
interface RepairCommand extends Record<string, unknown> {
  revision?: unknown;
  requestId?: unknown;
  frontPhotoId?: string | null;
  backPhotoId?: string | null;
  verification?: RepairVerification;
  linkKind?: unknown;
  sameDeviceAndRepairRelated?: unknown;
  sameDeviceAndFault?: unknown;
}

import { stringField } from '../lib/validation.ts';
import { fail } from '../lib/http.ts';
import { encryptText, decryptText, readStoredContact } from '../lib/privacy.ts';
import {
  addDays,
  dateKey,
  serviceDay,
  slotDeadline,
  expirationDeadline,
  calendarWeekRange as weekRange
} from '../../shared/time.ts';
import { issueAccessToken, bookingDigest, hashAccessToken } from '../lib/access-tokens.ts';
import { guestAppointment } from './access.ts';
import { repairOutcomes } from '../../shared/constants.ts';
import { confirmedRepairLink } from '../../shared/repair-links.ts';
import { bookingWindow } from '../../shared/booking-settings.ts';
import { bookingDeviceQuestions } from '../../shared/student-booking.ts';
import { appointmentScope, requireRole, requireCampus } from './permissions.ts';

const customerAppointmentFields = ['id','revision','studentId','name','college','campus','phone','social',
  'email','contactType','contactValue','deviceType','brand','deviceModel','serial',
  'warranty','faultType','issue','liquidDrop','liquidMetal','dellG15','date','timeSlot',
  'status','outcome','receivedAt','startedAt','completedAt','expiresAt','createdAt','source',
  'parentAppointmentId','linkKind','repairNumber','locationSnapshot','locationRevision','servicePaused',
  'agreementAt','agreementVersion','signature'] as const;

type CustomerAppointment = Pick<AppointmentRecord, typeof customerAppointmentFields[number]>;
export function presentAppointment(item: AppointmentRecord, encryptionKey: string, options: { staff: true }): Promise<AppointmentRecord>;
export function presentAppointment(item: AppointmentRecord, encryptionKey: string, options?: { staff?: false }): Promise<CustomerAppointment>;
export async function presentAppointment(item: AppointmentRecord, encryptionKey: string, { staff = false } = {}) {
  const [phone, social, email, contactValue] = await Promise.all(
    [item.phone, item.social, item.email, item.contactValue].map((value) =>
      readStoredContact(value, encryptionKey)
    )
  );
  const visible = { ...item, phone, social, email, contactValue };
  delete visible.registrationKey;
  if (!staff) {
    // Explicit customer projection: adding an internal field must never publish it.
    return Object.fromEntries(customerAppointmentFields.map(key => [key, visible[key]])) as CustomerAppointment;
  }
  return visible;
}
export function appointmentService(
  appointments: AppointmentRepository,
  encryptionKey: string,
  clock = () => new Date(),
  staffPlatform: StaffService & { field: FieldWorkflow },
  bookingSettings: ReturnType<typeof bookingSettingsService> | null = null
) {
  const present = async (item: AppointmentRecord) => {
    const [visible, location, repairHistory] = await Promise.all([
      presentAppointment(item, encryptionKey),
      appointments.location(item.date, item.campus),
      appointments.repairHistory(item.id)
    ]);
    return {
      ...visible,
      repairHistory,
      serverNow: clock().toISOString(),
      location: location?.location || item.locationSnapshot || '',
      currentLocationRevision: location?.revision ?? null,
      locationChanged: Boolean(
        item.locationSnapshot && location?.location && item.locationSnapshot !== location.location
      )
    };
  };
  const expire = (instant: Date, scope: Parameters<AppointmentRepository['expirePending']>[1]) => appointments.expirePending(instant.toISOString(), scope);
  function repairResult(outcome?: RepairOutcome, note?: string) {
    if (!repairOutcomes.some(value => value === outcome) || !note?.trim())
      fail(400, '请选择维修结果并填写维修说明');
  }
  async function mutate(id: string,input: RepairCommand,actor: StaffAccountDto,action: string,prepare: (item: AppointmentRecord, context: StaffContext, at: string) => AppointmentChanges | Promise<AppointmentChanges>,permission='repair.receive') {
    const item=await appointments.find(id);
    if (!item) fail(404,'工单不存在');
    requireCampus(actor,item.campus);
    const {context}=await staffPlatform.field.requireEligible(actor,item.campus,permission);
    const receipt=await staffPlatform.field.receipt(actor,action,{...input,id},id);
    if (receipt.replay) return receipt.replay;
    if (!Number.isInteger(input.revision) || input.revision!==item.revision) fail(409,'工单已更新，请刷新后重试');
    const at=clock().toISOString();
    const patch=await prepare(item,context,at);
    const contactBefore: Partial<Record<keyof AppointmentRecord, string>> = {};
    for (const key of ['phone','social','email','contactValue'] as const) if (Object.hasOwn(patch,key))
      contactBefore[key]=await encryptText(await readStoredContact(item[key],encryptionKey),encryptionKey);
    const updated=await appointments.update(item,patch,{
      actor:{...actor,memberId:context.actor.memberId,authVersion:context.authVersion},
      action,requestId:receipt.requestId,payloadHash:receipt.payloadHash,at,
      reason:typeof input.reason === 'string' ? input.reason : '',verification:input.verification,contactBefore
    });
    if (!updated) fail(409,'工单或账号已更新，请刷新后重试');
    return staffPlatform.field.detail(actor,id);
  }
  async function receiving(item: AppointmentRecord,input: RepairCommand,actor: StaffAccountDto,at: string): Promise<AppointmentChanges> {
    if (item.receivedAt) return {};
    if (item.status!=='booked' || item.date!==dateKey(new Date(at))) fail(409,'请在预约当天接收设备');
    if ((await appointments.serviceDay(item.date,item.campus))?.paused) fail(409,'该日期暂停服务');
    const front=await appointments.intakePhoto(item.id,input.frontPhotoId,'intake_front',at);
    const back=await appointments.intakePhoto(item.id,input.backPhotoId,'intake_back',at);
    const photos=front && back;
    if (!photos && !(input.photosCaptured===true && input.uploadTimedOut===true)) fail(400,'请先拍摄正反面照片并尝试上传');
    return {receivedAt:at,receivedBy:actor.account,
      frontPhotoId:front ? input.frontPhotoId ?? null : null,backPhotoId:back ? input.backPhotoId ?? null : null,
      photoDeferredBy:photos ? null : actor.account,
      ...(input.verification ? {brand:input.verification.brand,deviceModel:input.verification.model,warranty:input.verification.warranty,liquidMetal:input.verification.liquidMetal} : {})};
  }
  return {
    async resolveAttempt(key: string, digest?: string | null) {
      const receipt = await appointments.findRequest(key);
      if (!receipt) return { found: false } as const;
      if (digest && receipt.digest !== digest)
        fail(409, '同一次预约请求的内容已改变，请先核实原预约结果', 'IDEMPOTENCY_MISMATCH');
      const token = await decryptText(receipt.encryptedToken, encryptionKey);
      const item = await appointments.findByCredential(
        receipt.appointmentId,
        hashAccessToken(token)
      );
      if (!item)
        fail(
          409,
          '本次预约已创建。此浏览器无法查看该预约，请联系工作人员查询',
          'BOOKING_ACCESS_UNAVAILABLE'
        );
      return {
        found: true as const,
        appointment: { ...(await this.lookup(item.id, token)), accessToken: token }
      };
    },
    async overview(user: StaffAccountDto) {
      user = await staffPlatform.scopedActor(user, 'repair.summary.read');
      const instant = clock(),
        start = dateKey(instant),
        end = addDays(start, 6);
      const { campuses } = appointmentScope(user);
      await expire(instant, { campuses });
      const week = weekRange(start);
      const { totals, capacities, nextServiceDate } = await appointments.overview(week.start, end, campuses, start);
      const dates = Array.from({ length: 7 }, (_, index) => addDays(start, index)).filter(
        serviceDay
      );
      if (nextServiceDate && nextServiceDate > end) {
        const next = await appointments.overview(nextServiceDate, nextServiceDate, campuses);
        totals.push(...next.totals);
        capacities.push(...next.capacities);
      }
      if (nextServiceDate && !dates.includes(nextServiceDate)) dates.push(nextServiceDate);
      const makeItems = (days: string[]) =>
        capacities
          .filter((row) => days.includes(row.date))
          .map((row) => {
            const { campus, date, time_slot: timeSlot, capacity } = row;
            const total = totals.find(
              (row) => row.campus === campus && row.date === date && row.time_slot === timeSlot
            );
            const occupied = total?.occupied ?? 0;
            return {
              campus,
              date,
              timeSlot,
              capacity,
              occupied,
              paused: !!row.paused,
              remaining: row.paused ? 0 : Math.max(0, capacity - occupied),
              booked: total?.booked ?? 0,
              inProgress: total?.in_progress ?? 0,
              ended: Date.parse(slotDeadline(date, timeSlot)) <= instant.getTime()
            };
          });
      const weekDates = Array.from({ length: 7 }, (_, index) => addDays(week.start, index)).filter(
        serviceDay
      );
      return {
        start,
        end,
        dates,
        campuses,
        nextServiceDate,
        items: makeItems(dates),
        week: { ...week, dates: weekDates, items: makeItems(weekDates) },
        updatedAt: instant.toISOString()
      };
    },
    async list(query: AppointmentListQuery, user: StaffAccountDto) {
      const access = await staffPlatform.field.listAccess(user);
      const scope = { campuses: user.authorizedCampuses, ...access };
      await expire(clock(), { campuses: scope.campuses });
      const contactIds = (await staffPlatform.field.contactMatches(user, query, access.context)).map(
        (item) => item.id
      );
      const result = await appointments.list({ ...query, contactIds }, scope);
      return {
        ...result,
        searchCapabilities: access.searchCapabilities,
        items: await staffPlatform.field.projectList(user, result.items, access.context)
      };
    },
    async counts(query: AppointmentListQuery, user: StaffAccountDto) {
      const result = await this.list({ ...query, deferCounts: false, limit: 1 }, user);
      return { counts: result.counts, filteredCounts: result.filteredCounts };
    },
    async createOnsite(data: BookingData, actor: StaffAccountDto, requestId?: string) {
      requireRole(actor, 'technician');
      requireCampus(actor, data.campus);
      const { context } = await staffPlatform.requirePermission(
        actor,
        'onsite.create',
        { campusId: data.campus }
      );
      if (data.parentAppointmentId) {
        const parent=await appointments.find(data.parentAppointmentId);
        if (!parent) fail(404,'原工单不存在');
        requireCampus(actor,parent.campus);
        if (parent.status!=='completed' || parent.studentId!==data.studentId || !confirmedRepairLink(data)) fail(409,'请核对同一设备，并确认所选原因与原维修单的关联');
        data={...data,linkedBy:actor.account,linkedAt:clock().toISOString()};
      }
      return this.create(data, { actor: actor.account, authVersion: context.authVersion, requestId });
    },
    async create(data: BookingData, onsite?: OnsiteRegistration, requestKey?: string) {
      const digest = !onsite && requestKey ? bookingDigest(data) : null;
      if (digest && requestKey) {
        const previous = await this.resolveAttempt(requestKey, digest);
        if (previous.found) return previous.appointment;
      }
      const instant = clock(),
        today = dateKey(instant);
      const expiresAt = expirationDeadline(data.date);
      if ((await appointments.serviceDay(data.date, data.campus))?.paused)
        fail(409, '该日期暂停维修，请选择其他日期', 'SERVICE_DAY_PAUSED');
      let importantNotices: BookingNoticeDto[] = [];
      if (!onsite) {
        const settings = bookingSettings ? await bookingSettings.public(data.campus) : null;
        const window = bookingWindow(instant, settings?.releaseTime);
        if (data.date < today || data.date > window.end)
          fail(409, '预约日期必须为今天起 3 天内', 'DATE_UNAVAILABLE');
        importantNotices = settings?.notices.filter(notice => notice.important) || [];
        if (importantNotices.some(notice => !data.acceptedNotices?.some(accepted => accepted.id === notice.id && accepted.revision === notice.revision)))
          fail(409, '预约公告已更新，请阅读并确认重要公告后重新提交', 'BOOKING_NOTICE_CHANGED');
        if (!serviceDay(data.date)) fail(409, '预约日期必须为周一至周四', 'DATE_UNAVAILABLE');
        const schedule = await appointments.schedule(data.date, data.campus);
        if (!schedule.some((slot) => slot.time_slot === data.timeSlot))
          fail(409, '该日期的时段安排已更新，请重新选择', 'SLOT_CHANGED');
        if (
          Date.parse(expiresAt) <= instant.getTime() ||
          Date.parse(slotDeadline(data.date, data.timeSlot)) <= instant.getTime()
        )
          fail(409, '该预约时段已经结束', 'SLOT_ENDED');
        if (
          !(await appointments.ensureDefaultLocation(data.date, data.campus, instant.toISOString()))
            ?.location
        )
          fail(409, '该日期尚未配置维修地点，请重新选择日期', 'LOCATION_MISSING');
      } else if (data.date !== today || instant.getTime() >= Date.parse(expiresAt))
        fail(400, '当天临时登记有效期限已结束');
      const timestamp = instant.toISOString();
      const credential = onsite ? null : issueAccessToken();
      const [phone, social, email, contactValue] = await Promise.all(
        [data.phone, data.social, data.email, data.contactValue].map((value) =>
          encryptText(value, encryptionKey)
        )
      );
      const item: Parameters<AppointmentRepository['create']>[0] = {
        ...data,
        bookingNotices: JSON.stringify(importantNotices
          .map(notice => ({ ...notice, acceptedAt: instant.toISOString() }))),
        status: 'booked',
        assignedTo: '',
        repairNote: '',
        outcome: null,
        startedAt: null,
        completedAt: null,
        expiresAt,
        repairNumber: null,
        frontPhotoId: null,
        backPhotoId: null,
        source: onsite ? 'onsite' : 'booking',
        registeredBy: onsite?.actor || null,
        registrationKey: onsite?.requestId || null,
        createdAt: timestamp,
        agreementAt: timestamp,
        agreementVersion: data.agreementVersion || 'v1.0',
        accessTokenHash: credential?.hash ?? null,
        phone,
        social,
        email,
        contactValue
      };
      const request = digest && requestKey && credential
        ? {
            key: requestKey,
            digest,
            encryptedToken: await encryptText(credential.token, encryptionKey)
          }
        : undefined;
      const checkedAt = clock();
      if (
        !onsite &&
        (Date.parse(expiresAt) <= checkedAt.getTime() ||
          Date.parse(slotDeadline(data.date, data.timeSlot)) <= checkedAt.getTime())
      )
        fail(409, '该预约时段已经结束', 'SLOT_ENDED');
      if (onsite && Date.parse(expiresAt) <= checkedAt.getTime())
        fail(400, '当天临时登记有效期限已结束');
      item.createdAt = item.agreementAt = checkedAt.toISOString();
      const created = await appointments.create(item, request, onsite);
      if (!created) {
        const replay=request && await this.resolveAttempt(request.key,digest);
        if (replay?.found) return replay.appointment;
        fail(409,'账号权限已更新，请刷新后重试');
      }
      if (onsite || !credential) return { id: created.id };
      return { ...(await present(created)), accessToken: credential.token };
    },
    async lookup(id: string, accessToken: string) {
      const item = await guestAppointment(appointments, id, accessToken);
      await expire(clock(), { repairChainId: item.id });
      return present(await guestAppointment(appointments, item.id, accessToken));
    },
    async link(id: string,input: RepairCommand,actor: StaffAccountDto) {
      if (!confirmedRepairLink(input)) fail(400,'请核对同一设备，并确认所选原因与原维修单的关联');
      return mutate(id,input,actor,'repairs.linked',async(item,_context,at)=>{
        if (!['booked','in_progress'].includes(item.status) || item.parentAppointmentId) fail(409,'请选择尚未关联的本次服务工单');
        const parent=await appointments.find(typeof input.parentAppointmentId === 'string' ? input.parentAppointmentId : '');
        if (!parent) fail(404,'原工单不存在');
        requireCampus(actor,parent.campus);
        if (parent.id===id || parent.status!=='completed' || parent.studentId!==item.studentId) fail(409,'只能关联同一客户已结束的原维修单');
        return {parentAppointmentId:parent.id,linkKind:input.linkKind as AppointmentRecord['linkKind'],linkedBy:actor.account,linkedAt:at};
      });
    },
    async edit(id: string,input: RepairCommand,actor: StaffAccountDto) {
      const contacts=['phone','social','email','contactValue'];
      const limits={name:80,college:120,deviceType:80,brand:80,deviceModel:120,serial:120,warranty:30,liquidMetal:30,dellG15:20,liquidDrop:20,note:500,faultType:80,issue:10000,phone:120,social:120,email:254,contactType:40,contactValue:120};
      const patch: AppointmentChanges = {};
      for (const [key,limit] of Object.entries(limits) as [keyof typeof limits, number][]) if (Object.hasOwn(input,key)) {
        const value=stringField(input[key],key,limit,['name','brand','faultType'].includes(key));
        patch[key]=contacts.includes(key) ? await encryptText(value,encryptionKey) : value;
      }
      if (!Object.keys(patch).length) fail(400,'没有需要修改的资料');
      return mutate(id,input,actor,'repairs.information.updated',async item=>{
        if (Object.hasOwn(patch,'note')) await staffPlatform.field.requireEligible(actor,item.campus,'repair.correct');
        if (Object.hasOwn(patch,'deviceType') || Object.hasOwn(patch,'brand')) {
          const type=patch.deviceType ?? item.deviceType;
          const questions=bookingDeviceQuestions(type==='笔记本电脑' ? '笔记本' : type,patch.brand ?? item.brand);
          if (!questions.liquidMetal) patch.liquidMetal='';
          if (!questions.dellG15) patch.dellG15='';
        }
        return patch;
      });
    },
    async receive(id: string,input: RepairCommand,actor: StaffAccountDto) {
      return mutate(id,input,actor,'repairs.received',async (item,_context,at)=>{
        if (item.status!=='booked' || item.receivedAt) fail(409,'设备已接收或本次服务已结束');
        return receiving(item,input,actor,at);
      });
    },
    async supplement(id: string,input: RepairCommand,actor: StaffAccountDto) {
      return mutate(id,input,actor,'repairs.photos.supplemented',async item=>{
        if (item.photoDeferredBy!==actor.account) fail(403,'请由首次接收经办人补传原图');
        const front=input.frontPhotoId || item.frontPhotoId,back=input.backPhotoId || item.backPhotoId;
        const at=clock().toISOString();
        if ((!front && !back) || (front && !await appointments.intakePhoto(id,front,'intake_front',at)) || (back && !await appointments.intakePhoto(id,back,'intake_back',at))) fail(400,'请选择本单首次接收的原图');
        return {frontPhotoId:front || null,backPhotoId:back || null,photoDeferredBy:front && back ? null : actor.account};
      });
    },
    async transfer(id: string,input: RepairCommand,actor: StaffAccountDto) {
      return mutate(id,input,actor,'repairs.transferred',item=>{
        if (item.status!=='in_progress') fail(409,'只有维修中的工单可以交接');
        if (item.assignedMemberId===actor.memberId) fail(409,'你已经是当前主修');
        if (input.receivedDevice!==true) fail(400,'请确认已经实际接到设备');
        return {assignedTo:actor.account};
      },'repair.transfer');
    },
    async update(id: string,{patch:input,revision,action,requestId,verification,photosCaptured,uploadTimedOut}: ReturnType<typeof appointmentPatch>, user: StaffAccountDto | null, accessToken = '') {
      if (!user) {
        const item=await guestAppointment(appointments,id,accessToken);
        if (input.status!=='cancelled' || Object.keys(input).some(key=>key!=='status')) fail(403,'学生只能取消尚未接收的预约');
        if (item.status!=='booked' || item.receivedAt) fail(409,'设备已接收或预约已结束，不能取消');
        if (revision!==item.revision) fail(409,'预约已更新，请刷新');
        const updated=await appointments.update(item,{status:'cancelled',completedAt:clock().toISOString()});
        if (!updated) fail(409,'预约已更新，请刷新');
        return present(updated);
      }
      const command={...input,revision,requestId,verification,photosCaptured,uploadTimedOut};
      const operation=action==='correct' ? 'repairs.corrected' : input.status==='in_progress' ? 'repairs.started' : input.status==='completed' ? 'repairs.completed' : 'repairs.updated';
      const permission=action==='correct' || input.status==='completed' ? 'repair.summary.read' : input.status==='in_progress' ? 'repair.start' : !input.status ? 'repair.finish.own' : 'repair.receive';
      return mutate(id,command,user,operation,async (item,context,at)=>{
        const own=item.assignedMemberId===context.actor.memberId;
        const target={campusId:item.campus,id,assignedMemberId:item.assignedMemberId};
        if (action==='correct') {
          if (item.status!=='completed') fail(409,'只有已结束工单可更正结果和说明');
          if (!own || !staffPlatform.evaluate(context,'repair.finish.own',target).allowed) await staffPlatform.requirePermission(user,'repair.correct',target);
          if (Object.keys(input).some(key=>!['outcome','repairNote'].includes(key))) fail(400,'更正只修改结果和说明');
          repairResult(input.outcome,input.repairNote);
          return {outcome:input.outcome,repairNote:input.repairNote};
        }
        if (item.status==='booked' && input.status==='in_progress') {
          if (item.date!==dateKey(new Date(at)) && !item.receivedAt) fail(409,'预约仅在当天接单；隔天请重新预约或现场登记');
          return {...await receiving(item,command,user,at),status:'in_progress',assignedTo:user.account,startedAt:at};
        }
        if (item.status==='in_progress' && input.status==='completed') {
          if (!own || !staffPlatform.evaluate(context,'repair.finish.own',target).allowed) await staffPlatform.requirePermission(user,'repair.correct',target);
          repairResult(input.outcome,input.repairNote);
          return {status:'completed',outcome:input.outcome,repairNote:input.repairNote,completedAt:at};
        }
        if (item.status==='in_progress' && own && !input.status && typeof input.repairNote==='string') return {repairNote:input.repairNote};
        if (item.status==='booked' && !item.receivedAt && input.status==='cancelled') return {status:'cancelled',completedAt:at};
        fail(409,'当前状态不能执行此操作');
      },permission);
    }
  };
}
