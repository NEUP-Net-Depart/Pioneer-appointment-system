import type { appointmentTransitions, CAMPUSES, outcomeLabels, repairOutcomes, statusLabels, TIME_SLOTS } from './constants.ts';
import type { repairLinkKinds } from './repair-links.ts';

export type Campus = (typeof CAMPUSES)[number];
export type AppointmentTime = (typeof TIME_SLOTS)[number];
export type AppointmentStatus = keyof typeof statusLabels;
export type AppointmentTransition = (typeof appointmentTransitions)[keyof typeof appointmentTransitions][number];
export type RepairOutcome = (typeof repairOutcomes)[number];
export type StoredRepairOutcome = keyof typeof outcomeLabels;
export type RepairLinkKind = (typeof repairLinkKinds)[number];
export type StoredRepairLink = RepairLinkKind | 'historical';

export interface SlotSelection {
  campus: string;
  date: string;
  timeSlot: string;
}

export interface SlotAvailability {
  slots: Readonly<Record<string, number>>;
  slotCapacities: Readonly<Record<string, number>>;
  timeSlots?: readonly string[];
  location?: string;
  paused?: boolean;
}

export interface AppointmentCredential {
  id: string;
  accessToken: string;
}

export type AttachmentPurpose = 'general' | 'student_photo' | 'intake_front' | 'intake_back';

export interface AttachmentDto {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  purpose: AttachmentPurpose;
}

export interface AppointmentSummaryDto extends SlotSelection {
  id: string;
  revision: number;
  status: AppointmentStatus;
  outcome?: StoredRepairOutcome | null;
  servicePaused?: boolean;
}

export type SignaturePoint = [x: number, y: number];
export interface SignatureDocument {
  version: 2;
  width: number;
  height: number;
  strokes: SignaturePoint[][];
}

export interface BookingNoticeDto {
  id: string;
  revision: number;
  type?: 'notice' | 'suspension';
  title: string;
  content: string;
  important: boolean;
  displayMode?: string;
  businessDate?: string;
}

export interface SlotCapacityDto {
  campus: string;
  weekday: number;
  timeSlot: string;
  capacity: number;
  revision: number;
}

export interface AppointmentOverviewDto {
  start: string;
  end: string;
  dates: string[];
  campuses: string[];
  nextServiceDate: string | null;
  items: AppointmentOverviewSlot[];
  week: { start: string; end: string; dates: string[]; items: AppointmentOverviewSlot[] };
  updatedAt: string;
}

export interface AppointmentOverviewSlot extends SlotSelection {
  capacity: number;
  occupied: number;
  paused: boolean;
  remaining: number;
  booked: number;
  inProgress: number;
  ended: boolean;
}

export interface RepairVerification {
  brand: string;
  model: string;
  warranty: string;
  liquidMetal: string;
  note?: string;
}

export interface BookingSettingsDto {
  campus: string;
  releaseTime: string;
  revision: number;
}

export interface BookingNoticeManagementDto extends BookingNoticeDto {
  campus: string;
  enabled: boolean;
  startsAt: string;
  endsAt: string;
}

export interface ServiceDayChangeDto {
  businessDate: string;
  campusId: string;
  paused: boolean;
  reason: string;
  revision: number;
}
