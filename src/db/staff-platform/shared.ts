import type {
  AssignmentType,
  DutyShift,
  DutyType,
  Membership,
  PositionCode
} from '../../../shared/staff-types.ts';

export interface MembershipRow {
  id: string;
  member_id: string;
  department_id: string;
  department_enabled?: number;
  department_name?: string;
  department_code?: string;
  organization_kind?: string;
  position_code: PositionCode;
  assignment_type: AssignmentType;
  is_primary: number;
  effective_from: string;
  effective_to: string | null;
  revision: number;
}

export interface DutyAssignmentRow {
  id: string;
  week_id: string;
  member_id: string;
  member_name?: string;
  business_date: string;
  campus_id: string;
  campus_name?: string;
  home_campus_id?: string;
  duty_type: DutyType;
  assignment_source?: 'auto' | 'manual' | null;
  start_at: string;
  end_at: string;
  revision: number;
  active: number;
  service_paused?: number;
}

export type StaffDutyAssignment = DutyShift & {
  weekId: string;
  campusId: string;
  revision: number;
  active: boolean;
};

import { specialIdentitiesSql } from '../staff-access.ts';

const memberColumns = `m.id,m.name,m.student_id,m.home_campus_id,m.college,m.major,m.status,m.revision,m.created_at,m.updated_at,${specialIdentitiesSql('m.id')} AS special_identities`;

function rows<T>(result?: { results: T[] } | null): T[] {
  return result?.results || [];
}

function json(value: unknown, fallback: unknown) {
  return JSON.stringify(value ?? fallback);
}

function membership(row: MembershipRow): Membership & {
  memberId: string;
  id: string;
  departmentId: string;
  organizationKind: string;
  effectiveFrom: string;
  revision: number;
} {
  return {
    id: row.id,
    memberId: row.member_id,
    departmentId: row.department_id,
    enabled: row.department_enabled !== 0,
    departmentName: row.department_name || '',
    departmentCode: row.department_code || '',
    organizationKind: row.organization_kind || 'department',
    positionCode: row.position_code,
    assignmentType: row.assignment_type,
    isPrimary: !!row.is_primary,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to || null,
    revision: row.revision
  };
}

function assignment(row: DutyAssignmentRow): StaffDutyAssignment {
  return {
    id: row.id,
    weekId: row.week_id,
    memberId: row.member_id,
    memberName: row.member_name || '',
    businessDate: row.business_date,
    campusId: row.campus_id,
    campusName: row.campus_name || '',
    homeCampusId: row.home_campus_id,
    dutyType: row.duty_type,
    source: row.assignment_source ?? null,
    startAt: row.start_at,
    endAt: row.end_at,
    revision: row.revision,
    active: !!row.active,
    servicePaused: !!row.service_paused
  };
}

export { memberColumns, rows, json, membership, assignment };
