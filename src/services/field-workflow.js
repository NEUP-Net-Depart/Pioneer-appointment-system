import { fail } from '../lib/http.js';
import { dateKey } from '../platform/time.js';
import { campusId } from '../modules/authorization/scopes.js';
import { scanCode } from '../lib/scan-code.js';
import { readStoredContact, normalizedContact, contactSearchToken, contactSearchTokens } from '../lib/privacy.js';
import { presentAppointment } from './appointments.js';
import { appointmentAccessRules } from '../modules/authorization/appointment-access.js';
import { requestId, stableJson } from '../platform/contracts.js';
import { staffIdentities } from '../../shared/staff-identities.js';
import { APPOINTMENT_SEARCH_LIMIT, appointmentContactTerm } from '../../shared/appointment-search.js';

export function fieldWorkflow({ repository, appointments, staff, authorizer, encryptionKey, secret }) {
  const names = { 'campus-nanhu': '南湖', 'campus-hunnan': '浑南' };
  const allowed = (context, code, target = {}) => authorizer.evaluate(context.actor,code,target,context,context.grants).allowed;
  const appointmentTarget = item => ({ campusId:campusId(item.campus), id:item.id, assignedMemberId:item.assignedMemberId, businessDate:item.date });
  const canReadSummary = (actor,item,context) => (actor.authorizedCampuses || []).includes(item.campus) && allowed(context,'repair.summary.read',appointmentTarget(item));
  function searchCapabilities(context) {
    const identity = !!context.permissions['customer.identity.read'];
    return { identity, identityScope:identity ? 'authorized' : 'none', contact:true, contactScope:'authorized' };
  }
  async function requireEligible(actor,campus,permission='repair.start') {
    const context = await staff.contextFor(actor);
    if (!allowed(context,permission,{campusId:campusId(campus)})) fail(403,'没有该校区的操作权限');
    return {context};
  }
  async function project(actor,item,context,contacts=false) {
    if (!canReadSummary(actor,item,context)) return null;
    const visible = await presentAppointment(item,encryptionKey,{staff:true});
    // Registration evidence is available only through the scoped management detail.
    for (const key of ['note','signature','agreementAt','agreementVersion']) delete visible[key];
    // List/search never provide a bulk contact export. Only a detail read does.
    if (!contacts) for (const key of ['phone','social','email','contactType','contactValue']) delete visible[key];
    return {...visible,canReadDetails:true};
  }
  async function listAccess(actor) {
    const context = await staff.contextFor(actor);
    const summaryRules = appointmentAccessRules(authorizer,actor,'repair.summary.read',context);
    if (!summaryRules.length) fail(403,'没有工单查询权限');
    const identityRules = appointmentAccessRules(authorizer,actor,'customer.identity.read',context);
    return {context,summaryRules,identityRules,searchCapabilities:searchCapabilities(context)};
  }
  async function projectList(actor,items,providedContext) {
    const context = providedContext || await staff.contextFor(actor);
    return items.filter(item => canReadSummary(actor,item,context)).map(item => {
      const visible = { ...item };
      for (const key of ['phone','social','email','contactType','contactValue','note','signature','agreementAt','agreementVersion','registrationKey']) delete visible[key];
      return { ...visible, canReadDetails: true };
    });
  }
  async function contactMatches(actor, query, providedContext) {
    const sought = appointmentContactTerm(query.q);
    if (!sought) return [];
    const context = providedContext || (await staff.contextFor(actor));
    const contactRules = appointmentAccessRules(
      authorizer,
      actor,
      'customer.contact.read',
      context
    );
    if (!contactRules.length) return [];
    const scope = { campuses: actor.authorizedCampuses || [], summaryRules: contactRules };
    const filters = {
      campus: query.campus,
      date: query.date,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      timeSlot: query.timeSlot,
      liveDate: query.liveDate
    };
    const token = await contactSearchToken(sought, encryptionKey);
    const matches = new Map();
    for (const indexedToken of [token, null]) {
      let cursor;
      do {
        const page = await appointments.contactCandidates(filters, scope, cursor, indexedToken);
        const newTokens = [];
        for (const row of page.items) {
          if (!canReadSummary(actor, row, context) ||
            !allowed(context, 'customer.contact.read', appointmentTarget(row))) continue;
          if (indexedToken) {
            matches.set(row.id, row);
            continue;
          }
          const values = await Promise.all([row.phone, row.email, row.contactValue, row.social]
            .map((value) => readStoredContact(value, encryptionKey)));
          if (values.some((value) => normalizedContact(value) === sought)) matches.set(row.id, row);
          newTokens.push({ id: row.id, generation: row.contactIndexGeneration,
            tokens: await contactSearchTokens(values, encryptionKey) });
        }
        await appointments.indexContacts(newTokens);
        cursor = page.nextCursor;
      } while (cursor);
    }
    return [...matches.values()].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  }
  async function search(actor, query) {
    const {context,summaryRules,identityRules} = await listAccess(actor);
    const campus = query.campusId ? names[campusId(query.campusId)] : null;
    if (query.campusId && (!campus || !actor.authorizedCampuses?.includes(campus)))
      fail(403, '没有该校区的访问权限');
    const scope = { campuses: campus ? [campus] : actor.authorizedCampuses || [] };
    await appointments.expirePending(new Date().toISOString(), scope);
    if ((query.mode === undefined || query.mode === 'identity') && !/^\d+(?:-\d*)?$/.test(query.text)) {
      const contactIds=query.contact && query.mode!=='identity' ? (await contactMatches(actor,{q:query.text,campus},context)).map(row=>row.id) : [];
      const result=await appointments.list({q:query.text,campus,contactIds,limit:APPOINTMENT_SEARCH_LIMIT,
        sort:'date',direction:'desc'}, {...scope,summaryRules,identityRules});
      return {items:result.items.filter(row=>canReadSummary(actor,row,context)).map(row=>Object.fromEntries(
        ['id','campus','date','timeSlot','status','name','studentId','brand','deviceModel','receivedAt','assignedToName'].map(key=>[key,row[key]])
      )),hasMore:!!result.nextCursor};
    }
    const items = [];
    const seen = new Set();
    const add = (row) => {
      if (seen.has(row.id) || !canReadSummary(actor, row, context)) return false;
      seen.add(row.id);
      items.push(
        Object.fromEntries(
          ['id', 'campus', 'date', 'timeSlot', 'status'].map((key) => [
            key,
            row[key]
          ])
        )
      );
      return items.length > APPOINTMENT_SEARCH_LIMIT;
    };
    // Apply the same current authorization and field projection as details,
    // before counting or limiting candidates. Hidden matches cannot fill the list.
    if ((query.mode === undefined || query.mode === 'identity' || query.mode === 'studentId') && query.studentId) {
      const matches = await appointments.searchStudentId(query.studentId, {
        ...scope,
        summaryRules,
        identityRules
      });
      for (const row of matches)
        if (add(row))
          return { items: items.slice(0, APPOINTMENT_SEARCH_LIMIT), hasMore: true };
    }
    if ((query.mode === undefined || query.mode === 'contact') && query.contact) {
      const matches = await contactMatches(actor, { q: query.text, campus }, context);
      for (const row of matches)
        if (add(row))
          return { items: items.slice(0, APPOINTMENT_SEARCH_LIMIT), hasMore: true };
    }
    if ((query.mode === undefined || query.mode === 'identity' || query.mode === 'number') && /^\d+(?:-\d*)?$/.test(query.text)) {
      for (let offset = 0; ; offset += 100) {
        const batch = await appointments.searchNumbers(
          query.text,
          query.acrossDates ? null : dateKey(),
          scope,
          [[]],
          { full: true, limit: 100, offset }
        );
        for (const row of batch) {
          if (add(row))
            return { items: items.slice(0, APPOINTMENT_SEARCH_LIMIT), hasMore: true };
        }
        if (batch.length < 100) break;
      }
    }
    return { items, hasMore: false };
  }

  async function detail(actor,id) {
    const item = await appointments.find(id);
    if (!item) fail(404,'工单不存在');
    const context = await staff.contextFor(actor);
    const visible = await project(actor,item,context,true);
    if (!visible) fail(403,'没有该工单的访问权限');
    await repository.audit({actorMemberId:context.actor.memberId,actorAccount:actor.account,
      action:'customer.contact.read',sourceRef:{module:'repairs',type:'appointment',id},
      occurredAt:new Date().toISOString()});
    const own = item.assignedMemberId === context.actor.memberId;
    const canInspect = allowed(context,'repair.correct',appointmentTarget(item));
    const canCorrect = item.status==='completed' && ((own && allowed(context,'repair.finish.own',appointmentTarget(item))) || allowed(context,'repair.correct',appointmentTarget(item)));
    return {...visible,businessDate:dateKey(),serverNow:new Date().toISOString(),
      canStart:allowed(context,'repair.start',appointmentTarget(item)) && item.status==='booked' && (!!item.receivedAt || item.date===dateKey()),
      canReceive:allowed(context,'repair.receive',appointmentTarget(item)) && item.status==='booked' && !item.receivedAt && item.date===dateKey(),
      canTransfer:allowed(context,'repair.transfer',appointmentTarget(item)) && item.status==='in_progress' && !own,
      canFinish:item.status==='in_progress' && ((own && allowed(context,'repair.finish.own',appointmentTarget(item))) || canInspect),canCorrect,
      canRecoverCredential:allowed(context,'repair.correct',appointmentTarget(item)),
      canEdit:allowed(context,'repair.receive',appointmentTarget(item)),
      canSupplement:allowed(context,'repair.receive',appointmentTarget(item)) && item.photoDeferredBy===actor.account && (!item.frontPhotoId || !item.backPhotoId),
      ...(canInspect ? {
        repairHistory:await appointments.repairHistory(id,{staff:true,campuses:actor.authorizedCampuses}),
        original:{note:item.note,signature:item.signature,agreementAt:item.agreementAt,agreementVersion:item.agreementVersion,college:item.college,serial:item.serial,liquidDrop:item.liquidDrop,
          brand:item.brand,deviceModel:item.deviceModel,issue:item.issue,warranty:item.warranty,liquidMetal:item.liquidMetal,dellG15:item.dellG15}
      } : {}),
      customerHistory:(await appointments.customerHistory(item.studentId,actor.authorizedCampuses)).filter(row=>row.id!==id).map(row=>({id:row.id,date:row.date,brand:row.brand,deviceModel:row.deviceModel,faultType:row.faultType,outcome:row.outcome,repairNote:row.repairNote})),
      intake:await repository.latestIntake(id),
      repairCode:scanCode(item.id,secret)};
  }
  function campusScope(actor,query) {
    const campuses = (actor.authorizedCampuses || []).map(name => ({id:campusId(name),name}));
    const homeCampus = campusId(actor.homeCampus);
    const selected = query.campusId !== undefined ? campusId(query.campusId)
      : campuses.find(item=>item.id===homeCampus)?.id || campuses[0]?.id;
    if (!campuses.some(item=>item.id===selected)) fail(403,'没有该校区的访问权限');
    return {campuses,selected};
  }
  async function home(actor,query={},providedContext,providedRepairs) {
    const context = providedContext || await staff.contextFor(actor);
    const {campuses,selected} = campusScope(actor,query);
    const capability = Object.fromEntries(['repair.summary.read','repair.start','repair.transfer','repair.receive','onsite.create','attendance.self','attendance.session.manage','members.manage','roles.manage'].map(code=>[code,allowed(context,code,{campusId:selected,memberId:context.actor.memberId})]));
    const businessDate = dateKey();
    const [progress,pendingPhotos,directAttendance,event,pendingCoverInvitations,attendance] = await Promise.all([
      providedRepairs || appointments.inProgress(actor.account),
      appointments.pendingPhotos(actor.account,names[selected]),
      staff.directAttendanceAction(actor,selected,context),
      repository.dutyEvent(dateKey(),selected),
      context.permissions['roster.read'] ? repository.pendingCoverInvitations(context.actor.memberId) : Promise.resolve(0),
      repository.findAttendanceByDedupe(`duty:${context.actor.memberId}:${businessDate}`)
    ]);
    const repairs = progress.filter(item=>item.campus===names[selected]);
    return {businessDate:dateKey(),actor:context.actor,authVersion:context.authVersion,campuses,campusId:selected,
      contexts:capability['repair.summary.read'] ? [{id:'today',label:'今日工作'}] : [],capability,
      directAttendance,
      permissions:context.permissions,navigation:context.navigation,
      attendance:attendance?.campusId===selected ? attendance : null,
      repairs:await projectList(actor,repairs,context),pendingPhotos:await projectList(actor,pendingPhotos,context),
      todayDuties:context.todayDuties.filter(item=>item.campusId===selected),identities:staffIdentities(context,authorizer,{campusId:selected}),
      searchCapabilities:searchCapabilities(context),
      event,pendingCoverInvitations,
      updatedAt:new Date().toISOString()};
  }
  async function board(actor,query={}) {
    const context = await staff.contextFor(actor);
    const {selected} = campusScope(actor,query);
    const work = (async()=>{
      await appointments.expirePending(new Date().toISOString(),{campuses:[names[selected]]});
      return appointments.openFieldWork(names[selected],dateKey());
    })();
    const [data,items] = await Promise.all([
      home(actor,query,context,work.then(items=>items.filter(item=>item.status==='in_progress' && item.assignedMemberId===context.actor.memberId))),
      work
    ]);
    return {...data,appointments:await projectList(actor,items,context)};
  }
  async function requireIntake(actor,item) {
    const result = await requireEligible(actor,item.campus,'repair.receive');
    if (item.photoDeferredBy===actor.account) return result.context;
    if (item.status!=='booked' || item.receivedAt || item.date!==dateKey()) fail(409,'首次接收照片已记录；待传原图请由经办人补传');
    return result.context;
  }
  async function receipt(actor,action,payload,id) {
    const key=requestId(payload.requestId);
    if (!key) fail(400,'缺少有效操作编号');
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableJson(payload)))),b=>b.toString(16).padStart(2,'0')).join('');
    const prior=await repository.receipt(actor.memberId,action,key);
    if (prior) {
      if (prior.payloadHash!==hash || prior.resourceRef.id!==id) fail(409,'操作编号已用于其他内容');
      return {replay:await detail(actor,id),payloadHash:hash};
    }
    return {payloadHash:hash};
  }
  return {projectList,listAccess,contactMatches,search,home,board,detail,requireEligible,requireIntake,receipt};
}
