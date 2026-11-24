export type Step = 1 | 2 | 3;

export interface SlotSelection {
  campus: string;
  date: string;
  timeSlot: string;
}

export interface SlotSummary extends SlotSelection {
  location?: string;
  servicePaused?: boolean;
  locationChanged?: boolean;
  locationSnapshot?: string;
  source?: string;
}

export interface Credential {
  id: string;
  accessToken: string;
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  purpose: string;
}

export interface Appointment extends Credential, SlotSummary, Partial<BookingFields> {
  status: string;
  revision: number;
  currentLocationRevision?: number;
  outcome?: string;
  repairNumber?: string;
  receivedAt?: string;
  completedAt?: string;
  startedAt?: string;
  expiresAt?: string;
  serverNow?: string;
  contactValue?: string;
  serial?: string;
  liquidDrop?: string;
  note?: string;
  phone?: string;
  social?: string;
  attachments?: Attachment[];
  repairHistory?: { items: Appointment[] };
}

export interface BookingFields {
  deviceType: string;
  brand: string;
  brandOther: string;
  deviceModel: string;
  dellG15?: string;
  liquidMetal?: string;
  warranty?: string;
  faultType?: string;
  issue: string;
  name: string;
  studentId: string;
  college: string;
  collegeOther: string;
  email: string;
  contactType?: string;
  qqAccount: string;
  wechatAccount: string;
}
export type FieldErrors = Record<string, string>;
export type BookingDraft = {
  fields: Partial<BookingFields & SlotSelection>;
  step: number;
  savedAt: number;
};
export type Attempt = { key: string; pending?: boolean };

export interface Notice {
  id: string;
  revision: number;
  type: string;
  title: string;
  content: string;
  important: boolean;
  displayMode: string;
  businessDate?: string;
}

export interface Signature {
  version: number;
  width: number;
  height: number;
  strokes: number[][][];
}

export type Route = { kind: 'booking' | 'lookup' } | { kind: 'detail'; id: string };
