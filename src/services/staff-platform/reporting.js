import { fail } from '../../lib/http.js';
import { addDays, dateKey, weekRange } from '../../platform/time.js';
import { rosterFactContext } from '../../modules/rosters/qualification.js';
import { staffIdentities } from '../../../shared/staff-identities.js';

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
    const members = new Map(data.members.map((member) => [member.memberId, member]));
    const pausedKeys = new Set(
      paused.filter((item) => item.paused).map((item) => `${item.businessDate}:${item.campusId}`)
    );
    const byWeek = new Map(weeks.map((week) => [week, new Map()]));
    const ensure = (week, campusId, memberId, record = null, department = null) => {
      const member = members.get(memberId);
      const key = `${campusId}:${memberId}`;
      const group = byWeek.get(week);
      if (!group.has(key))
        group.set(key, {
          memberId,
          campusId,
          campus: campusNames[campusId],
          name: record?.identitySnapshot?.name || member?.name || record?.memberName || '',
          studentId: record?.identitySnapshot?.studentId || member?.studentId || '',
          college: member?.college || '',
          major: member?.major || '',
          department: record?.primaryDepartmentNameSnapshot || department?.departmentName || '',
          dates: new Set(),
          leader: false
        });
      return group.get(key);
    };
    for (const record of data.records) {
      const week = weekRange(record.businessDate).start;
      if (
        !byWeek.has(week) ||
        record.businessDate > today ||
        record.businessDate > addDays(week, 3) ||
        pausedKeys.has(`${record.businessDate}:${record.campusId}`) ||
        !canExport(
          context,
          record.campusId,
          record.memberId,
          record.primaryDepartmentIdSnapshot,
          query.campusId
        )
      )
        continue;
      const row = ensure(week, record.campusId, record.memberId, record);
      row.dates.add(record.businessDate);
    }
    if (settings.mergeLeaders)
      for (const week of weeks) {
        const facts = await repository.rosterMemberFacts([...members.keys()], week);
        for (const fact of facts) {
          if (!fact.active) continue;
          const eligible = [];
          for (const campus of fact.campuses || []) {
            const campusId = { 南湖: 'campus-nanhu', 浑南: 'campus-hunnan' }[campus] || campus;
            if (!campusNames[campusId]) continue;
            for (let day = 0; day < 4; day++) {
              const date = addDays(week, day);
              if (date > today || pausedKeys.has(`${date}:${campusId}`)) continue;
              const identityContext = rosterFactContext(fact, date);
              const department = identityContext.memberships.find((item) => item.isPrimary);
              if (
                !staffIdentities(identityContext, platform.authorizer, {
                  campusId,
                  departmentId: department?.departmentId
                }).some((item) => ['repair_lead', 'office_lead'].includes(item.code))
              )
                continue;
              eligible.push({ campusId, department });
              break;
            }
          }
          if (!eligible.length) continue;
          const assignmentCampus = fact.assignments
            ?.filter(
              (item) =>
                item.businessDate >= week &&
                item.businessDate <= addDays(week, 3) &&
                !pausedKeys.has(`${item.businessDate}:${item.campusId}`)
            )
            .sort((a, b) => a.businessDate.localeCompare(b.businessDate))[0]?.campusId;
          const attendanceCampus = data.records.find(
            (item) =>
              item.memberId === fact.memberId &&
              weekRange(item.businessDate).start === week &&
              item.businessDate <= addDays(week, 3) &&
              !pausedKeys.has(`${item.businessDate}:${item.campusId}`)
          )?.campusId;
          const homeCampus = members.get(fact.memberId)?.homeCampusId;
          const chosen =
            eligible.find((item) => item.campusId === assignmentCampus) ||
            eligible.find((item) => item.campusId === attendanceCampus) ||
            eligible.find((item) => item.campusId === homeCampus) ||
            eligible.sort((a, b) => a.campusId.localeCompare(b.campusId))[0];
          for (const campusId of Object.keys(campusNames))
            byWeek.get(week).delete(`${campusId}:${fact.memberId}`);
          if (
            canExport(
              context,
              chosen.campusId,
              fact.memberId,
              chosen.department?.departmentId,
              query.campusId
            )
          )
            ensure(week, chosen.campusId, fact.memberId, null, chosen.department).leader = true;
        }
      }
    return {
      month,
      settings,
      weeks: weeks.map((weekStart, index) => ({
        weekStart,
        weekEnd: addDays(weekStart, 3),
        weekNumber: index + 1,
        campuses: Object.entries(campusNames)
          .filter(([id]) => !query.campusId || query.campusId === id)
          .filter(([id]) => evaluate(context, 'attendance.export', { campusId: id }).allowed)
          .map(([campusId, campus]) => ({
            campusId,
            campus,
            rows: [...byWeek.get(weekStart).values()]
              .filter((row) => row.campusId === campusId)
              .map((row) => ({
                ...row,
                dates: [...row.dates].sort(),
                count:
                  row.leader || settings.countMode === 'weekly'
                    ? Number(row.leader || row.dates.size > 0)
                    : row.dates.size,
                hours:
                  (row.leader || settings.countMode === 'weekly'
                    ? Number(row.leader || row.dates.size > 0)
                    : row.dates.size) * settings.hoursPerCount
              }))
              .sort(
                (a, b) =>
                  a.name.localeCompare(b.name, 'zh-CN') || a.studentId.localeCompare(b.studentId)
              )
          }))
      }))
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
  return { reportSettings, saveReportSettings, volunteerReport, attendanceMatrix };
}
