import { fail } from '../../lib/http.js';
import { addDays, dateKey, weekRange } from '../../platform/time.js';
import { calculateVolunteerReport } from '../../modules/attendance/volunteer-report.js';

const campusNames = { 'campus-nanhu': '南湖', 'campus-hunnan': '浑南' };

function monthScope(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) fail(400, '月份不正确');
  const year = Number(month.slice(0, 4));
  if (year < 2000 || year > 2100) fail(400, '月份不正确');
  const first = `${month}-01`;
  const next = new Date(`${first}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const last = new Date(next.getTime() - 86400000).toISOString().slice(0, 10);
  const weeks = [];
  for (let week = weekRange(first).start; week <= last; week = addDays(week, 7)) {
    if (week >= first) weeks.push(week);
  }
  return { first, last, weeks };
}

export function attendanceReportingDomain({ repository, platform, contextFor, evaluate }) {
  const canExport = (context, campusId, memberId, departmentId, requestedCampus) =>
    !!campusNames[campusId] &&
    (!requestedCampus || campusId === requestedCampus) &&
    evaluate(context, 'attendance.export', { campusId, memberId, departmentId }).allowed;

  async function reportSettings(actor) {
    const context = await contextFor(actor);
    if (!context.permissions['attendance.export'] && !context.permissions['settings.manage'])
      fail(403, '没有查看考勤规则的权限');
    return {
      ...(await repository.attendanceReportSettings()),
      canEdit: Object.keys(campusNames).every(
        (campusId) => evaluate(context, 'settings.manage', { campusId }).allowed
      )
    };
  }

  async function saveReportSettings(actor, input) {
    const context = await contextFor(actor);
    if (
      !Object.keys(campusNames).every(
        (campusId) => evaluate(context, 'settings.manage', { campusId }).allowed
      )
    )
      fail(403, '只有具备全部校区设置权限的管理员可以修改全局考勤规则');
    if (
      !['weekly', 'actual'].includes(input.countMode) ||
      typeof input.hoursPerCount !== 'number' ||
      !Number.isFinite(input.hoursPerCount) ||
      input.hoursPerCount <= 0 ||
      input.hoursPerCount > 24 ||
      typeof input.mergeLeaders !== 'boolean' ||
      !Number.isInteger(input.revision) ||
      input.revision < 0
    )
      fail(400, '考勤规则不正确');
    const saved = await repository.updateAttendanceReportSettings(input, {
      actorMemberId: context.actor.memberId,
      actorAccount: actor.account,
      authVersion: context.authVersion,
      action: 'attendance.report.settings.updated',
      before: await repository.attendanceReportSettings(),
      after: input,
      requestId: input.requestId
    });
    if (!saved) fail(409, '考勤规则已变化，请刷新后重试');
    return saved;
  }

  async function volunteerReport(actor, query) {
    const month = query.month;
    const { weeks } = monthScope(month);
    if (query.campusId && !campusNames[query.campusId]) fail(400, '校区不正确');
    const context = await contextFor(actor);
    if (!context.permissions['attendance.export']) fail(403, '没有导出考勤的权限');
    const settings = await repository.attendanceReportSettings();
    const today = dateKey();
    const start = weeks[0] || `${month}-01`;
    const end = weeks.length ? addDays(weeks.at(-1), 3) : start;
    const [data, paused] = await Promise.all([
      repository.weeklyAttendanceData(start, end),
      repository.serviceDays(start, end)
    ]);
    const facts = await repository.rosterMemberFacts(
      data.members.map((row) => row.memberId),
      start,
      end
    );
    return calculateVolunteerReport({
      month,
      weeks,
      settings,
      today,
      data,
      facts,
      paused,
      query,
      authorizer: platform.authorizer,
      canRead: (campusId, memberId, departmentId) =>
        canExport(context, campusId, memberId, departmentId, query.campusId)
    });
  }

  async function volunteerSummary(actor) {
    const context = await contextFor(actor),
      memberId = context.actor.memberId,
      today = dateKey();
    const settings = await repository.attendanceReportSettings();
    const first = (await repository.ownVolunteerStart(memberId)) || today;
    const start = weekRange(first).start,
      end = weekRange(today).end,
      weeks = [];
    for (let week = start; week <= today; week = addDays(week, 7)) weeks.push(week);
    const [data, facts, paused] = await Promise.all([
      repository.weeklyAttendanceData(start, end, memberId),
      repository.rosterMemberFacts([memberId], start, end),
      repository.serviceDays(start, end)
    ]);
    const result = calculateVolunteerReport({
      month: today.slice(0, 7),
      weeks,
      settings,
      today,
      data,
      facts,
      paused,
      authorizer: platform.authorizer,
      canRead: (campusId, id) =>
        Object.hasOwn(campusNames, campusId) &&
        (!id || id === memberId) &&
        evaluate(context, 'roster.read', { campusId, memberId }).allowed
    });
    const values = result.weeks.map((week) => ({
      weekStart: week.weekStart,
      hours: week.campuses.flatMap((campus) => campus.rows).reduce((sum, row) => sum + row.hours, 0)
    }));
    return {
      month: today.slice(0, 7),
      asOf: today,
      settings,
      monthHours: values
        .filter((row) => row.weekStart.startsWith(today.slice(0, 7)))
        .reduce((sum, row) => sum + row.hours, 0),
      totalHours: values.reduce((sum, row) => sum + row.hours, 0)
    };
  }

  async function attendanceMatrix(actor, query) {
    const month = query.month;
    const { first, last } = monthScope(month);
    if (query.campusId && !campusNames[query.campusId]) fail(400, '校区不正确');
    const context = await contextFor(actor);
    if (!context.permissions['attendance.export']) fail(403, '没有导出考勤的权限');
    const data = await repository.weeklyAttendanceData(first, last);
    const members = new Map(data.members.map((member) => [member.memberId, member]));
    const rows = new Map(),
      dates = new Set();
    for (const record of data.records) {
      if (
        record.servicePaused ||
        !canExport(
          context,
          record.campusId,
          record.memberId,
          record.primaryDepartmentIdSnapshot,
          query.campusId
        )
      )
        continue;
      const key = `${record.campusId}:${record.primaryDepartmentIdSnapshot || ''}:${record.memberId}`;
      if (!rows.has(key))
        rows.set(key, {
          campusId: record.campusId,
          campus: campusNames[record.campusId],
          department: record.primaryDepartmentNameSnapshot || '历史部门未记录',
          memberId: record.memberId,
          name:
            record.identitySnapshot?.name ||
            record.memberName ||
            members.get(record.memberId)?.name ||
            '',
          studentId: record.identitySnapshot?.studentId || record.studentId || '',
          days: new Set()
        });
      rows.get(key).days.add(record.businessDate);
      dates.add(record.businessDate);
    }
    return {
      month,
      dates: [...dates].sort(),
      rows: [...rows.values()]
        .map((row) => ({ ...row, days: [...row.days].sort() }))
        .sort(
          (a, b) =>
            a.campus.localeCompare(b.campus, 'zh-CN') ||
            a.department.localeCompare(b.department, 'zh-CN') ||
            a.name.localeCompare(b.name, 'zh-CN')
        )
    };
  }
  return {
    reportSettings,
    saveReportSettings,
    volunteerReport,
    volunteerSummary,
    attendanceMatrix
  };
}
