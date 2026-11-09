import { stringField } from '../lib/validation.js';
import { fail } from '../lib/http.js';
import { encryptText, decryptText, readStoredContact } from '../lib/privacy.js';
import {
  addDays,
  dateKey,
  serviceDay,
  slotDeadline,
  expirationDeadline,
  weekRange
} from '../../shared/time.js';
import { issueAccessToken, bookingDigest, hashAccessToken, onsiteRequestKey } from '../lib/access-tokens.js';
import { guestAppointment } from './access.js';
import { repairOutcomes } from '../../shared/constants.js';
import { bookingWindow } from '../../shared/booking-settings.js';
import {
  appointmentScope,
  requireRole,
  requireCampus,
  ownsRegistration
} from './permissions.js';

export async function presentAppointment(item, encryptionKey, { staff = false } = {}) {
  const [phone, social, email, contactValue] = await Promise.all(
    [item.phone, item.social, item.email, item.contactValue].map((value) =>
      readStoredContact(value, encryptionKey)
    )
  );
  const visible = { ...item, phone, social, email, contactValue };
  delete visible.registrationKey;
  if (!staff) {
    // Explicit customer projection: adding an internal field must never publish it.
    const fields = ['id','revision','studentId','name','college','campus','phone','social',
      'email','contactType','contactValue','deviceType','brand','deviceModel','serial',
      'warranty','faultType','issue','liquidDrop','liquidMetal','dellG15','date','timeSlot',
      'status','outcome','receivedAt','startedAt','completedAt','expiresAt','createdAt','source',
      'parentAppointmentId','linkKind','repairNumber','locationSnapshot','locationRevision','servicePaused',
      'agreementAt','agreementVersion','signature'];
    return Object.fromEntries(fields.map(key => [key, visible[key]]));
  }
  return visible;
}
export function appointmentService(
  appointments,
  users,
  encryptionKey,
  clock = () => new Date(),
  staffPlatform,
  bookingSettings = null
) {
  const present = async (item, staff = false, campuses) => {
    const [visible, location, repairHistory] = await Promise.all([
      presentAppointment(item, encryptionKey, { staff }),
      appointments.location(item.date, item.campus),
      appointments.repairHistory(item.id, { staff, campuses })
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
  const expire = (instant, scope) => appointments.expirePending(instant.toISOString(), scope);
  function repairResult(outcome, note) {
    if (!repairOutcomes.includes(outcome) || !note?.trim())
      fail(400, '请选择维修结果并填写维修说明');
  }
  async function mutate(id,input,actor,action,prepare,permission='repair.receive') {
    const item=await appointments.find(id);
    if (!item) fail(404,'工单不存在');
    requireCampus(actor,item.campus);
    const {context}=await staffPlatform.field.requireEligible(actor,item.campus,permission);
    const receipt=await staffPlatform.field.receipt(actor,action,{...input,id},id);
    if (receipt.replay) return receipt.replay;
    if (!Number.isInteger(input.revision) || input.revision!==item.revision) fail(409,'工单已更新，请刷新后重试');
    const at=clock().toISOString();
    const patch=await prepare(item,context,at);
    const contactBefore={};
    for (const key of ['phone','social','email','contactValue']) if (Object.hasOwn(patch,key))
      contactBefore[key]=await encryptText(await readStoredContact(item[key],encryptionKey),encryptionKey);
    const updated=await appointments.update(item,patch,null,{
      actor:{...actor,memberId:context.actor.memberId,authVersion:context.authVersion},
      action,requestId:input.requestId,payloadHash:receipt.payloadHash,at,
      reason:input.reason || '',verification:input.verification,contactBefore
    });
    if (!updated) fail(409,'工单或账号已更新，请刷新后重试');
    return staffPlatform.field.detail(actor,id);
  }
  async function receiving(item,input,actor,at) {
    if (item.receivedAt) return {};
    if (item.status!=='booked' || item.date!==dateKey(new Date(at))) fail(409,'请在预约当天接收设备');
    if ((await appointments.serviceDay(item.date,item.campus))?.paused) fail(409,'该日期暂停服务');
    const front=await appointments.intakePhoto(item.id,input.frontPhotoId,'intake_front',at);
    const back=await appointments.intakePhoto(item.id,input.backPhotoId,'intake_back',at);
    const photos=front && back;
    if (!photos && !(input.photosCaptured===true && input.uploadTimedOut===true)) fail(400,'请先拍摄正反面照片并尝试上传');
    return {receivedAt:at,receivedBy:actor.account,
      frontPhotoId:front ? input.frontPhotoId : null,backPhotoId:back ? input.backPhotoId : null,
      photoDeferredBy:photos ? null : actor.account,
      ...(input.verification ? {brand:input.verification.brand,deviceModel:input.verification.model,warranty:input.verification.warranty,liquidMetal:input.verification.liquidMetal} : {})};
  }
  return {
    async resolveAttempt(key, digest) {
      const receipt = await appointments.findRequest(key);
      if (!receipt) return { found: false };
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
          '本次预约已创建，但私人凭证已由工作人员重新签发，请使用新链接',
          'CREDENTIAL_ROTATED'
        );
      return {
        found: true,
        appointment: { ...(await this.lookup(item.id, token)), accessToken: token }
      };
    },
    async overview(user) {
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
      const makeItems = (days) =>
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
    async list(query, user) {
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
    async counts(query, user) {
      const result = await this.list({ ...query, deferCounts: false, limit: 1 }, user);
      return { counts: result.counts, filteredCounts: result.filteredCounts };
    },
    async createOnsite(data, actor, requestId) {
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
        if (parent.status!=='completed' || parent.studentId!==data.studentId || !['continuation','recurrence'].includes(data.linkKind) || data.sameDeviceAndFault!==true) fail(409,'请确认同一设备原故障的续修或复发');
        data={...data,linkedBy:actor.account,linkedAt:clock().toISOString()};
      }
      return this.create(data, { actor: actor.account, authVersion: context.authVersion, campuses: actor.authorizedCampuses, requestId },onsiteRequestKey(actor.memberId,requestId));
    },
    async registrationCredential(item,actor) {
      if (!ownsRegistration(actor,item)) return null;
      await staffPlatform.requirePermission(actor,'onsite.create',{campusId:item.campus,id:item.id});
      const visible=await staffPlatform.field.detail(actor,item.id);
      if (visible.name===undefined || visible.social===undefined) return null;
      const saved=await appointments.findRequest(onsiteRequestKey(actor.memberId,item.registrationKey));
      if (!saved || saved.appointmentId!==item.id) return null;
      const token=await decryptText(saved.encryptedToken,encryptionKey);
      // A reprint must never resurrect a credential revoked by an administrator.
      return await appointments.findByCredential(item.id,hashAccessToken(token)) ? token : null;
    },
    async create(data, onsite, requestKey) {
      const digest = requestKey ? bookingDigest(data) : null;
      if (requestKey) {
        const previous = await this.resolveAttempt(requestKey, digest);
        if (previous.found) return previous.appointment;
      }
      const instant = clock(),
        today = dateKey(instant);
      const expiresAt = expirationDeadline(data.date);
      if ((await appointments.serviceDay(data.date, data.campus))?.paused)
        fail(409, '该日期暂停维修，请选择其他日期', 'SERVICE_DAY_PAUSED');
      let importantNotices = [];
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
      const timestamp = instant.toISOString(),
        credential = issueAccessToken();
      const [phone, social, email, contactValue] = await Promise.all(
        [data.phone, data.social, data.email, data.contactValue].map((value) =>
          encryptText(value, encryptionKey)
        )
      );
      const item = {
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
        accessTokenHash: credential.hash,
        credentialRotatedAt: timestamp,
        phone,
        social,
        email,
        contactValue
      };
      const request = requestKey
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
      item.createdAt = item.agreementAt = item.credentialRotatedAt = checkedAt.toISOString();
      const created = await appointments.create(item, request, onsite);
      if (!created) {
        const replay=requestKey && await this.resolveAttempt(requestKey,digest);
        if (replay?.found) return replay.appointment;
        fail(409,'账号权限已更新，请刷新后重试');
      }
      return { ...(await present(created, !!onsite, onsite?.campuses)), accessToken: credential.token };
    },
    async lookup(id, accessToken) {
      const item = await guestAppointment(appointments, id, accessToken);
      await expire(clock(), { repairChainId: item.id });
      return present(await guestAppointment(appointments, item.id, accessToken));
    },
    async link(id,input,actor) {
      if (!['continuation','recurrence'].includes(input.linkKind) || input.sameDeviceAndFault!==true) fail(400,'请确认同一设备的原故障续修或复发');
      return mutate(id,input,actor,'repairs.linked',async(item,context,at)=>{
        if (!['booked','in_progress'].includes(item.status) || item.parentAppointmentId) fail(409,'请选择尚未关联的本次服务工单');
        const parent=await appointments.find(input.parentAppointmentId);
        if (!parent) fail(404,'原工单不存在');
        requireCampus(actor,parent.campus);
        if (parent.id===id || parent.status!=='completed' || parent.studentId!==item.studentId) fail(409,'只能关联同一客户已结束的原维修单');
        return {parentAppointmentId:parent.id,linkKind:input.linkKind,linkedBy:actor.account,linkedAt:at};
      });
    },
    async edit(id,input,actor) {
      const contacts=['phone','social','email','contactValue'];
      const limits={name:80,brand:80,deviceModel:120,faultType:80,issue:10000,phone:120,social:120,email:254,contactType:40,contactValue:120};
      const patch={};
      for (const [key,limit] of Object.entries(limits)) if (Object.hasOwn(input,key)) {
        const value=stringField(input[key],key,limit,['name','brand','faultType'].includes(key));
        patch[key]=contacts.includes(key) ? await encryptText(value,encryptionKey) : value;
      }
      if (!Object.keys(patch).length) fail(400,'没有需要修改的资料');
      return mutate(id,input,actor,'repairs.information.updated',()=>patch);
    },
    async receive(id,input,actor) {
      return mutate(id,input,actor,'repairs.received',async (item,context,at)=>{
        if (item.status!=='booked' || item.receivedAt) fail(409,'设备已接收或本次服务已结束');
        return receiving(item,input,actor,at);
      });
    },
    async supplement(id,input,actor) {
      return mutate(id,input,actor,'repairs.photos.supplemented',async item=>{
        if (item.photoDeferredBy!==actor.account) fail(403,'请由首次接收经办人补传原图');
        const front=input.frontPhotoId || item.frontPhotoId,back=input.backPhotoId || item.backPhotoId;
        const at=clock().toISOString();
        if ((!front && !back) || (front && !await appointments.intakePhoto(id,front,'intake_front',at)) || (back && !await appointments.intakePhoto(id,back,'intake_back',at))) fail(400,'请选择本单首次接收的原图');
        return {frontPhotoId:front || null,backPhotoId:back || null,photoDeferredBy:front && back ? null : actor.account};
      });
    },
    async transfer(id,input,actor) {
      return mutate(id,input,actor,'repairs.transferred',item=>{
        if (item.status!=='in_progress') fail(409,'只有维修中的工单可以交接');
        if (item.assignedMemberId===actor.memberId) fail(409,'你已经是当前主修');
        if (input.receivedDevice!==true) fail(400,'请确认已经实际接到设备');
        return {assignedTo:actor.account};
      },'repair.transfer');
    },
    async recover(id, input, actor) {
      const item = await appointments.find(id);
      if (!item) fail(404, '预约不存在');
      {
        requireCampus(actor, item.campus);
        await staffPlatform.requirePermission(actor, 'repair.correct', {
          campusId: item.campus,
          id: item.id,
          assignedMemberId: item.assignedMemberId,
          businessDate: item.date
        });
      }
      if (
        input.identityVerified !== true ||
        typeof input.reason !== 'string' ||
        input.reason.trim().length < 8 ||
        input.reason.length > 300
      )
        fail(400, '请确认已人工核验身份，并记录至少 8 字的核验说明');
      const credential = issueAccessToken();
      if (
        !(await appointments.rotateCredential(
          item,
          credential.hash,
          actor.account,
          input.reason.trim(),
          clock().toISOString()
        ))
      )
        fail(409, '预约已更新，请刷新后重试');
      return { id: item.id, accessToken: credential.token };
    },
    async update(id,{patch:input,revision,action,requestId,verification,photosCaptured,uploadTimedOut},user,accessToken) {
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
      const permission=action==='correct' ? 'repair.summary.read' : input.status==='in_progress' ? 'repair.start' : input.status==='completed' || !input.status ? 'repair.finish.own' : 'repair.receive';
      return mutate(id,command,user,operation,async (item,context,at)=>{
        const own=item.assignedMemberId===context.actor.memberId;
        if (action==='correct') {
          if (item.status!=='completed') fail(409,'只有已结束工单可更正结果和说明');
          const target={campusId:item.campus,id,assignedMemberId:item.assignedMemberId};
          if (!own || !staffPlatform.evaluate(context,'repair.finish.own',target).allowed) await staffPlatform.requirePermission(user,'repair.correct',target);
          if (Object.keys(input).some(key=>!['outcome','repairNote'].includes(key))) fail(400,'更正只修改结果和说明');
          repairResult(input.outcome,input.repairNote);
          return {outcome:input.outcome,repairNote:input.repairNote};
        }
        if (item.status==='booked' && input.status==='in_progress') {
          if (item.date!==dateKey(new Date(at)) && !item.receivedAt) fail(409,'预约仅在当天接单；隔天请重新预约或现场登记');
          return {...await receiving(item,command,user,at),status:'in_progress',assignedTo:user.account,startedAt:at};
        }
        if (item.status==='in_progress' && own && input.status==='completed') {
          repairResult(input.outcome,input.repairNote);
          return {status:'completed',outcome:input.outcome,repairNote:input.repairNote,completedAt:at};
        }
        if (item.status==='in_progress' && own && !input.status && typeof input.repairNote==='string') return {repairNote:input.repairNote};
        if (item.status==='booked' && !item.receivedAt && input.status==='cancelled') return {status:'cancelled',completedAt:at};
        fail(409,'当前状态不能执行此操作；维修中工单请由当前主修结束或实际接手后处理');
      },permission);
    }
  };
}
