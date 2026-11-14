import { json, readBody, fail, securityHeaders } from '../lib/http.js';

function bodyWithRevision(body) { return body && typeof body === 'object' ? body : {}; }

export const staffPlatformRoutes = [
  ['GET', /^\/api\/attendance\/staffing$/, async context=>json(await context.services.staffPlatform.workStaffing(await context.role('technician'),context.query))],
  ['GET', /^\/api\/attendance\/day$/, async context=>json(await context.services.staffPlatform.attendanceDay(await context.role('technician'),context.query))],
  ['GET', /^\/api\/attendance\/workload$/, async context=>json(await context.services.staffPlatform.attendanceWorkload(await context.role('technician'),context.query))],
  ['POST', /^\/api\/attendance\/arrivals$/, async context=>{ await context.role('technician'); fail(410,'确认到场已停用，请由本人签到；漏签请填写原因后补记'); }],
  ['PUT', /^\/api\/attendance\/reviews$/, async context=>{ await context.role('technician'); fail(410,'人工考勤核查已停用，班次结束未签到自动记缺勤；漏签请补记'); }],
  ['GET', /^\/api\/me\/volunteer-summary$/, async context=>json(await context.services.staffPlatform.volunteerSummary(await context.role('technician')))],
  ['GET', /^\/api\/rosters\/campus-week$/, async context=>json(await context.services.staffPlatform.campusWeek(await context.role('technician'),context.query))],
  ['PUT', /^\/api\/rosters\/campus-week$/, async context=>{ await context.limit('write'); return json(await context.services.staffPlatform.publishCampusWeek(await context.role('technician'),await readBody(context.request))); }],
  ['POST', /^\/api\/rosters\/week\/suggestions$/, async context=>json(await context.services.staffPlatform.rosterSuggestions(await context.role('technician'),await readBody(context.request)))],
  ['GET', /^\/api\/attendance\/weekly-summary$/, async context=>json(await context.services.staffPlatform.attendanceExport(await context.role('technician'),context.query))],
  ['GET', /^\/api\/attendance\/report-settings$/, async context=>json(await context.services.staffPlatform.reportSettings(await context.role('technician')))],
  ['PUT', /^\/api\/attendance\/report-settings$/, async context=>json(await context.services.staffPlatform.saveReportSettings(await context.role('technician'),await readBody(context.request)))],
  ['GET', /^\/api\/attendance\/volunteer-report$/, async context=>json(await context.services.staffPlatform.volunteerReport(await context.role('technician'),context.query))],
  ['GET', /^\/api\/attendance\/matrix$/, async context=>json(await context.services.staffPlatform.attendanceMatrix(await context.role('technician'),context.query))],
  ['GET', /^\/api\/attendance\/options$/, async context=>json(await context.services.staffPlatform.attendanceOptions(await context.role('technician'),context.query))],
  ['GET', /^\/api\/field\/home$/, async context => json(await context.services.field.home(await context.role('technician'), context.query))],
  ['GET', /^\/api\/field\/board$/, async context => json(await context.services.field.board(await context.role('technician'), context.query))],
  ['GET', /^\/api\/field\/appointments\/([^/]+)$/, async (context, match) => json(await context.services.field.detail(await context.role('technician'), decodeURIComponent(match[1])))],
  ['GET', /^\/api\/members$/, async context => json(await context.services.staffPlatform.memberList(await context.role('technician'), context.query))],
  ['POST', /^\/api\/members$/, async context => { await context.limit('write'); return json(await context.services.staffPlatform.createMember(await context.role('technician'), await readBody(context.request)), 201); }],
  ['GET', /^\/api\/me\/profile$/, async context => json(await context.services.staffPlatform.ownProfile(await context.role('technician')))],
  ['PATCH', /^\/api\/me\/profile$/, async context => { await context.limit('write'); return json(await context.services.staffPlatform.ownProfile(await context.role('technician'), await readBody(context.request))); }],
  ['POST', /^\/api\/members\/education-import$/, async context => json(await context.services.staffPlatform.importEducation(await context.role('technician'), await readBody(context.request)))],
  ['GET', /^\/api\/organization\/(campuses|departments|locations)$/, async (context, match) => json(await context.services.staffPlatform.organization(await context.role('technician'), match[1], context.query))],
  ['GET', /^\/api\/members\/([^/]+)$/, async (context, match) => json(await context.services.staffPlatform.memberDetail(await context.role('technician'), decodeURIComponent(match[1]), context.query.businessDate))],
  ['GET', /^\/api\/members\/([^/]+)\/audit$/, async (context, match) => json(await context.services.staffPlatform.memberAudit(await context.role('technician'), decodeURIComponent(match[1])))],
  ['PATCH', /^\/api\/members\/([^/]+)$/, async (context, match) => json(await context.services.staffPlatform.updateMember(await context.role('technician'), decodeURIComponent(match[1]), bodyWithRevision(await readBody(context.request))))],
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

  ['POST', /^\/api\/attendance\/events$/, async context => json(await context.services.staffPlatform.createAttendanceEvent(await context.role('technician'), await readBody(context.request)), 201)],
  ['POST', /^\/api\/attendance\/events\/([^/]+)\/token$/, async (context, match) => json(await context.services.staffPlatform.issueAttendanceToken(await context.role('technician'), decodeURIComponent(match[1]), await readBody(context.request)))],
  ['POST', /^\/api\/attendance\/check-ins$/, async context => json(await context.services.staffPlatform.checkIn(await context.role('technician'), await readBody(context.request)))],
  ['POST', /^\/api\/attendance\/self-check-in$/, async context => json(await context.services.staffPlatform.directCheckIn(await context.role('technician'), await readBody(context.request)))],
  ['POST', /^\/api\/attendance\/preview$/, async context => json(await context.services.staffPlatform.previewAttendance(await context.role('technician'), await readBody(context.request)))],
  ['GET', /^\/api\/attendance$/, async context => json(await context.services.staffPlatform.attendanceList(await context.role('technician'), context.query))],
  ['GET', /^\/api\/attendance\/export\.csv$/, async context => {
    const result = await context.services.staffPlatform.attendanceExport(await context.role('technician'), context.query);
    return new Response(result.csv, { headers: { ...securityHeaders, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="attendance-' + (result.weekStart || result.month) + '.csv"' } });
  }],
  ['POST', /^\/api\/attendance\/corrections$/, async context => json(await context.services.staffPlatform.correctAttendance(await context.role('technician'), await readBody(context.request)), 201)],
  ['GET', /^\/api\/me\/attendance$/, async context => json(await context.services.staffPlatform.attendanceList(await context.role('technician'), { ...context.query, all:false,memberId: (await context.services.staffPlatform.contextFor(await context.role('technician'))).actor.memberId }))],

  ['GET', /^\/api\/rosters\/week$/, async context=>json(await context.services.staffPlatform.rosterWeek(await context.role('technician'),context.query))],
  ['PUT', /^\/api\/rosters\/week$/, async context=>json(await context.services.staffPlatform.saveRosterWeek(await context.role('technician'),await readBody(context.request)))],
  ['GET', /^\/api\/me\/roster$/, async context=>json(await context.services.staffPlatform.rosterMine(await context.role('technician'),context.query))],
  ['GET', /^\/api\/me\/availability$/, async context=>json(await context.services.staffPlatform.availability(await context.role('technician'),context.query))],
  ['PUT', /^\/api\/me\/availability$/, async context=>json(await context.services.staffPlatform.saveAvailability(await context.role('technician'),await readBody(context.request)))],
  ['POST', /^\/api\/rosters\/assignments\/([^/]+)\/leave$/, async(context,match)=>json(await context.services.staffPlatform.leave(await context.role('technician'),decodeURIComponent(match[1]),await readBody(context.request)))],
  ['POST', /^\/api\/rosters\/assignments\/([^/]+)\/leave-withdraw$/, async(context,match)=>json(await context.services.staffPlatform.withdrawLeave(await context.role('technician'),decodeURIComponent(match[1]),await readBody(context.request)))],
  ['GET', /^\/api\/rosters\/assignments\/([^/]+)\/cover-candidates$/, async(context,match)=>json(await context.services.staffPlatform.coverCandidates(await context.role('technician'),decodeURIComponent(match[1])))],
  ['POST', /^\/api\/rosters\/assignments\/([^/]+)\/cover$/, async(context,match)=>json(await context.services.staffPlatform.requestCover(await context.role('technician'),decodeURIComponent(match[1]),await readBody(context.request)))],
  ['GET', /^\/api\/rosters\/covers$/, async context=>json(await context.services.staffPlatform.covers(await context.role('technician')))],
  ['POST', /^\/api\/rosters\/covers\/([^/]+)\/response$/, async(context,match)=>json(await context.services.staffPlatform.respondCover(await context.role('technician'),decodeURIComponent(match[1]),await readBody(context.request)))],

  ['GET', /^\/api\/audit$/, async context => json(await context.services.staffPlatform.audit(await context.role('technician'), context.query))]
];
