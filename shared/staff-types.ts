import type { roleLevel } from './constants.ts';
import type { dutyCampusNames, dutyTypeLabels } from './duty.ts';
import type { additionalMembershipLabels, positionLabels } from './staff-organization.ts';

export type StaffRole = keyof typeof roleLevel;
export type CampusId = keyof typeof dutyCampusNames;
export type DutyType = keyof typeof dutyTypeLabels;
export type PositionCode = keyof typeof positionLabels;
export type AdditionalMembership = keyof typeof additionalMembershipLabels;
export type AssignmentType = 'primary' | AdditionalMembership;
export type PermissionDecisions = Readonly<Partial<Record<string, boolean>>>;

export interface IdentityLabel {
  code: string;
  label: string;
}

export interface EffectivePeriod {
  active?: boolean;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  from?: string | null;
  to?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  start?: string | null;
  end?: string | null;
}

export interface Membership extends EffectivePeriod {
  id?: string;
  departmentId?: string;
  departmentName?: string;
  departmentCode?: string;
  positionCode: PositionCode;
  assignmentType: AssignmentType;
  isPrimary: boolean;
  enabled?: boolean;
}

export interface MembershipContext<T extends Membership = Membership> {
  memberships?: readonly T[];
  businessDate?: string;
  authorizationDate?: string;
  specialIdentities?: readonly string[];
  actor?: { role?: StaffRole; authorizedCampuses?: readonly string[] };
}

export interface AvailabilityWindow {
  weekday: number;
  campusId: string;
  startAt: string;
  endAt: string;
}

export interface AvailabilityPeriod {
  weekStart: string;
  revision: number;
  windows: AvailabilityWindow[] | null;
  updatedAt?: string;
  dutyType?: DutyType;
}

export interface DutyCandidate {
  memberId: string;
  name: string;
  availability: Record<DutyType, AvailabilityWindow[]>;
  memberships: readonly Membership[];
}

export interface DutyAssignmentSummary {
  businessDate: string;
  dutyType: DutyType;
  memberId: string;
}

export type AttendanceType = 'duty' | 'meeting';
export type AttendanceMethod = 'qr' | 'nfc' | 'manual';

export interface AttendanceIdentitySnapshot {
  memberId?: string;
  name?: string;
  studentId?: string;
  identities?: IdentityLabel[];
}

export interface AttendanceReportSettings {
  countMode: 'weekly' | 'actual';
  hoursPerCount: number;
  mergeLeaders: boolean;
  revision: number;
}

export interface AttendanceRecordDto {
  id: string;
  type: AttendanceType;
  businessDate: string;
  campusId: string;
  occurredAt: string;
  revision: number;
  isExisting?: boolean;
  nonScheduled?: boolean;
  identitySnapshot?: AttendanceIdentitySnapshot;
}

export interface StaffAccountDto {
  account: string;
  memberId: string;
  name: string;
  role: StaffRole;
  status: 'enabled' | 'disabled';
  memberStatus?: 'active' | 'inactive';
  homeCampus: string;
  authorizedCampuses: string[];
  authVersion: number;
  protected?: boolean;
  createdAt?: string;
  workload?: number;
  identities?: IdentityLabel[];
  roleNames?: string[];
  canManage?: boolean;
}

export interface StaffProfileDto extends StaffAccountDto {
  permissions: PermissionDecisions;
  navigation: { id: string; label?: string }[];
  memberships?: Membership[];
  specialIdentities?: string[];
  actor?: { memberId: string; name: string };
}

export interface OrganizationUnitDto {
  id: string;
  name: string;
  code: string;
  kind: string;
  enabled: boolean;
}

export interface MemberDto {
  memberId: string;
  name: string;
  studentId: string;
  college: string;
  major: string;
  homeCampusId: string;
  status: 'active' | 'inactive';
  revision: number;
  identities?: IdentityLabel[];
  memberships?: Membership[];
  account?: string;
  accountStatus?: string;
  specialIdentities?: string[];
}

export interface GrantScope {
  all?: boolean;
  campuses?: 'bound' | string[];
  campusIds?: 'bound' | string[];
  departmentIds?: string[];
  departments?: string[];
  objectIds?: string[];
  self?: boolean;
}

export interface GrantCondition {
  code: string;
  version?: number;
  parameters?: {
    [key: string]: string | string[] | boolean | undefined;
    departmentId?: string;
    departmentIds?: string[];
    assignmentType?: string;
    isPrimary?: boolean;
    dutyType?: string;
    dutyTypes?: string[];
    window?: string;
    status?: string;
  };
}

export interface RoleGrant {
  id?: string;
  permissionCode: string;
  scope: GrantScope;
  conditions: GrantCondition[];
  validity: EffectivePeriod;
}

export interface RoleDto {
  id: string;
  code: string;
  name: string;
  description: string;
  level: number;
  enabled: boolean;
  revision: number;
  grants: RoleGrant[];
  actions?: { edit?: boolean; bind?: boolean };
}

export type ConditionParameterSchema =
  | { type: 'object'; properties: Record<string, ConditionParameterSchema>; additionalProperties: false }
  | { type: 'string'; minLength?: number }
  | { type: 'array'; items: ConditionParameterSchema; minItems?: number }
  | { type: 'boolean' };

export interface ConditionProviderDto {
  code: string;
  version: number;
  description: string;
  parameterSchema?: ConditionParameterSchema;
}

export interface PermissionDefinitionDto {
  code: string;
  name: string;
  module: string;
  description: string;
  scopeKinds: string[];
  conditionKinds: string[];
  sensitive: boolean;
  version: string;
}

export interface RoleBindingDto {
  id?: string;
  revision?: number;
  reason?: string;
  roleId: string;
  scope?: GrantScope;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  roleName?: string;
  editable?: boolean;
}

export interface DutyShift extends DutyAssignmentSummary {
  id: string;
  memberName: string;
  startAt: string;
  endAt: string;
  campusId?: string;
  campusName?: string;
  homeCampusId?: string;
  revision?: number;
  weekId?: string;
  source?: 'auto' | 'manual' | null;
  servicePaused?: boolean;
  canRequestCover?: boolean;
  suggested?: boolean;
}

export interface DutyPlannerPersonDto extends DutyCandidate {
  studentId?: string;
  homeCampusId: string;
  campuses: string[];
  assignments?: DutyShift[];
  otherShifts?: DutyShift[];
  availabilitySource?: string;
  identities?: IdentityLabel[];
}

export interface CampusRosterDto {
  weekStart: string;
  campusId: string;
  rosters: {
    dutyType: DutyType;
    revision: number;
    assignments: DutyShift[];
    publishedAt?: string | null;
  }[];
  paused: string[];
  people: DutyPlannerPersonDto[];
  sourceVersion: string;
}
