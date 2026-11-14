export function attendanceStatus({ assignments, record, paused, now }) {
  if (paused) return 'paused';
  if (record) return 'arrived';
  const expected = assignments.filter(item => item.leaveStatus !== 'recorded');
  if (assignments.length && !expected.length) return 'leave';
  const end = expected.map(item => `${item.businessDate}T${item.endAt}:00+08:00`).sort().at(-1);
  return end && Date.parse(end) <= Date.parse(now) ? 'absent' : 'upcoming';
}

export function compareAttendanceDepartments(left, right) {
  const hardware = person => person.departmentCode === 'hardware' || person.department === '硬件部';
  return Number(hardware(right)) - Number(hardware(left)) ||
    Number(!left.department) - Number(!right.department) ||
    (left.department || '').localeCompare(right.department || '', 'zh-CN');
}
