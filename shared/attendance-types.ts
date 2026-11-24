import type { AttendanceReportSettings, DutyType } from './staff-types.ts';

export type AttendanceStatus = 'arrived' | 'absent' | 'upcoming' | 'paused';

export interface AttendanceCheckinSource {
  kind?: 'correction' | 'direct' | 'qr';
  tokenId?: string;
  issuerMemberId?: string | null;
  issuerName?: string | null;
  operatorMemberId?: string;
  operatorAccount?: string;
  operatorName?: string;
  timeBasis?: 'duty_start';
}

export interface AttendanceMatrixRow {
  memberId: string;
  campusId: string | null;
  campus?: string;
  name: string;
  studentId: string;
  department: string;
  departmentCode: string;
  canManage: boolean;
  days: string[];
  summary: Record<'expected' | 'arrived' | 'absent' | 'support' | 'upcoming', number>;
  entries: {
    businessDate: string;
    assignments: { dutyType: DutyType; startAt: string; endAt: string }[];
    record: { occurredAt: string; recordedAt?: string; checkinSource?: AttendanceCheckinSource } | null;
    status: AttendanceStatus;
    support: boolean;
  }[];
}

export interface AttendanceMatrix {
  month: string;
  dates: string[];
  rows: AttendanceMatrixRow[];
}

export interface VolunteerReportRow {
  memberId: string;
  campusId: string | null;
  campus?: string;
  name: string;
  studentId: string;
  college: string;
  major: string;
  department: string;
  leader: boolean;
  dates: string[];
  count: number;
  hours: number;
  canManageProfile?: boolean;
}

export interface VolunteerReportWeek {
  weekStart: string;
  weekEnd: string;
  weekNumber: number;
  campuses: { campusId: string; campus: string; rows: VolunteerReportRow[] }[];
}

export interface VolunteerReport {
  month: string;
  settings: AttendanceReportSettings;
  weeks: VolunteerReportWeek[];
}

export interface WeeklyAttendanceRow {
  leaderCredit: boolean;
  leaderSeen: boolean;
  weekStart: string;
  memberId: string;
  name: string;
  studentId: string;
  departments: string;
  identities: string;
  campuses: string;
  actualCount: number;
  excludedCount: number;
  creditedCount: number;
  basis: string;
}
