import { fail } from '../lib/http.js';
import { dateKey, eventWindow } from '../platform/time.js';
import { campusId } from '../modules/authorization/scopes.js';
import { scanCode } from '../lib/scan-code.js';
import { presentAppointment } from './appointments.js';
import { appointmentAccessRules } from '../modules/authorization/appointment-access.js';
import { requestId, stableJson } from '../platform/contracts.js';
import {
  staffIdentities,
  fieldPersonGroup,
  compareFieldPeople
} from '../../shared/staff-identities.js';
import { APPOINTMENT_SEARCH_LIMIT } from '../../shared/appointment-search.js';

// The UI consumes these decisions; commands recompute them against current facts.
export function fieldWorkflow({
  repository,
  appointments,
  users,
  staff,
  authorizer,
  encryptionKey,
  secret
}) {
  const names = { 'campus-nanhu': '南湖', 'campus-hunnan': '浑南' };
  const allowed = (context, code, target = {}) =>
    authorizer.evaluate(context.actor, code, target, context, context.grants).allowed;
  async function eligibility(actor, campus, ignoreAppointment = '', providedContext) {
    const context = providedContext || (await staff.contextFor(actor)),
      id = campusId(campus);
    const [current, pending, event, serviceDay] = await Promise.all([
      appointments.currentRepair(actor.account),
      appointments.pendingDispatch(actor.account),
      repository.dutyEvent(dateKey(), id),
      repository.serviceDay(dateKey(), id)
    ]);
    const qualified = context.workProfiles.some((item) =>
      ['repair', 'exchange'].includes(item.profileCode)
    );
    const paused = !!serviceDay?.paused;
    const reason = paused
      ? '该校区今天暂停维修'
      : !qualified || !allowed(context, 'repair.start', { campusId: id })
        ? '当前没有该校区的维修资格'
        : current && current.id !== ignoreAppointment
          ? '请先完成当前维修'
          : pending && pending.id !== ignoreAppointment
            ? '请先处理待接手工单，或填写原因退回'
          : !context.presence || context.presence.campusId !== id
            ? '请先完成该校区到岗签到'
            : context.presence.state !== 'available'
              ? '请先返回岗位'
              : !event || !eventWindow(event.startsAt, event.endsAt, new Date().toISOString())
                ? '当前不在值班工作窗口'
                : '';
    return { allowed: !reason, reason, context, event, current, pending };
  }
  async function requireEligible(actor, campus, ignoreAppointment = '') {
    const result = await eligibility(actor, campus, ignoreAppointment);
    if (!result.allowed) fail(409, result.reason, 'WORK_NOT_READY');
    return result;
  }
  async function home(actor, query = {}, providedContext) {
    const context = providedContext || (await staff.contextFor(actor));
    const campuses = (actor.authorizedCampuses || []).map((value) => ({
      id: campusId(value),
      name: names[campusId(value)] || value
    }));
    const selected =
      query.campusId ||
      context.presence?.campusId ||
      context.todayDuties[0]?.campusId ||
      campuses[0]?.id;
    if (!campuses.some((item) => item.id === selected)) fail(403, '没有该校区的访问权限');
    const target = { campusId: selected, memberId: context.actor.memberId };
    const capability = Object.fromEntries(
      [
        'repair.summary.read',
        'repair.start',
        'repair.transfer',
        'repair.receive',
        'repair.dispatch',
        'onsite.create',
        'onsite.frontdesk.create',
        'attendance.self',
        'attendance.session.manage',
        'members.manage',
        'roles.manage'
      ].map((code) => [code, allowed(context, code, target)])
    );
    const ready = await eligibility(actor, selected, '', context);
    const current = ready.current ? await detail(actor, ready.current.id) : null;
    const contexts = [];
    if (
      (capability['repair.summary.read'] &&
        context.workProfiles.some((item) => ['repair', 'exchange'].includes(item.profileCode))) ||
      current
    )
      contexts.push({ id: 'repair', label: '维修工作台' });
    if (['onsite.frontdesk.create', 'repair.receive', 'repair.dispatch', 'repair.transfer'].some(code => capability[code]))
      contexts.push({ id: 'desk', label: '现场工作台' });
    const head=ready.allowed ? await appointments.receptionHead(names[selected]) : null;
    const nextInQueue=head ? await project(actor,await appointments.find(head.appointment_id),context) : null;
    const state = current
      ? 'repairing'
      : ready.pending ? 'pending'
      : !context.presence
        ? 'unsigned'
        : context.presence.state === 'away'
          ? 'away'
          : ready.allowed
            ? 'available'
            : 'closed';
    return {
      businessDate: dateKey(),
      actor: context.actor,
      authVersion: context.authVersion,
      campuses,
      campusId: selected,
      contexts,
      capability,
      directAttendance: await staff.directAttendanceAction(actor, selected, context),
      permissions: context.permissions,
      navigation: context.navigation,
      state,
      reason: ready.reason,
      currentRepair: current,
      nextInQueue,
      pendingRepair: ready.pending ? await detail(actor,ready.pending.id) : null,
      todayDuties: context.todayDuties,
      identities: staffIdentities(context, authorizer, { campusId: selected }),
      pendingSwapInvitations: context.permissions['roster.read']
        ? await repository.pendingSwapInvitations(context.actor.memberId)
        : 0,
      presence: context.presence,
      event: ready.event,
      updatedAt: new Date().toISOString()
    };
  }
  const appointmentTarget = (item) => ({
    campusId: campusId(item.campus),
    assignedMemberId: item.assignedMemberId || item.reception?.assignedMemberId,
    id: item.id,
    businessDate: item.date
  });
  const canReadSummary = (actor, item, context) =>
    (allowed(context, 'repair.summary.read', appointmentTarget(item)) ||
      ((item.status==='in_progress' || ['queued','assigned'].includes(item.reception?.state)) && allowed(context,'repair.summary.read',{...appointmentTarget(item),businessDate:context.businessDate})) ||
      item.reception?.assignedMemberId === context.actor.memberId ||
      item.assignedMemberId === context.actor.memberId) &&
    (actor.authorizedCampuses || []).includes(item.campus);
  async function project(actor, item, providedContext) {
    const context = providedContext || (await staff.contextFor(actor)),
      target = appointmentTarget(item);
    if (!canReadSummary(actor, item, context)) return null;
    const identity = allowed(context, 'customer.identity.read', target),
      contact = allowed(context, 'customer.contact.read', target);
    const publicItem = contact
      ? await presentAppointment(item, encryptionKey, { staff: true })
      : item;
    const keys = [
      'id',
      'revision',
      'createdAt',
      'expiresAt',
      'repairNumber',
      'campus',
      'date',
      'timeSlot',
      'status',
      'reception',
      'servicePaused',
      'source',
      'registrationFlow',
      'deviceType',
      'brand',
      'deviceModel',
      'warranty',
      'liquidMetal',
      'dellG15',
      'faultType',
      'issue',
      'assignedTo',
      'assignedToName',
      'assignedMemberId',
      'startedAt',
      'completedAt',
      'outcome',
      'repairNote',
      'frontPhotoId',
      'backPhotoId'
    ];
    if (identity) keys.push('name', 'studentId');
    if (contact) keys.push('phone', 'social', 'email', 'contactType', 'contactValue');
    const visible = Object.fromEntries(keys.map((key) => [key, publicItem[key]]));
    visible.canReadDetails =
      item.assignedMemberId === context.actor.memberId ||
      item.reception?.assignedMemberId === context.actor.memberId ||
      identity ||
      allowed(context, 'repair.receive', target) ||
      allowed(context, 'repair.dispatch', target) ||
      allowed(context, 'repair.transfer', target);
    if (!visible.canReadDetails)
      for (const key of ['repairNote', 'frontPhotoId', 'backPhotoId']) delete visible[key];
    return visible;
  }
  async function listAccess(actor) {
    const context = await staff.contextFor(actor);
    const summaryRules = appointmentAccessRules(authorizer, actor, 'repair.summary.read', context);
    if (!summaryRules.length) fail(403, '没有查询维修预约的权限');
    // Detail projection also allows a member to retain their own assignments.
    if (context.actor.memberId)
      for (const campus of actor.authorizedCampuses || [])
        summaryRules.push({ campus, memberId: context.actor.memberId });
    return {
      context,
      summaryRules,
      identityRules: appointmentAccessRules(authorizer, actor, 'customer.identity.read', context)
    };
  }
  async function projectList(actor, items, providedContext) {
    const context = providedContext || (await staff.contextFor(actor));
    return (await Promise.all(items.map((item) => project(actor, item, context)))).filter(Boolean);
  }
  async function search(actor, query) {
    const context = await staff.contextFor(actor);
    if (!context.permissions['repair.summary.read']) fail(403, '没有查询维修预约的权限');
    const scope = { campuses: actor.authorizedCampuses || [] };
    await appointments.expirePending(new Date().toISOString(), scope);
    const items = [];
    // Apply the same current authorization and field projection as details,
    // before counting or limiting candidates. Hidden matches cannot fill the list.
    for (let offset = 0; ; offset += 100) {
      const batch = await appointments.searchNumbers(
        query.text,
        query.acrossDates ? null : dateKey(),
        scope,
        [[]],
        { full: true, limit: 100, offset }
      );
      for (const row of batch) {
        if (canReadSummary(actor, row, context))
          items.push(
            Object.fromEntries(
              ['id', 'campus', 'date', 'timeSlot', 'status','reception'].map((key) => [key, key==='reception' ? row.reception ? {state:row.reception.state} : null : row[key]])
            )
          );
        if (items.length > APPOINTMENT_SEARCH_LIMIT)
          return { items: items.slice(0, APPOINTMENT_SEARCH_LIMIT), hasMore: true };
      }
      if (batch.length < 100) return { items, hasMore: false };
    }
  }
  async function detail(actor, id) {
    const item = await appointments.find(id);
    if (!item) fail(404, '预约不存在');
    const context = await staff.contextFor(actor),
      target = {
        campusId: campusId(item.campus),
        assignedMemberId: item.assignedMemberId || item.reception?.assignedMemberId,
        id: item.id,
        businessDate: item.date
      };
    const visible = await project(actor, item, context);
    if (!visible) fail(403, '没有该预约的访问权限');
    const assigneeContexts = item.assignedMemberId
      ? await repository.fieldContexts([item.assignedMemberId], context.businessDate)
      : new Map();
    const head=item.status==='booked' && item.reception?.state!=='assigned' ? await appointments.receptionHead(item.campus) : null;
    const startBlockedReason=item.reception?.leftAt ? '客户已离队，请由接待或负责人重新扫码核验后排号' : head && head.appointment_id!==id ? '现场有更早到场的客户，请先处理队首；客户暂时不在时由接待或负责人说明原因后分派' : '';
    const canStart=!startBlockedReason && item.status==='booked' && (item.reception?.state!=='assigned' || item.reception.assignedMemberId===context.actor.memberId) && (await eligibility(actor,item.campus,item.id)).allowed;
    // The eligible technician taking the queue head needs the verified device photos;
    // customer identity/contact fields still follow their independent grants.
    if (canStart && item.reception?.state==='queued') {
      visible.canReadDetails=true;
      visible.frontPhotoId=item.frontPhotoId;
      visible.backPhotoId=item.backPhotoId;
    }
    const receptionPaused=!!(await repository.serviceDay(context.businessDate,target.campusId))?.paused;
    return {
      ...visible,
      businessDate:context.businessDate,
      receptionPaused,
      startBlockedReason,
      queuePosition:item.status==='booked' && ['queued','assigned'].includes(item.reception?.state) ? await appointments.receptionPosition(item) : null,
      assigneeIdentities:
        item.assignedMemberId && assigneeContexts.has(item.assignedMemberId)
          ? staffIdentities(assigneeContexts.get(item.assignedMemberId), authorizer, {
              campusId: target.campusId
            })
          : [],
      assigneeIdentitySnapshot: await repository.repairIdentitySnapshot(id),
      canCorrect: allowed(context, 'repair.correct', target),
      canRecoverCredential: allowed(context, 'repair.correct', target),
      canManageFollowup: allowed(context, 'repair.followup.manage', target),
      serverNow: new Date().toISOString(),
      repairHistory: visible.canReadDetails ? await appointments.repairHistory(id, { staff: true }) : null,
      original:
        visible.canReadDetails &&
        (item.assignedMemberId === context.actor.memberId ||
          allowed(context, 'customer.identity.read', target))
          ? {
              note: item.note,
              signature: item.signature,
              agreementAt: item.agreementAt,
              agreementVersion: item.agreementVersion,
              college: item.college,
              serial: item.serial,
              liquidDrop: item.liquidDrop
            }
          : null,
      intake: visible.canReadDetails ? await repository.latestIntake(id) : null,
      receptionHistory: visible.canReadDetails && item.reception ? await repository.receptionHistory(id) : [],
      canTransfer: item.status === 'in_progress' && allowed(context, 'repair.transfer', target),
      canReceive: !receptionPaused && item.status==='booked' && (!item.reception || !['queued','assigned'].includes(item.reception.state)) && item.date<=dateKey() && allowed(context,'repair.receive',{...target,businessDate:context.businessDate}),
      canDispatch: item.status==='booked' && ['queued','assigned'].includes(item.reception?.state) && allowed(context,'repair.dispatch',{...target,businessDate:context.businessDate}),
      canReturn: item.status==='booked' && item.reception?.state==='assigned' && item.reception.assignedMemberId===context.actor.memberId && allowed(context,'repair.start',target),
      canFinish:
        item.status === 'in_progress' &&
        item.assignedMemberId === context.actor.memberId &&
        allowed(context, 'repair.finish.own', target),
      canStart,
      repairCode: scanCode(item.id, secret)
    };
  }
  async function correctionAssignees(actor, id, query = {}) {
    const item = await detail(actor, id);
    if (!item.canCorrect) fail(403, '没有该预约的纠错权限');
    return {
      items: await users.assignees({ campus: item.campus, q: String(query.q || '').slice(0, 120) })
    };
  }
  async function transferCandidates(actor, id) {
    const item = await detail(actor, id);
    if (!item.canTransfer) fail(403, '没有该预约的转派权限');
    const data = await board(actor, { campusId: campusId(item.campus) });
    return {
      items: data.staffPresence.filter(
        (person) => person.canReceive && person.memberId !== item.assignedMemberId
      )
    };
  }
  async function board(actor, query = {}) {
    const context = await staff.contextFor(actor);
    const data = await home(actor, query, context);
    if (!data.contexts.some((item) => item.id === 'desk'))
      fail(403, '当前没有该校区的现场岗位权限');
    await appointments.expirePending(new Date().toISOString(), {
      campuses: [names[data.campusId]]
    });
    const list = { items: [] };
    let cursor;
    do {
      const page = await appointments.list(
        { date: data.businessDate, status: 'all', sort: 'date', direction: 'asc', cursor },
        {
          campuses: [names[data.campusId]],
          summaryRules: appointmentAccessRules(authorizer, actor, 'repair.summary.read', context)
        }
      );
      list.items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    const carryovers=await appointments.openFieldWork(names[data.campusId]);
    const seen=new Set(list.items.map(item=>item.id));
    list.items.push(...carryovers.filter(item=>!seen.has(item.id)));
    const people = await repository.fieldPeople(data.businessDate, data.campusId);
    const contexts = await repository.fieldContexts(
      people.map((person) => person.memberId),
      data.businessDate
    );
    const workloads=await appointments.dailyWorkloads(data.businessDate);
    const paused=!!(await repository.serviceDay(data.businessDate,data.campusId))?.paused;
    const staffPresence = people
      .filter((person) =>
        allowed(context, 'repair.summary.read', {
          campusId: data.campusId,
          memberId: person.memberId,
          departmentIds: (contexts.get(person.memberId)?.memberships || []).map(
            (item) => item.departmentId
          )
        })
      )
      .map((person) => {
        const personContext = contexts.get(person.memberId),
          current = personContext?.current;
        const qualified = personContext?.workProfiles.some((item) =>
          ['repair', 'exchange'].includes(item.profileCode)
        );
        const reason = paused ? '该校区今天暂停维修' :
          !personContext ||
          personContext.actor.status !== 'enabled' ||
          personContext.actor.memberStatus !== 'active'
            ? '成员或账号已停用'
            : !qualified || !allowed(personContext, 'repair.start', { campusId: data.campusId })
              ? '当前没有该校区的维修资格'
              : current
                ? current.status==='booked'?'请先处理待接手工单':'请先完成当前维修'
                : !personContext.presence || personContext.presence.campusId !== data.campusId
                  ? '请先完成该校区到岗签到'
                  : personContext.presence.state !== 'available'
                    ? '请先返回岗位'
                    : !data.event ||
                        !eventWindow(
                          data.event.startsAt,
                          data.event.endsAt,
                          new Date().toISOString()
                        )
                      ? '当前不在值班工作窗口'
                      : '';
        const result = {
          ...person,
          workload: workloads[person.memberId] || { started:0,completed:0 },
          scheduled: !!person.scheduled,
          identities: personContext
            ? staffIdentities(personContext, authorizer, { campusId: data.campusId })
            : [],
          scheduledRepair:
            personContext?.todayDuties.some(
              (duty) => duty.campusId === data.campusId && duty.dutyType === 'repair'
            ) || false,
          state: current
            ? current.status==='booked'?'pending':'repairing'
            : person.state || (person.leaveStatus === 'approved' ? 'on_leave' : 'unsigned'),
          canReceive: !reason,
          reason:
            person.leaveStatus === 'approved'
              ? person.state
                ? `${reason || '已实际到岗'} · 原请假已批准`
                : '请假已批准，实际到岗后仍可签到'
              : reason,
          currentRepair: current || null
        };
        return { ...result, group: fieldPersonGroup(result) };
      })
      .sort(compareFieldPeople);
    const items = list.items
      .filter((item) => canReadSummary(actor,item,context))
      .map((item) =>
        Object.fromEntries(
          [
            'id',
            'revision',
            'campus',
            'date',
            'timeSlot',
            'status',
            'reception',
            'source',
            'registrationFlow',
            'deviceType',
            'deviceModel',
            'faultType',
            'assignedToName'
          ].map((key) => [key, item[key]])
        )
      );
    // Count actual orders (including walk-ins), never configured capacity or carryovers.
    const todayBookings=items.filter(item=>item.date===data.businessDate && item.status!=='cancelled');
    const overview={
      notArrived:todayBookings.filter(item=>item.status==='booked' && !['queued','assigned'].includes(item.reception?.state) && !item.reception?.leftAt).length,
      total:todayBookings.length,
      queued:items.filter(item=>item.status==='booked' && ['queued','assigned'].includes(item.reception?.state)).length,
      repairing:items.filter(item=>item.status==='in_progress').length,
      available:staffPresence.filter(person=>person.canReceive).length
    };
    return { ...data, overview, appointments: items.sort((a,b)=>String(a.reception?.receivedAt||'9999').localeCompare(String(b.reception?.receivedAt||'9999')) || (a.reception?.ticket?.number || 0)-(b.reception?.ticket?.number || 0) || a.id.localeCompare(b.id)), staffPresence };
  }
  async function requireIntake(actor,item) {
    const context=await staff.contextFor(actor);
    if (!(actor.authorizedCampuses || []).includes(item.campus)) fail(403,'没有该校区的访问权限');
    if (item.date>dateKey()) fail(409,'请在预约当天进行设备核验');
    if (item.reception?.state!=='assigned' && allowed(context,'repair.receive',appointmentTarget(item))) {
      if (item.status!=='booked') fail(409,'只有尚未开始维修的工单可以接待');
      if ((await repository.serviceDay(dateKey(),campusId(item.campus)))?.paused) fail(409,'该校区今天暂停维修');
      return context;
    }
    if (item.reception?.state==='assigned' && item.reception.assignedMemberId!==context.actor.memberId) fail(403,'该工单已分派给其他人员');
    await requireEligible(actor,item.campus,item.id);
    return context;
  }
  async function dispatchCandidates(actor,id) {
    const item=await detail(actor,id);
    if (!item.canDispatch) fail(403,'没有该工单的分派权限');
    const data=await board(actor,{campusId:campusId(item.campus)});
    return {items:data.staffPresence.filter(person=>person.canReceive)};
  }
  async function assertTransfer(actor, item, targetAccount) {
    await staff.requirePermission(actor, 'repair.transfer', {
      campusId: campusId(item.campus),
      id: item.id,
      assignedMemberId: item.assignedMemberId,
      businessDate: item.date
    });
    if (item.status !== 'in_progress') fail(409, '只有维修中的工单可以转派');
    const target = await users.find(targetAccount);
    if (!target || target.status !== 'enabled' || target.memberStatus === 'inactive')
      fail(409, '接手人员已不可用');
    if (target.memberId === item.assignedMemberId) fail(409, '请选择其他接手人员');
    return requireEligible(target, item.campus);
  }
  async function receptionResult(actor, id) {
    try { return await detail(actor, id); }
    catch (error) {
      if (error.status !== 403) throw error;
      const item = await appointments.find(id);
      const context = await staff.contextFor(actor);
      if (!item || !(actor.authorizedCampuses || []).includes(item.campus) ||
          !allowed(context, 'repair.dispatch', {...appointmentTarget(item), businessDate: context.businessDate})) throw error;
      // A successful resolution can move the order outside today's detail scope.
      // Return scheduling facts only, including when its receipt is replayed.
      return {...Object.fromEntries(['id','revision','campus','date','timeSlot','status','source','registrationFlow']
        .map(key => [key,item[key]])), reception: item.reception ? {state:item.reception.state,leftAt:item.reception.leftAt} : null, canReadDetails: false, resolutionOnly: true};
    }
  }
  async function receipt(actor, action, payload, id) {
    const key = requestId(payload.requestId);
    if (!key) fail(400, '缺少有效操作编号，请重新打开工单');
    const hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(payload)))
      ),
      (b) => b.toString(16).padStart(2, '0')
    ).join('');
    const prior = await repository.receipt(actor.memberId, action, key);
    if (prior) {
      if (prior.payloadHash !== hash || prior.resourceRef.id !== id)
        fail(409, '操作编号已用于其他内容');
      // A receipt never bypasses the caller's present-day resource authorization.
      return { replay: await (['receptions.reschedule','receptions.cancel','receptions.leave'].includes(action) ? receptionResult(actor, id) : detail(actor, id)), payloadHash: hash };
    }
    return { payloadHash: hash };
  }
  return {
    projectList,
    listAccess,
    search,
    home,
    board,
    detail,
    correctionAssignees,
    transferCandidates,
    dispatchCandidates,
    eligibility,
    requireEligible,
    requireIntake,
    assertTransfer,
    receipt,
    receptionResult
  };
}
