import type { DutyShift, Membership, StaffRole } from '../../../shared/staff-types.ts';

export interface AttendanceFact {
  memberId: string;
  name: string;
  studentId?: string | null;
  campuses?: readonly string[];
  memberships?: readonly Membership[];
  role?: StaffRole | null;
  active?: boolean;
  assignments?: readonly Pick<DutyShift, 'businessDate' | 'campusId'>[];
}

export interface ServicePause {
  campusId: string;
  businessDate: string;
  paused: boolean | number;
}

export function attendanceFactContext(fact: AttendanceFact, businessDate: string) {
  const active = (item: Membership) => (!item.effectiveFrom || item.effectiveFrom <= businessDate) && (!item.effectiveTo || businessDate < item.effectiveTo);
  return {businessDate,actor:{memberId:fact.memberId,role:fact.role ?? undefined,authorizedCampuses:fact.campuses || []},
    memberships:(fact.memberships || []).filter(active),
    todayDuties:[]};
}
