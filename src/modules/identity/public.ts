import type { MemberDto, Membership } from '../../../shared/staff-types.ts';
import type { MemberRow, StaffAccountRow } from '../../db/records.ts';
type MemberProjection<M extends Membership = Membership> = Omit<MemberDto, 'memberships'> & { memberships: M[]; specialIdentities: string[]; createdAt?: string; updatedAt?: string };
type MemberFields = Omit<MemberRow, 'created_at' | 'updated_at'> & Partial<Pick<MemberRow, 'created_at' | 'updated_at'>>;
export function memberPublic<M extends Membership>(row: MemberFields, options: { memberships: M[] }): MemberProjection<M>;
export function memberPublic(row: MemberFields, options?: { memberships?: Membership[] }): MemberProjection;
export function memberPublic(row: MemberFields | null | undefined, options?: { memberships?: Membership[] }): MemberProjection | null;
export function memberPublic(row: MemberFields | null | undefined, options: { memberships?: Membership[] } = {}): MemberProjection | null {
  if (!row) return null;
  const memberships = options.memberships || [];
  return {
    memberId: row.id,
    name: row.name,
    studentId: row.student_id || '',
    college: row.college || '',
    major: row.major || '',
    homeCampusId: row.home_campus_id || '',
    status: row.status,
    revision: row.revision,
    memberships,
    specialIdentities: JSON.parse(row.special_identities || '[]') as string[],
    retiredEffectiveTo: row.retired_effective_to ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function accountIdentity(row: Pick<StaffAccountRow, 'account' | 'member_id' | 'name'> | null) {
  return row ? { account: row.account, memberId: row.member_id || `member-${row.account}`, name: row.name } : null;
}

export function activeAt(from: string, to: string | null | undefined, date: string) {
  return from <= date && (!to || date < to);
}

export function periodsOverlap(from: string, to: string | null | undefined, otherFrom: string, otherTo: string | null | undefined) {
  return (!to || from < to) && (!otherTo || otherFrom < otherTo) &&
    (!to || otherFrom < to) && (!otherTo || from < otherTo);
}

export function businessIdentityEligible({ status, campuses }: { status: string; campuses: readonly string[] }) {
  return status==='active' && campuses.length>0;
}
