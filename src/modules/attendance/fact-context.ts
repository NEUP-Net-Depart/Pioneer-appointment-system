import type { DutyShift, Membership, StaffRole } from '../../../shared/staff-types.ts';
import { isLeader } from '../../../shared/staff-organization.ts';
import { campusId as normalizeCampusId } from '../authorization/scopes.ts';
import { isDutyCampusId } from '../../../shared/duty.ts';

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

export function volunteerCampus(homeCampus: string | null | undefined, fallback: string | null = null) {
  return isDutyCampusId(homeCampus) ? homeCampus : fallback;
}

export function volunteerLeaderOn(fact: AttendanceFact, businessDate: string, campus: string) {
  if (fact.active === false || !fact.campuses?.some(value => normalizeCampusId(value) === campus)) return null;
  const context = attendanceFactContext(fact, businessDate);
  if (!isLeader(context)) return null;
  return context.memberships.find(post => post.isPrimary && post.enabled !== false) ?? null;
}
