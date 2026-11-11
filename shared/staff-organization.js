import { dateKey } from './time.js';

export const positionLabels = { member: '部员', deputy_head: '副部长', head: '部长', deputy_director: '副站长', director: '站长', vice_president: '副主席', president: '主席' };
export const additionalMembershipLabels = { exchange: '交流维修', maintenance_affairs: '维修事务' };
export function membershipLabel(post) {
  return additionalMembershipLabels[post.assignmentType] || `${post.departmentName || ''}${positionLabels[post.positionCode] || ''}`;
}
export function positionsFor(unit) {
  return unit?.kind === 'center' ? ['vice_president', 'president'] : unit?.kind === 'station' ? ['deputy_director', 'director'] : ['member', 'deputy_head', 'head'];
}
export function activeIdentity(item, context = {}) {
  const day = context.authorizationDate || context.businessDate || dateKey();
  const from = item.effectiveFrom || item.from || item.startDate || item.start;
  const to = item.effectiveTo || item.to || item.endDate || item.end;
  return item.active !== false && (!from || from.slice(0, 10) <= day) && (!to || day < to.slice(0, 10));
}
export const leadershipPositions=['deputy_head','head','deputy_director','director','vice_president','president'];
export const globalLeadershipPositions=['deputy_director','director','vice_president','president'];
export function activeMemberships(context={}) {
  return (context.memberships || []).filter(post=>post.enabled!==false && activeIdentity(post,context));
}
export function isLeader(context={}) {
  return activeMemberships(context).some(post=>post.isPrimary && leadershipPositions.includes(post.positionCode));
}
export function hasMaintenanceAffairs(context={}) {
  return activeMemberships(context).some(post=>post.assignmentType==='maintenance_affairs');
}
export function participationCodes(context={},target={}) {
  const normalize=value=>({'南湖':'campus-nanhu','浑南':'campus-hunnan'})[value] || value;
  if(target.campusId && !(context.actor?.authorizedCampuses || []).some(value=>normalize(value)===normalize(target.campusId)))return [];
  return [...new Set(activeMemberships(context).flatMap(post=>post.assignmentType==='maintenance_affairs'?['office']:post.assignmentType==='exchange'
    ? post.departmentCode==='hardware'?['exchange']:[]
    : post.isPrimary && post.departmentCode==='hardware'?['repair']
    : []))];
}
