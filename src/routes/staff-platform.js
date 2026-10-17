import { json, readBody, fail, securityHeaders } from '../lib/http.js';

function bodyWithRevision(body) { return body && typeof body === 'object' ? body : {}; }

export const staffPlatformRoutes = [
  ['GET', /^\/api\/attendance\/options$/, async context=>json(await context.services.staffPlatform.attendanceOptions(await context.role('technician'),context.query))],
  ['GET', /^\/api\/field\/home$/, async context => json(await context.services.field.home(await context.role('technician'), context.query))],
  ['GET', /^\/api\/field\/board$/, async context => json(await context.services.field.board(await context.role('technician'), context.query))],
  ['GET', /^\/api\/field\/appointments\/([^/]+)$/, async (context, match) => json(await context.services.field.detail(await context.role('technician'), decodeURIComponent(match[1])))],
  ['GET', /^\/api\/field\/appointments\/([^/]+)\/assignees$/, async (context, match) => json(await context.services.field.correctionAssignees(await context.role('technician'), decodeURIComponent(match[1]), context.query))],
  ['GET', /^\/api\/field\/appointments\/([^/]+)\/transfer-candidates$/, async (context, match) => json(await context.services.field.transferCandidates(await context.role('technician'), decodeURIComponent(match[1])))],
  ['GET', /^\/api\/members$/, async context => json(await context.services.staffPlatform.memberList(await context.role('technician'), context.query))],
  ['GET', /^\/api\/organization\/(campuses|departments|locations)$/, async (context, match) => json(await context.services.staffPlatform.organization(await context.role('technician'), match[1], context.query))],
  ['GET', /^\/api\/members\/([^/]+)$/, async (context, match) => json(await context.services.staffPlatform.memberDetail(await context.role('technician'), decodeURIComponent(match[1]), context.query.businessDate))],
  ['PATCH', /^\/api\/members\/([^/]+)$/, async (context, match) => json(await context.services.staffPlatform.updateMember(await context.role('technician'), decodeURIComponent(match[1]), bodyWithRevision(await readBody(context.request))))],
  ['POST', /^\/api\/members\/([^/]+)\/work-profiles$/, async (context, match) => json(await context.services.staffPlatform.saveWorkProfile(await context.role('technician'), decodeURIComponent(match[1]), await readBody(context.request)))],
  ['POST', /^\/api\/members\/import$/, async context => {
    const actor = await context.role('technician'); const input = await readBody(context.request);
    if (typeof input.csv !== 'string' || input.csv.length > 1024 * 1024) fail(400, '成员导入内容不正确');
    return json(await context.services.staffPlatform.importMembers(actor, input));
  }],
  ['GET', /^\/api\/members\/([^/]+)\/memberships$/, async (context, match) => {
    const actor = await context.role('technician');
    return json({ items: await context.services.staffPlatform.memberDetail(actor, decodeURIComponent(match[1]), context.query.businessDate).then(result => result.member.memberships) });
  }],
  ['POST', /^\/api\/members\/([^/]+)\/memberships$/, async (context, match) => json(await context.services.staffPlatform.addMembership(await context.role('technician'), decodeURIComponent(match[1]), await readBody(context.request)))],
  ['PATCH', /^\/api\/members\/([^/]+)\/memberships\/([^/]+)$/, async (context, match) => json(await context.services.staffPlatform.endMembership(await context.role('technician'), decodeURIComponent(match[1]), decodeURIComponent(match[2]), await readBody(context.request)))],
  ['PUT', /^\/api\/members\/([^/]+)\/roles$/, async (context, match) => json(await context.services.staffPlatform.bindMemberRoles(await context.role('technician'), decodeURIComponent(match[1]), await readBody(context.request)))],
  ['GET', /^\/api\/permissions$/, async context => json(await context.services.staffPlatform.permissions(await context.role('technician')))],
  ['GET', /^\/api\/roles$/, async context => json(await context.services.staffPlatform.roles(await context.role('technician')))],
  ['POST', /^\/api\/roles$/, async context => json(await context.services.staffPlatform.createRole(await context.role('technician'), await readBody(context.request)), 201)],
  ['POST', /^\/api\/roles\/preview$/, async context => json(await context.services.staffPlatform.previewRole(await context.role('technician'), await readBody(context.request)))],
  ['PATCH', /^\/api\/roles\/([^/]+)$/, async (context, match) => json(await context.services.staffPlatform.updateRole(await context.role('technician'), decodeURIComponent(match[1]), await readBody(context.request)))],
  ['GET', /^\/api\/modules$/, async context => { const actor = await context.role('technician'); const profile = await context.services.staffPlatform.contextFor(actor); return json({ items: profile.modules || [], navigation: profile.navigation || [] }); }],
  ['GET', /^\/api\/workbench$/, async context => json(await context.services.staffPlatform.workbench(await context.role('technician')))],
  ['GET', /^\/api\/desk\/summary$/, async context => json(await context.services.staffPlatform.deskSummary(await context.role('technician'), context.query))],

  ['POST', /^\/api\/attendance\/events$/, async context => json(await context.services.staffPlatform.createAttendanceEvent(await context.role('technician'), await readBody(context.request)), 201)],
  ['POST', /^\/api\/attendance\/events\/([^/]+)\/token$/, async (context, match) => json(await context.services.staffPlatform.issueAttendanceToken(await context.role('technician'), decodeURIComponent(match[1]), await readBody(context.request)))],
  ['POST', /^\/api\/attendance\/check-ins$/, async context => json(await context.services.staffPlatform.checkIn(await context.role('technician'), await readBody(context.request)))],
  ['POST', /^\/api\/attendance\/preview$/, async context => json(await context.services.staffPlatform.previewAttendance(await context.role('technician'), await readBody(context.request)))],
  ['GET', /^\/api\/attendance$/, async context => json(await context.services.staffPlatform.attendanceList(await context.role('technician'), context.query))],
  ['GET', /^\/api\/attendance\/export\.csv$/, async context => {
    const result = await context.services.staffPlatform.attendanceExport(await context.role('technician'), context.query);
    return new Response(result.csv, { headers: { ...securityHeaders, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="attendance-${result.month}.csv"` } });
  }],
  ['GET', /^\/api\/export\/attendance\.csv$/, async context => {
    const result = await context.services.staffPlatform.attendanceExport(await context.role('technician'), context.query);
    return new Response(result.csv, { headers: { ...securityHeaders, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="attendance-${result.month}.csv"` } });
  }],
  ['POST', /^\/api\/attendance\/corrections$/, async context => json(await context.services.staffPlatform.correctAttendance(await context.role('technician'), await readBody(context.request)), 201)],
  ['GET', /^\/api\/me\/attendance$/, async context => json(await context.services.staffPlatform.attendanceList(await context.role('technician'), { ...context.query, all:false,memberId: (await context.services.staffPlatform.contextFor(await context.role('technician'))).actor.memberId }))],
  ['PATCH', /^\/api\/presence\/me$/, async context => json(await context.services.staffPlatform.presence(await context.role('technician'), await readBody(context.request)))],

  ['GET', /^\/api\/roster-tasks$/, async context => json(await context.services.staffPlatform.rosterTasks(await context.role('technician'), context.query))],
  ['GET', /^\/api\/roster-tasks\/options$/, async context => json(await context.services.staffPlatform.rosterOptions(await context.role('technician'), context.query))],
  ['GET', /^\/api\/roster-tasks\/([^/]+)\/availability$/, async (context, match) => json(await context.services.staffPlatform.taskAvailability(await context.role('technician'), decodeURIComponent(match[1])))],
  ['POST', /^\/api\/roster-tasks$/, async context => json(await context.services.staffPlatform.createRosterTask(await context.role('technician'), await readBody(context.request)), 201)],
  ['GET', /^\/api\/roster-tasks\/([^/]+)\/requirements$/, async (context,match)=>json(await context.services.staffPlatform.rosterRequirements(await context.role('technician'),decodeURIComponent(match[1])))],
  ['PUT', /^\/api\/roster-tasks\/([^/]+)\/requirements$/, async (context,match)=>json(await context.services.staffPlatform.rosterRequirements(await context.role('technician'),decodeURIComponent(match[1]),await readBody(context.request)))],
  ['PUT', /^\/api\/roster-tasks\/([^/]+)\/availability$/, async (context, match) => json(await context.services.staffPlatform.saveAvailability(await context.role('technician'), decodeURIComponent(match[1]), await readBody(context.request)))],
  ['GET', /^\/api\/roster-tasks\/([^/]+)\/roster$/, async (context, match) => json(await context.services.staffPlatform.rosterTaskState(await context.role('technician'), decodeURIComponent(match[1])))],
  ['POST', /^\/api\/rosters\/generate$/, async context => json(await context.services.staffPlatform.generate(await context.role('technician'), await readBody(context.request)), 201)],
  ['PATCH', /^\/api\/rosters\/([^/]+)$/, async (context, match) => json(await context.services.staffPlatform.updateRoster(await context.role('technician'), decodeURIComponent(match[1]), await readBody(context.request)))],
  ['POST', /^\/api\/rosters\/([^/]+)\/publish$/, async (context, match) => json(await context.services.staffPlatform.publish(await context.role('technician'), decodeURIComponent(match[1]), await readBody(context.request)))],
  ['GET', /^\/api\/me\/roster$/, async context => json(await context.services.staffPlatform.rosterMine(await context.role('technician'), context.query))],
  ['GET', /^\/api\/swaps\/candidates$/, async context => json(await context.services.staffPlatform.swapCandidates(await context.role('technician'), context.query))],
  ['POST', /^\/api\/swaps\/preview$/, async context => json(await context.services.staffPlatform.swapPreview(await context.role('technician'), await readBody(context.request)))],
  ['GET', /^\/api\/swaps\/([^/]+)$/, async (context, match) => json(await context.services.staffPlatform.swapDetail(await context.role('technician'), decodeURIComponent(match[1])))],
  ['POST', /^\/api\/swaps$/, async context => json(await context.services.staffPlatform.swap(await context.role('technician'), await readBody(context.request)), 201)],
  ['GET', /^\/api\/swaps$/, async context => json(await context.services.staffPlatform.swaps(await context.role('technician'), context.query))],
  ['POST', /^\/api\/swaps\/([^/]+)\/decision$/, async (context, match) => json(await context.services.staffPlatform.swapDecision(await context.role('technician'), decodeURIComponent(match[1]), await readBody(context.request)))],
  ['POST', /^\/api\/leaves$/, async context => json(await context.services.staffPlatform.leave(await context.role('technician'), await readBody(context.request)), 201)],
  ['GET', /^\/api\/leaves$/, async context => json(await context.services.staffPlatform.leaves(await context.role('technician'), context.query))],
  ['GET', /^\/api\/leaves\/([^/]+)$/, async (context, match) => json(await context.services.staffPlatform.leaveDetail(await context.role('technician'), decodeURIComponent(match[1])))],
  ['POST', /^\/api\/leaves\/([^/]+)\/decision$/, async (context, match) => json(await context.services.staffPlatform.leaveDecision(await context.role('technician'), decodeURIComponent(match[1]), await readBody(context.request)))],
  ['POST', /^\/api\/leaves\/([^/]+)\/withdraw$/, async (context, match) => json(await context.services.staffPlatform.leaveWithdraw(await context.role('technician'), decodeURIComponent(match[1]), await readBody(context.request)))],
  ['GET', /^\/api\/audit$/, async context => json(await context.services.staffPlatform.audit(await context.role('technician'), context.query))]
];
