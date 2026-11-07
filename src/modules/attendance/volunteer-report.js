import { leadershipPositions } from '../../../shared/staff-organization.js';
import { addDays, weekRange } from '../../platform/time.js';
import { attendanceFactContext } from './fact-context.js';
import { staffIdentities } from '../../../shared/staff-identities.js';
import { dutyCampusNames as campusNames } from '../../../shared/duty.js';

export function calculateVolunteerReport({
  month,
  weeks,
  settings,
  today,
  data,
  facts,
  paused,
  canRead,
  query = {},
  authorizer
}) {
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
      !canRead(record.campusId, record.memberId, record.primaryDepartmentIdSnapshot, query.campusId)
    )
      continue;
    const row = ensure(week, record.campusId, record.memberId, record);
    row.dates.add(record.businessDate);
  }
  if (settings.mergeLeaders)
    for (const week of weeks) {
      for (const fact of facts) {
        if (!fact.active) continue;
        const eligible = [];
        for (const campus of fact.campuses || []) {
          const campusId = { 南湖: 'campus-nanhu', 浑南: 'campus-hunnan' }[campus] || campus;
          if (!campusNames[campusId]) continue;
          for (let day = 0; day < 4; day++) {
            const date = addDays(week, day);
            if (date > today || pausedKeys.has(`${date}:${campusId}`)) continue;
            const identityContext = attendanceFactContext(fact, date);
            const department = identityContext.memberships.find((item) => item.isPrimary);
            if (
              !canRead(campusId, fact.memberId, department?.departmentId, query.campusId) ||
              !staffIdentities(identityContext, authorizer, {
                campusId,
                departmentId: department?.departmentId
              }).some((item) => leadershipPositions.includes(item.code))
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
        .filter(([id]) => canRead(id))
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
