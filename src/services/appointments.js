import { MAX_BOOKING_DEVICES } from '../../shared/booking-devices.js';
import { fail } from '../lib/http.js';
import { encryptText, decryptText } from '../lib/privacy.js';
import {
  addDays,
  dateKey,
  serviceDay,
  slotDeadline,
  expirationDeadline,
  validDate,
  weekRange
} from '../../shared/time.js';
import { issueAccessToken, bookingDigest, hashAccessToken, onsiteRequestKey } from '../lib/access-tokens.js';
import { requestId as validRequestId } from '../platform/contracts.js';
import { guestAppointment } from './access.js';
import { repairOutcomes, TIME_SLOTS } from '../../shared/constants.js';
import { bookingWindow } from '../../shared/booking-settings.js';
import {
  appointmentScope,
  requireRole,
  requireCampus,
  ownsRepair,
  ownsRegistration
} from './permissions.js';

export async function presentAppointment(item, encryptionKey, { staff = false } = {}) {
  const [phone, social, email, contactValue] = await Promise.all(
    [item.phone, item.social, item.email, item.contactValue].map((value) =>
      decryptText(value, encryptionKey)
    )
  );
  const visible = { ...item, phone, social, email, contactValue };
  delete visible.registrationKey;
  if (!staff) {
    delete visible.assignedToName;
    delete visible.assignedMemberId;
    delete visible.registeredMemberId;
    if (visible.reception) visible.reception = { state: visible.reception.state, receivedAt: visible.reception.receivedAt, leftAt:visible.reception.leftAt, ticket:visible.reception.ticket };
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
  const present = async (item, staff = false) => {
    const [visible, location, repairHistory, devices] = await Promise.all([
      presentAppointment(item, encryptionKey, { staff }),
      appointments.location(item.date, item.campus),
      appointments.repairHistory(item.id, { staff }),
      appointments.bookingDeviceContext(item)
    ]);
    return {
      ...visible,
      relatedDevices: devices.related,
      canAddDevice:
        item.source === 'booking' &&
        item.status === 'booked' &&
        devices.dailyCount < MAX_BOOKING_DEVICES &&
        Date.parse(slotDeadline(item.date, item.timeSlot)) > clock().getTime(),
      queuePosition:
        item.status === 'booked' && ['queued', 'assigned'].includes(item.reception?.state)
          ? await appointments.receptionPosition(item)
          : null,
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
  async function assignee(value, campus) {
    let user = await users.find(value.toLowerCase());
    if (!user) {
      const matches = await users.findByName(value);
      if (matches.length > 1) fail(400, '有多个同名工作人员，请输入学号');
      user = matches[0];
    }
    if (user?.status !== 'enabled' || user.memberStatus === 'inactive')
      fail(400, '维修人员账号不存在或未启用');
    requireCampus(user, campus);
    return user.account;
  }
  function repairResult(outcome, note) {
    if (!repairOutcomes.includes(outcome) || !note?.trim())
      fail(400, '请选择维修结果并填写维修说明');
  }
  function repeated(item, input, user, action) {
    return (
      !action &&
      ownsRepair(user, item) &&
      ((input.status === 'in_progress' &&
        item.status === 'in_progress' &&
        input.frontPhotoId === item.frontPhotoId &&
        input.backPhotoId === item.backPhotoId) ||
        (input.status === 'completed' &&
          item.status === 'completed' &&
          input.outcome === item.outcome &&
          input.repairNote === item.repairNote))
    );
  }
  async function exitQueue(item, input, accessToken, credentialScope = {}) {
    if (!input || !validRequestId(input.requestId) || !Number.isInteger(input.revision)) fail(400,'请提供有效操作编号和工单版本');
    const replay=await appointments.guestQueueExitReceipt(item.id,input.requestId);
    if (replay) {
      if (JSON.parse(replay.before_json).revision!==input.revision) fail(409,'请勿重复使用不同操作的请求编号');
      return;
    }
    if (item.revision!==input.revision) fail(409,'工单已更新，请刷新并核对后重试');
    if (item.status!=='booked' || !['queued','assigned'].includes(item.reception?.state)) fail(409,'当前不在现场排队，无法退出');
    const at=clock().toISOString();
    const updated=await appointments.update(item,{status:'booked'},undefined,{
      actor:{memberId:null,account:null},action:'receptions.guest_leave',auditId:'guest-leave-'+item.id+'-'+input.requestId,
      requestId:input.requestId,...credentialScope,guestCredentialHash:hashAccessToken(accessToken),at,reason:'客户主动退出现场排队',
      reception:{state:'closed',leftAt:at}
    });
    if (!updated && !await appointments.guestQueueExitReceipt(item.id,input.requestId)) fail(409,'工单已更新，请重新查询后操作');
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
      const appointment = { ...(await this.lookup(item.id, token)), accessToken: token };
      const extra = await appointments.requestDevices(key);
      if (extra.length + 1 !== receipt.deviceCount) fail(409, '部分预约已被移除，请核对已有预约或联系工作人员', 'CREDENTIAL_ROTATED');
      if (extra.length) {
        const items = [appointment];
        for (const entry of extra) {
          const accessToken = await decryptText(entry.encryptedToken, encryptionKey);
          if (
            !(await appointments.findByCredential(
              entry.appointmentId,
              hashAccessToken(accessToken)
            ))
          )
            fail(409, '部分预约凭证已重新签发，请使用工作人员提供的私人链接', 'CREDENTIAL_ROTATED');
          items.push({ ...(await this.lookup(entry.appointmentId, accessToken)), accessToken });
        }
        return { found: true, appointment: { ...appointment, appointments: items } };
      }
      return { found: true, appointment };
    },
    async overview(user) {
      user = await staffPlatform.scopedActor(user, 'repair.summary.read');
      const instant = clock(),
        start = dateKey(instant),
        end = addDays(start, 6);
      const { campuses } = appointmentScope(user);
      await expire(instant, { campuses });
      const week = weekRange(start);
      const { totals, capacities } = await appointments.overview(week.start, end, campuses);
      const dates = Array.from({ length: 7 }, (_, index) => addDays(start, index)).filter(
        serviceDay
      );
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
              remaining: Math.max(0, capacity - occupied),
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
        items: makeItems(dates),
        week: { ...week, dates: weekDates, items: makeItems(weekDates) },
        updatedAt: instant.toISOString()
      };
    },
    async list(query, user) {
      const access = await staffPlatform.field.listAccess(user);
      const scope = { campuses: user.authorizedCampuses, ...access };
      await expire(clock(), { campuses: scope.campuses });
      const result = await appointments.list(query, scope);
      return {
        ...result,
        items: await staffPlatform.field.projectList(user, result.items, access.context)
      };
    },
    async createOnsite(data, actor, requestId, registrationFlow = 'technician_intake') {
      requireRole(actor, 'technician');
      requireCampus(actor, data.campus);
      await staffPlatform.requirePermission(
        actor,
        registrationFlow === 'frontdesk' ? 'onsite.frontdesk.create' : 'onsite.create',
        { campusId: data.campus }
      );
      return this.create(data, { actor: actor.account, requestId, registrationFlow },onsiteRequestKey(actor.memberId,requestId));
    },
    async registrationCredential(item,actor) {
      if (!ownsRegistration(actor,item)) return null;
      await staffPlatform.requirePermission(actor,item.registrationFlow==='frontdesk'?'onsite.frontdesk.create':'onsite.create',{campusId:item.campus,id:item.id});
      const visible=await staffPlatform.field.detail(actor,item.id);
      if (visible.name===undefined || visible.social===undefined) return null;
      const saved=await appointments.findRequest(onsiteRequestKey(actor.memberId,item.registrationKey));
      if (!saved || saved.appointmentId!==item.id) return null;
      const token=await decryptText(saved.encryptedToken,encryptionKey);
      // A reprint must never resurrect a credential revoked by an administrator.
      return await appointments.findByCredential(item.id,hashAccessToken(token)) ? token : null;
    },
    async createDevices(inputs, requestKey, additionalFor, accessToken) {
      if (additionalFor !== undefined && (typeof additionalFor !== 'string' || !additionalFor)) fail(400, '补约原单编号不正确');
      const digest = bookingDigest({ devices: inputs, additionalFor: additionalFor || null });
      // Single-device clients retain their historical request digest and response.
      if (inputs.length === 1 && !additionalFor)
        return this.create(inputs[0], undefined, requestKey);
      const previous = await this.resolveAttempt(requestKey, digest);
      if (previous.found) return previous.appointment;
      let parent = null;
      if (additionalFor) {
        if (typeof additionalFor !== 'string' || inputs.length !== 1)
          fail(400, '补约只能添加一台设备');
        const original = await guestAppointment(appointments, additionalFor, accessToken);
        const data = inputs[0];
        if (
          original.source !== 'booking' ||
          original.status !== 'booked' ||
          ['studentId', 'campus', 'date', 'timeSlot'].some((key) => original[key] !== data[key])
        )
          fail(409, '补约须沿用有效原预约的学号、校区、日期和时段');
        parent = {
          id: original.id,
          revision: original.revision,
          hash: hashAccessToken(accessToken)
        };
      }
      const prepared = [];
      for (const data of inputs) prepared.push(await this.create(data, undefined, undefined, true));
      const request = {
        key: requestKey,
        digest,
        encryptedToken: await encryptText(prepared[0].credential.token, encryptionKey)
      };
      const additional = [];
      for (const entry of prepared.slice(1))
        additional.push({
          item: entry.item,
          encryptedToken: await encryptText(entry.credential.token, encryptionKey)
        });
      if (prepared.some(({item})=>Date.parse(slotDeadline(item.date,item.timeSlot))<=clock().getTime())) fail(409, '该预约时段已经结束', 'SLOT_ENDED');
      await appointments.create(prepared[0].item, request, additional, parent);
      return (await this.resolveAttempt(requestKey, digest)).appointment;
    },
    async create(data, onsite, requestKey, prepareOnly = false) {
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
        registrationFlow: onsite?.registrationFlow || 'technician_intake',
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
      if (prepareOnly) return { item, credential };
      const created = await appointments.create(item, request);
      if (!created) return (await this.resolveAttempt(requestKey, digest)).appointment;
      return { ...(await present(created, !!onsite)), accessToken: credential.token };
    },
    async lookup(id, accessToken) {
      const item = await guestAppointment(appointments, id, accessToken);
      await expire(clock(), { repairChainId: item.id });
      return present(await guestAppointment(appointments, item.id, accessToken));
    },
    async leaveQueue(id,input,accessToken) {
      const item=await guestAppointment(appointments,id,accessToken);
      await exitQueue(item,input,accessToken);
      return present(await guestAppointment(appointments,item.id,accessToken));
    },
    async leaveFollowupQueue(parentId,followupId,input,accessToken) {
      const parent=await guestAppointment(appointments,parentId,accessToken);
      const relation=await appointments.followupForScan(parent.id,followupId);
      if (!relation) fail(404,'返修预约不存在或访问凭证无效');
      const item=await appointments.find(relation.id);
      await exitQueue(item,input,accessToken,{guestParentId:parent.id,guestFollowupId:followupId});
      return this.lookup(parent.id,accessToken);
    },
    async reception(id, input, actor) {
      if (!input || typeof input!=='object' || Array.isArray(input)) fail(400,'接待参数不正确');
      let item = await appointments.find(id);
      if (!item) fail(404, '预约不存在');
      requireCampus(actor,item.campus);
      const action = input.action;
      if (!['receive','assign','return','withdraw','cancel','reschedule','leave'].includes(action)) fail(400,'接待操作不正确');
      const field = staffPlatform.field;
      const permission = action==='receive' ? 'repair.receive' : action==='return' ? 'repair.start' : 'repair.dispatch';
      await staffPlatform.requirePermission(actor,permission,{campusId:item.campus,id:item.id,assignedMemberId:item.reception?.assignedMemberId,businessDate:dateKey()});
      const receipt = await field.receipt(actor,`receptions.${action==='receive'?'received':action}`,{...input,id},id);
      if (receipt.replay) return receipt.replay;
      const instant=clock(),at=instant.toISOString();
      await expire(instant,{id});
      item=await appointments.find(id);
      if (!Number.isInteger(input.revision) || input.revision!==item.revision) fail(409,'工单已更新，请刷新后核对');
      if (item.status!=='booked') fail(409,'只有尚未开始维修的工单可以接待或分派');
      let reception,eligibility,verification,patch={status:'booked'};
      const reason=typeof input.reason==='string'?input.reason.trim():'';
      if (reason.length>300) fail(400,'原因最多 300 字');
      if (action==='receive') {
        if (item.reception && ['queued','assigned'].includes(item.reception.state)) fail(409,'该工单已完成接待，请处理现场队列');
        if (item.date>dateKey(instant)) fail(409,'请在预约当天到场接待');
        await field.requireIntake(actor,item);
        const checked = input.verification;
        if (!checked || typeof checked.brand!=='string' || typeof checked.model!=='string' || !checked.brand.trim() || !checked.model.trim() || checked.brand.length>80 || checked.model.length>120 || !['in_warranty','expired','unknown'].includes(checked.warranty) || !['yes','no','unknown'].includes(checked.liquidMetal) || typeof checked.note!=='string' || checked.note.length>500) fail(400,'请完整填写设备核验信息');
        verification={brand:checked.brand.trim(),model:checked.model.trim(),warranty:checked.warranty,liquidMetal:checked.liquidMetal,note:checked.note.trim()};
        if (!await appointments.intakePhotos(id,actor.account,input.frontPhotoId,input.backPhotoId,at)) fail(400,'请由本次接待人员上传设备正反面照片');
        patch={...patch,frontPhotoId:input.frontPhotoId,backPhotoId:input.backPhotoId};
        reception={state:'queued'};
      } else if (action==='assign') {
        if (item.reception?.state!=='queued') fail(409,'请先完成到场接待；更换待接手人员请先撤回分派');
        const queue=await appointments.openReceptions(item.campus),head=queue.find(row=>row.reception.state==='queued');
        if (head && head.id!==id && reason.length<2) fail(400,'当前不是队首，请说明调整排队顺序的原因');
        if (typeof input.assignedTo!=='string' || !input.assignedTo.trim()) fail(400,'请选择接手人员');
        const account=await assignee(input.assignedTo,item.campus),target=await users.find(account);
        eligibility=await field.requireEligible(target,item.campus);
        reception={state:'assigned',assignedTo:account,assignedMemberId:eligibility.context.actor.memberId};
      } else if (action==='leave') {
        if (!['queued','assigned'].includes(item.reception?.state)) fail(409,'该工单当前不在现场队列');
        if (reason.length<2) fail(400,'请填写客户离队原因');
        reception={state:'closed',leftAt:at};
      } else if (action==='cancel' || action==='reschedule') {
        if (!['queued','assigned'].includes(item.reception?.state)) fail(409,'只能处理已到场、尚未开始维修的工单');
        if (reason.length<2) fail(400,'请填写联系客户后的处理原因');
        reception={state:'closed'};
        if (action==='cancel') patch={status:'cancelled',completedAt:at};
        else {
          const options=await this.receptionOptions(id,actor);
          if (!validDate(input.date) || !options.items.some(option=>option.date===input.date && option.timeSlot===input.timeSlot)) fail(409,'请选择当前开放的有效预约时段');
          if (input.date===item.date && input.timeSlot===item.timeSlot) fail(400,'请选择不同的日期或时段；原安排继续处理无需改约');
          if ((await appointments.serviceDay(input.date,item.campus))?.paused) fail(409,'该日期暂停维修');
          await appointments.ensureDefaultLocation(input.date,item.campus,at);
          patch={status:'booked',date:input.date,timeSlot:input.timeSlot,source:item.registrationFlow==='repair_followup' ? 'onsite' : 'booking',expiresAt:expirationDeadline(input.date)};
        }
      } else {
        if (item.reception?.state!=='assigned') fail(409,'当前没有待接手的分派');
        if (action==='return' && item.reception.assignedMemberId!==actor.memberId) fail(403,'只能退回分派给本人的工单');
        if (reason.length<2) fail(400,'请填写退回或撤回原因');
        reception={state:'queued'};
      }
      const updated=await appointments.update(item,patch,undefined,{actor,action:`receptions.${action==='receive'?'received':action}`,reception,verification,eligibility,reason,requestId:input.requestId,payloadHash:receipt.payloadHash,at});
      if (!updated) {
        const replay=await field.receipt(actor,`receptions.${action==='receive'?'received':action}`,{...input,id},id);
        if (replay.replay) return replay.replay;
        fail(409,'人员或工单已更新，请核对后重试');
      }
      return field.receptionResult(actor,id);
    },
    async receptionOptions(id,actor) {
      const item=await staffPlatform.field.detail(actor,id);
      if (!item.canDispatch) fail(403,'没有该工单的接待处理权限');
      const instant=clock(),today=dateKey(instant);
      const settings=bookingSettings ? await bookingSettings.public(item.campus) : null;
      const window=bookingWindow(instant,settings?.releaseTime);
      const {totals}=await appointments.overview(today,window.end,[item.campus]);
      const items=[];
      for(let day=today;day<=window.end;day=addDays(day,1)) {
        if (!serviceDay(day) || (await appointments.serviceDay(day,item.campus))?.paused) continue;
        for(const slot of await appointments.schedule(day,item.campus)) {
          const occupied=totals.find(row=>row.date===day && row.time_slot===slot.time_slot)?.occupied || 0;
          if (day===item.date && slot.time_slot===item.timeSlot) continue;
          if (TIME_SLOTS.includes(slot.time_slot) && slot.capacity>0 &&
              (item.registrationFlow==='repair_followup' || occupied<slot.capacity) &&
              Date.parse(slotDeadline(day,slot.time_slot))>instant.getTime()) items.push({date:day,timeSlot:slot.time_slot});
        }
      }
      return {items};
    },
    async transfer(id, input, actor) {
      const item = await appointments.find(id);
      if (!item) fail(404, '预约不存在');
      const receipt = await staffPlatform.field.receipt(
        actor,
        'repairs.transferred',
        { ...input, id },
        id
      );
      if (receipt?.replay) return receipt.replay;
      await staffPlatform.requirePermission(actor, 'repair.transfer', { campusId: item.campus });
      requireCampus(actor, item.campus);
      if (item.status !== 'in_progress') fail(409, '只有维修中的工单可以转派');
      const account = await assignee(input.assignedTo, item.campus);
      if (!input.reason || input.reason.trim().length < 2) fail(400, '请填写转派原因');
      if (input.revision !== undefined && input.revision !== item.revision)
        fail(409, '预约已被其他工作人员修改，请刷新后重试');
      const eligibility = await staffPlatform.field.assertTransfer(actor, item, account);
      const workflow = {
        eligibility,
        actor,
        action: 'repairs.transferred',
        reason: input.reason,
        requestId: input.requestId,
        payloadHash: receipt.payloadHash,
        at: clock().toISOString()
      };
      const updated = await appointments.update(item, { assignedTo: account }, undefined, workflow);
      if (!updated) fail(409, '预约已被其他操作修改，请刷新后重试');
      return staffPlatform.field.detail(actor, updated.id);
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
    async update(
      id,
      {
        patch: input,
        revision,
        action,
        correctionReason = '',
        requestId = '',
        reason = '',
        verification
      },
      user,
      accessToken
    ) {
      if (!Object.keys(input).length) fail(400, '没有可更新的字段');
      let item = user
        ? await appointments.find(id)
        : await guestAppointment(appointments, id, accessToken);
      if (!item) fail(404, '预约不存在');
      if (user) requireCampus(user, item.campus);
      const workflowAction =
        input.status === 'in_progress'
          ? 'repairs.started'
          : input.status === 'completed'
            ? 'repairs.completed'
            : 'repairs.updated';
      const receipt =
        user && !action
          ? await staffPlatform.field.receipt(
              user,
              workflowAction,
              { input, revision, requestId, reason, verification, id },
              id
            )
          : null;
      if (receipt?.replay) return receipt.replay;
      const instant = clock(),
        timestamp = instant.toISOString();
      await expire(instant, { id: item.id });
      item = user
        ? await appointments.find(item.id)
        : await guestAppointment(appointments, item.id, accessToken);
      // A lost response can be retried with the original revision and photo IDs.
      // Only an exact repeat by the recorded owner is treated as success.
      if (repeated(item, input, user, action)) return staffPlatform.field.detail(user, item.id);
      if (revision !== undefined && revision !== item.revision)
        fail(409, '预约已更新，请刷新后重试');
      if (
        (input.frontPhotoId !== undefined || input.backPhotoId !== undefined) &&
        (action === 'correct' || input.status !== 'in_progress')
      )
        fail(400, '签到照片只能在签到时记录');
      if (input.expiresAt !== undefined && action !== 'correct')
        fail(400, '有效截止时间只能由管理员纠错设置');
      let patch, eligibility;
      if (action === 'correct') {
        await staffPlatform.requirePermission(user, 'repair.correct', {
          campusId: item.campus,
          assignedMemberId: item.assignedMemberId,
          id: item.id,
          businessDate: item.date
        });
        requireCampus(user, item.campus);
        const status = input.status || item.status;
        if (input.expiresAt !== undefined && status !== 'booked')
          fail(400, '有效截止时间只能在恢复为已预约时设置');
        if (
          ['in_progress', 'completed'].includes(status) &&
          ['booked', 'cancelled', 'expired'].includes(item.status)
        )
          fail(409, '请先恢复为已预约，再通过签到上传照片并开始维修');
        if (input.outcome !== undefined && status !== 'completed')
          fail(400, '仅已完成工单可以填写维修结果');
        patch = { ...input, status };
        if (status === 'booked') {
          const late = instant.getTime() >= Date.parse(expirationDeadline(item.date));
          if (late && input.expiresAt === undefined)
            fail(409, '已过原有效期限，请填写纠错原因并指定新的有效截止时间');
          if (
            (late || input.expiresAt !== undefined) &&
            (correctionReason.trim().length < 8 || correctionReason.length > 300)
          )
            fail(400, '请填写 8 至 300 字的纠错原因');
          const expiresAt = input.expiresAt ?? item.expiresAt;
          if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= instant.getTime())
            fail(409, '新的有效截止时间必须晚于当前时间');
          patch = {
            status,
            expiresAt,
            assignedTo: '',
            startedAt: null,
            completedAt: null,
            outcome: null,
            repairNote: '',
            frontPhotoId: null,
            backPhotoId: null
          };
        } else {
          const account = input.assignedTo ?? item.assignedTo;
          if (account)
            patch.assignedTo =
              status === 'in_progress' || account !== item.assignedTo
                ? await assignee(account, item.campus)
                : account;
          else if (
            status === 'in_progress' ||
            repairOutcomes.includes(input.outcome ?? item.outcome)
          )
            fail(400, '请指定维修人员');
          if (status === 'in_progress') {
            if (item.status === 'in_progress' && patch.assignedTo !== item.assignedTo)
              eligibility = await staffPlatform.field.assertTransfer(user, item, patch.assignedTo);
            else if (item.status !== 'in_progress')
              eligibility = await staffPlatform.field.requireEligible(
                await users.find(patch.assignedTo),
                item.campus,
                item.id
              );
            patch.completedAt = null;
            patch.outcome = null;
          } else if (status === 'completed') {
            patch.outcome = input.outcome ?? item.outcome;
            if (
              !(
                item.status === 'completed' &&
                item.outcome === 'legacy_unknown' &&
                input.outcome === undefined
              )
            )
              repairResult(patch.outcome, input.repairNote ?? item.repairNote);
            patch.completedAt = item.status === 'completed' ? item.completedAt : timestamp;
          } else {
            if (
              status === 'expired' &&
              (item.startedAt || item.status === 'in_progress' || item.status === 'completed')
            )
              fail(409, '已记录维修开始的工单不能改为已逾期');
            if (status === 'expired' && instant.getTime() < Date.parse(item.expiresAt))
              fail(409, '尚未到有效截止时间');
            patch.outcome = null;
            patch.completedAt = item.status === status ? item.completedAt : timestamp;
          }
        }
      } else if (!user) {
        if (input.status !== 'cancelled' || input.outcome !== undefined)
          fail(403, '学生仅可取消尚未开始维修的预约');
        if (item.status !== 'booked') fail(409, '当前状态不能取消');
        patch = { status: 'cancelled', outcome: null, completedAt: timestamp };
      } else if (
        item.status === 'booked' &&
        input.status === 'cancelled' &&
        input.outcome === undefined &&
        item.source === 'onsite' &&
        ownsRegistration(user, item)
      ) {
        patch = { status: 'cancelled', outcome: null, completedAt: timestamp };
      } else {
        const starting = item.status === 'booked' && input.status === 'in_progress';
        requireCampus(user, item.campus);
        if (input.assignedTo !== undefined) fail(403, '维修人员由签到记录，转派请使用管理员纠错');
        if (starting) {
          {
            eligibility = await staffPlatform.field.requireEligible(user, item.campus,item.id);
            if (item.reception?.state==='assigned' && item.reception.assignedMemberId!==user.memberId) fail(409,'该工单已分派给其他维修人员');
            if (item.reception?.leftAt) fail(409,'客户已离队，请先重新接待并排号');
            if (item.reception?.state!=='assigned') {
              const head=(await appointments.openReceptions(item.campus)).find(row=>row.reception.state==='queued');
              if (head && head.id!==item.id) fail(409,'请先处理现场队首工单；客户暂未到场时请由接待或负责人说明原因后分派后续工单');
            }
            if (!verification) fail(400, '请完成现场设备核验');
          }
          if (input.outcome !== undefined) fail(400, '开始维修不能填写结束结果');
          if (
            !(await appointments.intakePhotos(
              item.id,
              user.account,
              input.frontPhotoId,
              input.backPhotoId,
              timestamp
            )) && !(await appointments.receivedPhotos(item.id,input.frontPhotoId,input.backPhotoId,timestamp,user.account))
          )
            fail(400, '请由本次签到人员上传电脑正面和反面照片');
          patch = {
            status: 'in_progress',
            assignedTo: user.account,
            startedAt: timestamp,
            completedAt: null,
            outcome: null,
            frontPhotoId: input.frontPhotoId,
            backPhotoId: input.backPhotoId
          };
        } else if (
          item.status === 'booked' &&
          input.status === 'cancelled' &&
          input.outcome === undefined
        ) {
          await staffPlatform.requirePermission(user, 'repair.correct', {
            campusId: item.campus,
            id: item.id,
            businessDate: item.date
          });
          patch = { status: 'cancelled', outcome: null, completedAt: timestamp };
        } else if (item.status === 'in_progress' && input.status === 'completed') {
          {
            if (!ownsRepair(user, item)) fail(403, '只能完成本人当前维修');
            await staffPlatform.requirePermission(user, 'repair.finish.own', {
              campusId: item.campus,
              assignedMemberId: item.assignedMemberId
            });
          }
          repairResult(input.outcome, input.repairNote);
          patch = {
            status: 'completed',
            outcome: input.outcome,
            repairNote: input.repairNote,
            completedAt: timestamp
          };
        } else if (
          item.status === 'in_progress' &&
          input.status === undefined &&
          input.outcome === undefined &&
          input.repairNote !== undefined
        ) {
          {
            if (!ownsRepair(user, item)) fail(403, '只能编辑本人当前维修');
            await staffPlatform.requirePermission(user, 'repair.finish.own', {
              campusId: item.campus,
              assignedMemberId: item.assignedMemberId
            });
          }
          patch = { repairNote: input.repairNote };
        } else fail(409, '当前状态不能执行此操作，修正记录请使用管理员纠错');
      }
      const correctionContext = action === 'correct' ? await staffPlatform.contextFor(user) : null;
      const correction =
        action === 'correct'
          ? {
              id: crypto.randomUUID(),
              actor: user.account,
              reason: correctionReason.trim(),
              instant: timestamp
            }
          : undefined;
      const workflowActor = correctionContext
        ? { ...user, memberId: correctionContext.actor.memberId }
        : user;
      const workflow = user
        ? {
            eligibility,
            actor: workflowActor,
            action: correction ? 'repairs.corrected' : workflowAction,
            verification,
            enforceQueueHead: !correction && workflowAction==='repairs.started' && item.reception?.state!=='assigned',
            reason: correction ? correction.reason : reason,
            requestId,
            payloadHash: receipt?.payloadHash,
            at: timestamp
          }
        : null;
      const updated = await appointments.update(item, patch, correction, workflow);
      if (!updated) {
        const latest = await appointments.find(item.id);
        if (latest && repeated(latest, input, user, action))
          return staffPlatform.field.detail(user, latest.id);
        fail(409, '预约已被其他工作人员修改，请刷新后重试');
      }
      return workflow && !correction
        ? staffPlatform.field.detail(user, updated.id)
        : present(updated, !!user);
    }
  };
}
