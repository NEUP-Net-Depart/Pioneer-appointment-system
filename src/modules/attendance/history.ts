import type { AttendanceIdentitySnapshot, DutyShift } from '../../../shared/staff-types.ts';
import type { ServicePause } from './fact-context.ts';

interface HistoryFact {
  memberId: string;
  campusId: string | null;
  businessDate: string;
  memberName?: string;
  studentId?: string | null;
  identitySnapshot?: AttendanceIdentitySnapshot;
  primaryDepartmentNameSnapshot?: string | null;
}
type HistoryRecord = HistoryFact & { servicePaused?: boolean };
type HistoryAssignment = HistoryFact & Pick<DutyShift, 'dutyType' | 'startAt' | 'endAt'>;
interface HistoryInput<R extends HistoryRecord, A extends HistoryAssignment> {
  records: readonly R[];
  assignments: readonly A[];
  paused: readonly ServicePause[];
  now: string;
  departments?: ReadonlyMap<string, { departmentName?: string; departmentCode?: string }>;
}

import { attendanceStatus, compareAttendanceDepartments } from '../../../shared/attendance-status.ts';

export function attendanceHistory<R extends HistoryRecord, A extends HistoryAssignment>({ records, assignments, paused, now, departments = new Map() }: HistoryInput<R, A>) {
  type Entry = { businessDate: string; assignments: A[]; record: R | null };
  const groups = new Map<string, {
    memberId: string; campusId: string | null; name: string; studentId: string;
    department: string; departmentCode: string; entries: Map<string, Entry>;
  }>();
  const pauses = new Set(paused.filter(item => item.paused).map(item => `${item.campusId}:${item.businessDate}`));
  const ensure = (item: HistoryFact) => {
    const key = `${item.campusId}:${item.memberId}`;
    let person = groups.get(key);
    if (!person) {
      person = {
      memberId: item.memberId, campusId: item.campusId,
      name: item.identitySnapshot?.name || item.memberName || '',
      studentId: item.identitySnapshot?.studentId || item.studentId || '',
      department: departments.get(item.memberId)?.departmentName || item.primaryDepartmentNameSnapshot || '',
      departmentCode: departments.get(item.memberId)?.departmentCode || '', entries: new Map()
      };
      groups.set(key, person);
    }
    let entry = person.entries.get(item.businessDate);
    if (!entry) {
      entry = { businessDate: item.businessDate, assignments: [], record: null };
      person.entries.set(item.businessDate, entry);
    }
    return entry;
  };
  for (const record of records) ensure(record).record = record;
  for (const assignment of assignments) ensure(assignment).assignments.push(assignment);
  const rows = [...groups.values()].map(person => {
    const summary = { expected: 0, arrived: 0, absent: 0, support: 0, upcoming: 0 };
    const entries = [...person.entries.values()].map(entry => {
      const expected = entry.assignments;
      const isPaused = pauses.has(`${person.campusId}:${entry.businessDate}`) || entry.record?.servicePaused;
      const status = attendanceStatus({ ...entry, paused: isPaused, now });
      if (!isPaused) {
        if (expected.length) summary.expected++;
        if (status === 'arrived' && !expected.length) summary.support++;
        if (status !== 'paused') summary[status]++;
      }
      return { ...entry, assignments: entry.assignments.map(({ dutyType, startAt, endAt }) => ({ dutyType, startAt, endAt })), status, support: status === 'arrived' && !expected.length };
    }).sort((left, right) => right.businessDate.localeCompare(left.businessDate));
    return { ...person, entries, summary, days: entries.filter(entry => entry.status === 'arrived').map(entry => entry.businessDate).sort() };
  }).sort((left, right) => compareAttendanceDepartments(left, right) || left.name.localeCompare(right.name, 'zh-CN') || (left.campusId ?? '').localeCompare(right.campusId ?? ''));
  return { rows, dates: [...new Set(rows.flatMap(row => row.entries.map(entry => entry.businessDate)))].sort() };
}
