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
  startedAt?: string;
  repairNote?: string;
  outcome?: string;
  name?: string;
  studentId?: string;
  phone?: string;
  social?: string;
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
  memberId: string;
  name: string;
  account: string;
  department: string;
  state: string;
  canReceive: boolean;
  reason: string;
  scheduled: boolean;
  currentRepair?: { id: string; deviceModel: string };
}
export interface Home {
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
