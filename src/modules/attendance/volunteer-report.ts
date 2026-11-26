import type { AttendanceIdentitySnapshot, AttendanceReportSettings, Membership } from '../../../shared/staff-types.ts';
import type { AttendanceFact, ServicePause } from './fact-context.ts';

type ReportRecord = {
  memberId: string; campusId: string | null; businessDate: string; memberName: string;
  primaryDepartmentIdSnapshot: string | null; primaryDepartmentNameSnapshot: string | null;
  identitySnapshot: AttendanceIdentitySnapshot;
};
type ReportMember = {
  memberId: string; name: string; studentId: string | null;
  college: string | null; major: string | null; homeCampusId: string | null;
};
interface VolunteerReportInput {
  month: string;
  weeks: string[];
  settings: AttendanceReportSettings;
  today: string;
  data: { records: readonly ReportRecord[]; members: readonly ReportMember[] };
  facts: readonly AttendanceFact[];
  paused: readonly ServicePause[];
  canRead(campusId: string | null, memberId?: string, departmentId?: string | null, requestedCampusId?: string): boolean;
  query?: { campusId?: string };
}
interface VolunteerEntry {
  memberId: string; campusId: string | null; campus?: string;
  name: string; studentId: string; college: string; major: string; department: string;
  dates: Set<string>; leader: boolean; canManageProfile?: boolean;
}

import { addDays, weekRange } from '../../platform/time.ts';
import { volunteerCampus, volunteerLeaderOn } from './fact-context.ts';
import { dutyCampusNames as campusNames, dutyCampusName } from '../../../shared/duty.ts';

export function calculateVolunteerReport({
  month,
  weeks,
  settings,
  today,
  data,
  facts,
  paused,
  canRead,
  query = {}
}: VolunteerReportInput) {
  const members = new Map(data.members.map((member) => [member.memberId, member]));
  const pausedKeys = new Set(
    paused.filter((item) => item.paused).map((item) => `${item.businessDate}:${item.campusId}`)
  );
  const byWeek = new Map(weeks.map((week) => [week, new Map<string, VolunteerEntry>()]));
  const ensure = (week: string, campusId: string | null, memberId: string, record: ReportRecord | null = null, department?: Membership) => {
    const member = members.get(memberId);
    const key = `${campusId}:${memberId}`;
    const group = byWeek.get(week);
    if (!group) throw new Error('Missing volunteer report week');
    let row = group.get(key);
    if (!row) {
      row = {
        memberId,
        campusId,
        campus: dutyCampusName(campusId),
        name: record?.identitySnapshot?.name || member?.name || record?.memberName || '',
        studentId: record?.identitySnapshot?.studentId || member?.studentId || '',
        college: member?.college || '',
        major: member?.major || '',
        department: record?.primaryDepartmentNameSnapshot || department?.departmentName || '',
        dates: new Set(),
        leader: false
      };
      group.set(key, row);
    }
    return row;
  };
  for (const record of data.records) {
    const week = weekRange(record.businessDate).start;
    const campusId = volunteerCampus(members.get(record.memberId)?.homeCampusId, record.campusId);
    if (
      !byWeek.has(week) ||
      record.businessDate > today ||
      record.businessDate > addDays(week, 3) ||
      pausedKeys.has(`${record.businessDate}:${record.campusId}`) ||
      !canRead(campusId, record.memberId, record.primaryDepartmentIdSnapshot, query.campusId)
    )
      continue;
    const row = ensure(week, campusId, record.memberId, record);
    row.dates.add(record.businessDate);
  }
  if (settings.mergeLeaders)
    for (const week of weeks) {
      for (const fact of facts) {
        const campusId = volunteerCampus(members.get(fact.memberId)?.homeCampusId);
        if (!campusId) continue;
        for (let offset = 0; offset < 4; offset++) {
          const date = addDays(week, offset);
          if (date > today || pausedKeys.has(`${date}:${campusId}`)) continue;
          const department = volunteerLeaderOn(fact, date, campusId);
          if (!department || !canRead(campusId, fact.memberId, department.departmentId, query.campusId)) continue;
          ensure(week, campusId, fact.memberId, null, department).leader = true;
          break;
        }
      }
    }
  return {
    month,
    settings,
    weeks: weeks.map((weekStart: string, index: number) => ({
      weekStart,
      weekEnd: addDays(weekStart, 3),
      weekNumber: index + 1,
      campuses: Object.entries(campusNames)
        .filter(([id]) => !query.campusId || query.campusId === id)
        .filter(([id]) => canRead(id))
        .map(([campusId, campus]) => ({
          campusId,
          campus,
          rows: [...(byWeek.get(weekStart)?.values() ?? [])]
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
