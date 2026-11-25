import type { AttendanceMethod } from '../../../shared/staff-types.ts';
import { dutyPolicy, meetingPolicy } from './policies.ts';

export function policyRegistry() {
  return { duty: dutyPolicy(), meeting: meetingPolicy() };
}

export function policyFor(event: { type: string }) {
  return event.type === 'duty' || event.type === 'meeting' ? policyRegistry()[event.type] : null;
}

export function attendanceMethod(value: unknown): AttendanceMethod {
  return value === 'nfc' || value === 'manual' ? value : 'qr';
}
