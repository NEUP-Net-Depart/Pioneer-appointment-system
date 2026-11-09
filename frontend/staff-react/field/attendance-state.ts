import type { QueryClient } from '@tanstack/react-query';
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

// Cancel older home/board reads before publishing the server-confirmed record.
export async function applyAttendance(client: QueryClient, record: AttendanceRecord) {
  const affectedQueries = {
    predicate: (query) =>
      [
        '/api/field/home',
        '/api/field/board',
        '/api/me/attendance',
        '/api/attendance/day',
        '/api/me/volunteer-summary',
        '/api/attendance/volunteer-report',
        '/api/attendance/matrix',
        '/api/attendance/weekly-summary'
      ].includes(query.queryKey[0])
  };
  await client.cancelQueries(affectedQueries);
  const matches = (query) => ['/api/field/home', '/api/field/board'].includes(query.queryKey[0]);
  client.setQueriesData<Home>({ predicate: matches }, (home) =>
    home &&
    record.type === 'duty' &&
    home.businessDate === record.businessDate &&
    home.campusId === record.campusId
      ? { ...home, attendance: record }
      : home
  );
  await client.invalidateQueries(affectedQueries);
}
