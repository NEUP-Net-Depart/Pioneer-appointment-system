import type { AttendanceCheckinSource, AttendanceStatus } from '../../shared/attendance-types.ts';
import type { ReactNode, RefObject } from 'react';
import type { AppointmentSummaryDto, BookingNoticeDto } from '../../shared/appointment-types.ts';
import type {
  AttendanceReportSettings,
  AvailabilityPeriod,
  AvailabilityWindow,
  DutyShift,
  DutyType,
  MemberDto,
  RoleBindingDto,
  StaffAccountDto,
  StaffRole
} from '../../shared/staff-types.ts';

export type DirtyChange = (dirty: boolean) => void;

export interface EditorHandle {
  dirty: boolean;
  busy: boolean;
  save: () => unknown;
  discard: () => unknown;
}

export interface CampusEditorProps {
  campus: string;
  editorRef?: RefObject<EditorHandle | null>;
  onNavigate?: (view: string) => void;
}

export interface DutyFocus {
  id: string;
  campusId: string;
  memberId?: string;
  kind: string;
  businessDate?: string;
}

export interface CampusDutyProps {
  campusId: string;
  campusControl?: ReactNode;
  onDirtyChange: DirtyChange;
  onNavigate: (operation: () => void) => void;
}

export interface LocationDto {
  campus: string;
  date: string;
  location: string;
  revision: number;
}

export interface LocationHistoryDto {
  changes: {
    createdAt: string;
    beforeLocation: string;
    afterLocation: string;
    actor: string;
    revision: number;
  }[];
  affectedAppointments: (Pick<AppointmentSummaryDto, 'id'> & {
    name?: string;
    studentId?: string;
    phone?: string;
    social?: string;
    email?: string;
    contactValue?: string;
  })[];
}

export interface BookingSettingDto {
  campus: string;
  releaseTime: string;
  revision: number;
}

export interface ManagedNoticeDto {
  id: string;
  campus: string;
  title: string;
  content: string;
  revision: number;
  important: boolean;
  enabled: boolean;
  displayMode: string;
  startsAt: string;
  endsAt: string;
}

export interface ManagedBookingDto {
  settings: BookingSettingDto;
  notices: ManagedNoticeDto[];
  suspensions: BookingNoticeDto[];
}

export interface ServiceDayOverride {
  businessDate: string;
  campusId: string;
  paused: boolean | number;
  reason: string;
  revision: number;
}

export interface ServiceDayViewDto {
  serverNow: string;
  items: {
    businessDate: string;
    item: ServiceDayOverride | null;
    affected: Pick<AppointmentSummaryDto, 'id' | 'date' | 'timeSlot' | 'status'>[];
  }[];
}

export interface MemberDetailDto {
  member: MemberDto & { memberships: MemberMembership[] };
  account: Pick<
    StaffAccountDto,
    'account' | 'status' | 'protected' | 'role' | 'authorizedCampuses' | 'authVersion'
  > | null;
  bindings: RoleBindingDto[];
  actions?: {
    edit?: boolean;
    editableHomeCampuses?: string[];
    assignGlobalLeadership?: boolean;
    editSpecialIdentities?: boolean;
    readAudit?: boolean;
    editRoles?: boolean;
  };
  activation?: MemberActivationDto | null;
}

export type MemberMembership = NonNullable<MemberDto['memberships']>[number] & {
  id: string;
  departmentId: string;
  revision: number;
  effectiveFrom: string;
};
export interface MemberActivationDto {
  studentId: string;
  name: string;
  roleNames: string[];
  authorizedCampuses: string[];
  availableCampuses: string[];
  expectedRole: StaffRole;
  status: 'unset' | 'open' | 'revoked' | 'activated';
  stateToken: string;
  canConfigure: boolean;
}

export interface DutyAvailabilityDto {
  weekStart: string;
  usual: Pick<AvailabilityPeriod, 'revision' | 'windows' | 'updatedAt'>;
  exception: AvailabilityPeriod | null;
  effectiveWindows: AvailabilityWindow[];
  source: 'usual' | 'exception';
  participates: boolean;
  needsAvailability: boolean;
}

export interface DutyCoverDto {
  id: string;
  status: string;
  revision: number;
  note: string;
  fromName: string;
  toName: string;
  assignment: DutyShift;
  exchangeAssignment: DutyShift | null;
  canRespond: boolean;
  canCancel: boolean;
}

export interface StaffingDto {
  campusId: string;
  businessDate: string;
  items: {
    memberId: string;
    name: string;
    dutyType?: DutyType;
    workStatus?: string;
  }[];
}

export type PublishedDutyShift = DutyShift & { campusId: string; revision: number };

export interface VolunteerSummaryDto {
  month: string;
  asOf: string;
  monthHours: number;
  totalHours: number;
  settings: AttendanceReportSettings;
}

export interface AttendanceDayDto {
  campusId: string;
  businessDate: string;
  paused: boolean;
  canManage: boolean;
  summary: { expected: number; arrived: number; absent: number };
  items: AttendancePerson[];
  temporary: AttendancePerson[];
  people: (Pick<MemberDto, 'memberId' | 'name'> & { studentId: string | null })[];
}

export interface AttendancePerson {
  memberId: string;
  name: string;
  status: AttendanceStatus;
  assignments: PublishedDutyShift[];
  dutyStatuses?: Partial<Record<DutyType, AttendancePerson['status']>>;
  record?: {
    occurredAt: string;
    id?: string;
    eventId?: string;
    revision?: number;
    businessDate?: string;
    checkinSource?: AttendanceCheckinSource;
  } | null;
  workStatus?: 'idle' | 'repairing' | null;
  repairEligible?: boolean;
  department?: string;
  departmentCode?: string;
  maintenanceAffairs?: boolean;
  unavailable?: boolean;
  canCorrect?: boolean;
}

export interface AttendanceWorkloadDto {
  month: string;
  items: { memberId: string; monthly: number; total: number }[];
}
