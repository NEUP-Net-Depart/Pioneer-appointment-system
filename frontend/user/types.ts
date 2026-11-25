import type { AppointmentCredential, AppointmentSummaryDto, AttachmentDto, SlotSelection } from '../../shared/appointment-types.ts';

export type { SlotSelection } from '../../shared/appointment-types.ts';
export type { FieldErrors } from '../../shared/api-types.ts';
export type { BookingNoticeDto as Notice, SignatureDocument as Signature } from '../../shared/appointment-types.ts';
export type Credential = AppointmentCredential;
export type Attachment = AttachmentDto;

export type Step = 1 | 2 | 3;

export interface SlotSummary extends SlotSelection {
  location?: string;
  servicePaused?: boolean;
  locationChanged?: boolean;
  locationSnapshot?: string;
  source?: string;
}

export interface Appointment extends Credential, SlotSummary, AppointmentSummaryDto, Partial<BookingFields> {
  currentLocationRevision?: number;
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
export type BookingDraft = {
  fields: Partial<BookingFields & SlotSelection>;
  step: number;
  savedAt: number;
};
export type Attempt = { key: string; pending?: boolean };

export type Route = { kind: 'booking' | 'lookup' } | { kind: 'detail'; id: string };
