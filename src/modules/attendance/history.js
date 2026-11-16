import { attendanceStatus, compareAttendanceDepartments } from '../../../shared/attendance-status.js';

export function attendanceHistory({ records, assignments, paused, now, departments = new Map() }) {
  const groups = new Map();
  const pauses = new Set(paused.filter(item => item.paused).map(item => `${item.campusId}:${item.businessDate}`));
  const ensure = (item) => {
    const key = `${item.campusId}:${item.memberId}`;
    if (!groups.has(key)) groups.set(key, {
      memberId: item.memberId, campusId: item.campusId,
      name: item.identitySnapshot?.name || item.memberName || '',
      studentId: item.identitySnapshot?.studentId || item.studentId || '',
      department: departments.get(item.memberId)?.departmentName || item.primaryDepartmentNameSnapshot || '',
      departmentCode: departments.get(item.memberId)?.departmentCode || '', entries: new Map()
    });
    const person = groups.get(key);
    if (!person.entries.has(item.businessDate)) person.entries.set(item.businessDate, { businessDate: item.businessDate, assignments: [], record: null });
    return person.entries.get(item.businessDate);
  };
  for (const record of records) ensure(record).record = record;
  for (const assignment of assignments) ensure(assignment).assignments.push(assignment);
  const rows = [...groups.values()].map(person => {
    const summary = { expected: 0, arrived: 0, leave: 0, absent: 0, support: 0, upcoming: 0 };
    const entries = [...person.entries.values()].map(entry => {
      const expected = entry.assignments.filter(item => item.leaveStatus !== 'recorded');
      const isPaused = pauses.has(`${person.campusId}:${entry.businessDate}`) || entry.record?.servicePaused;
      const status = attendanceStatus({ ...entry, paused: isPaused, now });
      if (!isPaused) {
        if (expected.length) summary.expected++;
        if (status === 'arrived' && !expected.length) summary.support++;
        if (Object.hasOwn(summary, status)) summary[status]++;
      }
      return { ...entry, assignments: entry.assignments.map(({ dutyType, startAt, endAt, leaveStatus }) => ({ dutyType, startAt, endAt, leaveStatus })), status, support: status === 'arrived' && !expected.length };
    }).sort((left, right) => right.businessDate.localeCompare(left.businessDate));
    return { ...person, entries, summary, days: entries.filter(entry => entry.status === 'arrived').map(entry => entry.businessDate).sort() };
  }).sort((left, right) => compareAttendanceDepartments(left, right) || left.name.localeCompare(right.name, 'zh-CN') || left.campusId.localeCompare(right.campusId));
  return { rows, dates: [...new Set(rows.flatMap(row => row.entries.map(entry => entry.businessDate)))].sort() };
}
