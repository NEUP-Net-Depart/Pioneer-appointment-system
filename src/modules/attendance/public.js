import { dutyPolicy, meetingPolicy } from './policies.js';

export function policyRegistry() {
  return { duty: dutyPolicy(), meeting: meetingPolicy() };
}

export function policyFor(event) {
  return policyRegistry()[event.type] || null;
}

export function attendanceMethod(value) {
  return ['qr', 'nfc', 'manual'].includes(value) ? value : 'qr';
}
