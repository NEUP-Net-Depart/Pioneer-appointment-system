import type { DutyShift, EffectivePeriod, MembershipContext, RoleGrant, StaffRole } from '../../../shared/staff-types.ts';

export interface PolicyActor {
  account?: string;
  memberId?: string | null;
  name?: string;
  role?: StaffRole;
  status?: string;
  memberStatus?: string;
  homeCampus?: string;
  authorizedCampuses?: readonly string[];
  authVersion?: number;
}

export interface PolicyResource {
  id?: string;
  memberId?: string | null;
  assignedMemberId?: string | null;
  campusId?: string | null;
  campusIds?: readonly string[];
  departmentId?: string | null;
  departmentIds?: readonly string[];
  businessDate?: string;
  dutyType?: string;
}

export interface EffectiveGrant extends Omit<RoleGrant, 'scope' | 'conditions' | 'validity'> {
  scope?: RoleGrant['scope'];
  conditions?: RoleGrant['conditions'];
  validity?: RoleGrant['validity'];
  grantId?: string;
  roleId?: string;
  roleCode?: string;
  binding?: EffectivePeriod;
  source?: string;
}

export interface PolicyContext extends MembershipContext {
  actor?: PolicyActor;
  date?: string;
  grants?: readonly EffectiveGrant[];
  todayDuties?: readonly DutyShift[];
  attendanceEligible?: boolean;
  meetingParticipant?: boolean;
  meetingOrganizer?: boolean;
}
