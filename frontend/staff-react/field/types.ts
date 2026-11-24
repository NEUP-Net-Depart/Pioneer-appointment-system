import type { AppointmentSummaryDto, StoredRepairLink } from '../../../shared/appointment-types.ts';
import type { IdentityLabel, PermissionDecisions } from '../../../shared/staff-types.ts';

export type { AttendanceRecordDto as AttendanceRecord } from '../../../shared/staff-types.ts';
import type { AttendanceRecordDto } from '../../../shared/staff-types.ts';

export interface FieldNavigationProps {
  workspaceLinks?: { id: string; label: string; group?: string }[];
  onLogout: () => void;
  onNavigate: (view: string) => void;
}

export interface Appointment extends AppointmentSummaryDto {
  receivedAt?: string;
  receivedBy?: string;
  receivedByName?: string;
  photoDeferredBy?: string;
  canSupplement?: boolean;
  repairNumber?: string | null;
  parentAppointmentId?: string;
  linkKind?: StoredRepairLink;
  customerHistory?: {
    id: string;
    date: string;
    brand: string;
    deviceModel: string;
    faultType: string;
    outcome: string;
    repairNote: string;
  }[];
  repairHistory?: {
    items: {
      id: string;
      parentAppointmentId?: string;
      date: string;
      timeSlot: string;
      status: string;
      outcome?: string;
      repairNote?: string;
      assignedToName?: string;
    }[];
    events?: {
      action: string;
      occurredAt: string;
      actorName?: string;
      reason?: string;
      before?: unknown;
      after?: unknown;
    }[];
  } | null;
  canReceive?: boolean;
  canEdit?: boolean;
  businessDate?: string;
  frontPhotoId?: string;
  backPhotoId?: string;
  deviceType: string;
  brand: string;
  deviceModel: string;
  faultType: string;
  issue?: string;
  warranty?: string;
  assignedToName?: string;
  assignedMemberId?: string;
  assigneeIdentities?: IdentityLabel[];
  assigneeIdentitySnapshot?: {
    memberId: string;
    name: string;
    identities: { code: string; label: string }[];
  } | null;
  startedAt?: string;
  repairNote?: string;
  name?: string;
  studentId?: string;
  phone?: string;
  social?: string;
  email?: string;
  contactType?: string;
  contactValue?: string;
  liquidMetal?: string;
  college?: string;
  serial?: string;
  liquidDrop?: string;
  dellG15?: string;
  repairCode?: string;
  canStart?: boolean;
  canFinish?: boolean;
  canTransfer?: boolean;
  canCorrect?: boolean;
  original?: {
    brand?: string;
    deviceModel?: string;
    issue?: string;
    warranty?: string;
    liquidMetal?: string;
    dellG15?: string;
    note?: string;
    signature?: string;
    agreementAt?: string;
    agreementVersion?: string;
    college?: string;
    serial?: string;
    liquidDrop?: string;
  } | null;
  intake?: Verification;
}
export interface Verification {
  brand: string;
  model: string;
  warranty: string;
  liquidMetal: string;
  note: string;
}

export interface Home {
  rosterParticipant?: boolean;
  searchCapabilities?: {
    identity: boolean;
    identityScope: 'none' | 'own' | 'today' | 'authorized';
    contact: boolean;
    contactScope: 'none' | 'own' | 'today' | 'authorized';
  };
  directAttendance?: { allowed: boolean; reason: string };
  identities?: { code: string; label: string }[];
  permissions: PermissionDecisions;
  navigation: { id: string }[];
  businessDate: string;
  actor: { memberId: string; name: string };
  authVersion: number;
  campuses: { id: string; name: string }[];
  campusId: string;
  contexts: { id: string; label: string }[];
  capability: Record<string, boolean>;
  attendance: AttendanceRecordDto | null;
  repairs: Appointment[];
  pendingPhotos: Appointment[];
  pendingCoverInvitations?: number;
  event?: { id: string; revision: number; startsAt: string; endsAt: string };
  todayDuties: {
    id: string;
    campusName: string;
    startAt: string;
    endAt: string;
    dutyType: string;
    servicePaused?: boolean;
  }[];
  updatedAt: string;
  appointments?: Appointment[];
}
