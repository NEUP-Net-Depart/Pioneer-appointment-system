export interface Appointment {
  id: string;
  revision: number;
  campus: string;
  date: string;
  timeSlot: string;
  status: string;
  deviceType: string;
  brand: string;
  deviceModel: string;
  faultType: string;
  issue?: string;
  warranty?: string;
  assignedToName?: string;
  assignedMemberId?: string;
  assigneeIdentities?: {code:string;label:string}[];
  assigneeIdentitySnapshot?: {memberId:string;name:string;identities:{code:string;label:string}[]} | null;
  startedAt?: string;
  repairNote?: string;
  outcome?: string;
  name?: string;
  studentId?: string;
  phone?: string;
  social?: string;
  email?: string;
  contactType?: string;
  contactValue?: string;
  liquidMetal?: string;
  dellG15?: string;
  repairCode?: string;
  canStart?: boolean;
  canFinish?: boolean;
  canTransfer?: boolean;
  canReadDetails?: boolean;
  canCorrect?: boolean;
  canRecoverCredential?: boolean;
  original?: { note?: string; signature?: string; agreementAt?: string; agreementVersion?: string; college?: string; serial?: string; liquidDrop?: string } | null;
  intake?: Verification;
}
export interface Verification {
  brand: string;
  model: string;
  warranty: string;
  liquidMetal: string;
  note: string;
}
export interface Person {
  identities?: { code: string; label: string }[];
  signedInAt?: string;
  scheduledRepair?: boolean;
  group?: string;
  memberId: string;
  name: string;
  account: string;
  department: string;
  state: string;
  canReceive: boolean;
  reason: string;
  scheduled: boolean;
  leaveStatus?: string;
  currentRepair?: { id: string; deviceModel: string };
}
export interface Home {
  identities?: { code: string; label: string }[];
  permissions: Record<string, boolean>;
  navigation: { id: string }[];
  enabled: boolean;
  businessDate: string;
  actor: { memberId: string; name: string };
  authVersion: number;
  campuses: { id: string; name: string }[];
  campusId: string;
  contexts: { id: string; label: string }[];
  capability: Record<string, boolean>;
  state: string;
  reason: string;
  currentRepair: Appointment | null;
  pendingSwapInvitations?: number;
  presence?: { revision: number; campusId: string; state: string };
  event?: { id: string; revision: number; startsAt: string; endsAt: string };
  todayDuties: {
    id: string;
    campusName: string;
    startAt: string;
    endAt: string;
    dutyType: string;
  }[];
  updatedAt: string;
  appointments?: Appointment[];
  staffPresence?: Person[];
}
