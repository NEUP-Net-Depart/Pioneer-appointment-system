type Department = { department?: string | null; departmentCode?: string | null };

export function attendanceStatus({ assignments, record, paused, now }: {
  assignments: readonly { businessDate: string; endAt: string }[];
  record?: object | null; paused?: boolean; now: string;
}): import('./attendance-types.ts').AttendanceStatus {
  if (paused) return 'paused';
  if (record) return 'arrived';
  const end = assignments.map(item => `${item.businessDate}T${item.endAt}:00+08:00`).sort().at(-1);
  return end && Date.parse(end) <= Date.parse(now) ? 'absent' : 'upcoming';
}

export function compareAttendanceDepartments(left: Department, right: Department) {
  const hardware = (person: Department) => person.departmentCode === 'hardware' || person.department === '硬件部';
  return Number(hardware(right)) - Number(hardware(left)) ||
    Number(!left.department) - Number(!right.department) ||
    (left.department || '').localeCompare(right.department || '', 'zh-CN');
}
