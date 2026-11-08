import { readWorkspaceState, writeWorkspaceState } from '../workspace-state.js';
import type { AttendanceRecord, Home } from './types';

export function campusAttendance(home: Home) {
  const record = home.attendance;
  return record?.type === 'duty' &&
    record.businessDate === home.businessDate &&
    record.campusId === home.campusId
    ? record
    : null;
}

export function canSelfCheckIn(home: Home) {
  return !!home.capability['attendance.self'] && !campusAttendance(home);
}

const confirmationKey = (session: string, date: string, campus: string) =>
  `attendance:${session}:${date}:${campus}`;

export function rememberAttendance(session: string, record: AttendanceRecord) {
  if (record.type === 'duty')
    writeWorkspaceState(confirmationKey(session, record.businessDate, record.campusId), record);
}

export function confirmedAttendance(session: string, home: Home) {
  return readWorkspaceState(confirmationKey(session, home.businessDate, home.campusId)) as
    | AttendanceRecord
    | undefined;
}

export function reconcileAttendance(home: Home, confirmed?: AttendanceRecord): Home {
  if (!confirmed || (campusAttendance(home)?.revision ?? -1) >= confirmed.revision) return home;
  // A successful server response must survive older board/home requests and
  // scene caches. The confirmation is scoped to this login, day and campus.
  return { ...home, attendance: confirmed };
}
