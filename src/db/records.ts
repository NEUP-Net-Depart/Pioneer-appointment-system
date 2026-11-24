import type { AppointmentStatus, AttachmentPurpose, StoredRepairLink, StoredRepairOutcome } from '../../shared/appointment-types.ts';
import type { AttendanceIdentitySnapshot, AttendanceMethod, AttendanceType, StaffAccountDto } from '../../shared/staff-types.ts';

export interface StaffAccountRow {
  account: string;
  member_id: string | null;
  member_status: StaffAccountDto['memberStatus'] | null;
  name: string;
  role: StaffAccountDto['role'];
  status: StaffAccountDto['status'];
  home_campus: string;
  campuses: string | null;
  protected: 0 | 1;
  created_at: string;
  workload?: number;
  auth_version: number | null;
  token_version: number;
  password_hash: string;
  revision: number;
  role_names?: string | null;
  identity_memberships?: string | null;
  special_identities?: string | null;
}

export interface AccountRecord extends StaffAccountDto {
  passwordHash: string;
  tokenVersion: number;
  revision: number;
}

export interface AppointmentRecord {
  id: string;
  revision: number;
  parentAppointmentId: string;
  linkKind: StoredRepairLink | '';
  linkedBy: string;
  linkedAt: string;
  receivedAt: string;
  receivedBy: string;
  photoDeferredBy: string;
  studentId: string;
  name: string;
  college: string;
  campus: string;
  phone: string;
  social: string;
  deviceType: string;
  brand: string;
  deviceModel: string;
  serial: string;
  warranty: string;
  faultType: string;
  issue: string;
  liquidDrop: string;
  date: string;
  timeSlot: string;
  note: string;
  status: AppointmentStatus;
  assignedTo: string;
  repairNote: string;
  createdAt: string;
  outcome: StoredRepairOutcome | null;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string;
  agreementAt: string;
  agreementVersion: string;
  signature: string;
  repairNumber: string | null;
  frontPhotoId: string | null;
  backPhotoId: string | null;
  source: 'booking' | 'onsite';
  registeredBy: string;
  registrationKey?: string;
  email: string;
  contactType: string;
  contactValue: string;
  liquidMetal: string | null;
  dellG15: string | null;
  locationSnapshot: string;
  locationRevision: number | null;
  servicePaused: boolean;
  assignedToName: string;
  receivedByName: string;
  assignedMemberId: string;
  contactIndexGeneration?: string;
}

export interface AttachmentRecord {
  id: string;
  appointmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  objectKey: string;
  createdAt: string;
  expiresAt: string;
  purpose: AttachmentPurpose;
  uploadedBy: string | null;
}

export interface AttendanceEventRecord {
  id: string;
  type: AttendanceType;
  policyCode: string;
  policyVersion: string;
  ruleSnapshot: { participantMemberIds?: string[]; timezone?: string };
  campusId: string | null;
  businessDate: string;
  startsAt: string;
  endsAt: string;
  sourceRef: { module?: string; type?: string; id?: string; participantMemberIds?: string[] };
  revision: number;
  createdAt: string;
}

export interface AttendanceRecord {
  id: string;
  memberId: string;
  eventId: string;
  dedupeKey: string;
  occurredAt: string;
  recordedAt: string;
  method: AttendanceMethod;
  sourceRef: AttendanceEventRecord['sourceRef'];
  businessDate: string;
  type: AttendanceType;
  campusId: string | null;
  primaryDepartmentIdSnapshot: string | null;
  primaryDepartmentNameSnapshot: string | null;
  identitySnapshot: AttendanceIdentitySnapshot;
  nonScheduled: boolean;
  revision: number;
  servicePaused?: boolean;
}

export interface AttendanceInsert {
  id: string;
  memberId: string;
  eventId: string;
  dedupeKey: string;
  occurredAt: string;
  recordedAt: string;
  departmentId?: string | null;
  departmentName?: string | null;
  sourceRef: AttendanceEventRecord['sourceRef'];
  identitySnapshot: AttendanceIdentitySnapshot;
  nonScheduled: boolean;
}

export interface SqlGuard {
  sql: string;
  args: unknown[];
}

export interface ResourceRef {
  module: string;
  type: string;
  id?: string;
}

export interface AuditRecordInput {
  id?: string;
  actorMemberId?: string | null;
  actorAccount?: string | null;
  authVersion?: number;
  action: string;
  actionVersion?: string;
  sourceRef?: ResourceRef;
  before?: unknown;
  after?: unknown;
  reason?: string;
  requestId?: string;
  requestTraceId?: string;
  occurredAt?: string;
  roleVersions?: readonly { id: string; revision: number; enabled: boolean | number }[];
  roleGuard?: SqlGuard & { value: unknown };
  targetAccountVersion?: { account: string; auth_version: number | null } | null;
}

export interface CommandRecord extends AuditRecordInput {
  actorMemberId: string;
  actorAccount: string;
  requestId: string;
  payloadHash: string;
  at: string;
  result: object;
}

export interface AppointmentDatabaseScope {
  campuses: readonly string[];
  summaryRules?: AppointmentAccessRule[];
  identityRules?: AppointmentAccessRule[];
}

export interface AppointmentAccessRule {
  campus: string;
  memberId?: string;
  date?: string;
  objectIds?: string[];
}

export interface AppointmentListQuery {
  q?: string;
  campus?: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  timeSlot?: string;
  sort?: string;
  direction?: string;
  sorts?: { key: string; direction: string }[];
  limit?: number;
  cursor?: string;
  deferCounts?: boolean;
  contactIds?: string[];
  liveDate?: string;
}

export interface ScheduleSlotRow {
  campus: string;
  date: string;
  time_slot: string;
  capacity: number;
}

export interface ServiceLocationRow {
  campus: string;
  date: string;
  location: string;
  revision: number;
}

export interface MemberRow {
  id: string;
  name: string;
  student_id: string | null;
  home_campus_id: string | null;
  college: string | null;
  major: string | null;
  status: 'active' | 'inactive';
  revision: number;
  created_at: string;
  updated_at: string;
  special_identities?: string | null;
}

export interface MemberAccountRow extends StaffAccountRow {
  mapped_member_id: string | null;
}

export interface EffectiveGrantRow {
  id: string;
  permission_code: string;
  role_id: string;
  role_code: string;
  scope_spec: string;
  scope_bindings: string;
  condition_spec: string;
  validity_spec: string;
  source: string;
  effective_from: string;
  effective_to: string | null;
}

export type AppointmentChanges = Partial<Omit<AppointmentRecord, 'registeredBy' | 'registrationKey' | 'photoDeferredBy'>> & {
  registeredBy?: string | null;
  registrationKey?: string | null;
  photoDeferredBy?: string | null;
};
