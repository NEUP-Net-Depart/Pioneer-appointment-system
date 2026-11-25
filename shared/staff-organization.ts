import type { EffectivePeriod, Membership, MembershipContext, PositionCode } from './staff-types.ts';
import { dateKey } from './time.ts';

export const positionLabels = { member: '部员', deputy_head: '副部长', head: '部长', deputy_director: '副站长', director: '站长', vice_president: '副主席', president: '主席' };
export const additionalMembershipLabels = { exchange: '交流维修', maintenance_affairs: '维修事务' };
export function membershipLabel(post: Partial<Membership>) {
  return (post.assignmentType && post.assignmentType !== 'primary' && additionalMembershipLabels[post.assignmentType]) || `${post.departmentName || ''}${(post.positionCode && positionLabels[post.positionCode]) || ''}`;
}
export function positionsFor(unit?: { kind?: string } | null): PositionCode[] {
  return unit?.kind === 'center' ? ['vice_president', 'president'] : unit?.kind === 'station' ? ['deputy_director', 'director'] : ['member', 'deputy_head', 'head'];
}
export function activeIdentity(item: EffectivePeriod, context: Pick<MembershipContext, 'authorizationDate' | 'businessDate'> = {}) {
  const day = context.authorizationDate || context.businessDate || dateKey();
  const from = item.effectiveFrom || item.from || item.startDate || item.start;
  const to = item.effectiveTo || item.to || item.endDate || item.end;
  return item.active !== false && (!from || from.slice(0, 10) <= day) && (!to || day < to.slice(0, 10));
}
export const leadershipPositions: readonly PositionCode[] = ['deputy_head','head','deputy_director','director','vice_president','president'];
export const globalLeadershipPositions: readonly PositionCode[] = ['deputy_director','director','vice_president','president'];
export function activeMemberships<T extends Membership>(context: MembershipContext<T> = {}) {
  return (context.memberships || []).filter(post=>post.enabled!==false && activeIdentity(post,context));
}
export function isLeader(context: MembershipContext = {}) {
  return activeMemberships(context).some(post=>post.isPrimary && leadershipPositions.includes(post.positionCode));
}
export function hasMaintenanceAffairs(context: MembershipContext = {}) {
  return activeMemberships(context).some(post=>post.assignmentType==='maintenance_affairs');
}
export function participationCodes(context: MembershipContext = {}, target: { campusId?: string | null } = {}) {
  const normalize = (value: string) => value === '南湖' ? 'campus-nanhu' : value === '浑南' ? 'campus-hunnan' : value;
  const campus = target.campusId;
  if(campus && !(context.actor?.authorizedCampuses || []).some(value=>normalize(value)===normalize(campus)))return [];
  return [...new Set(activeMemberships(context).flatMap(post=>post.assignmentType==='maintenance_affairs'?['office']:post.assignmentType==='exchange'
    ? post.departmentCode==='hardware'?['exchange']:[]
    : post.isPrimary && post.departmentCode==='hardware'?['repair']
    : []))];
}
