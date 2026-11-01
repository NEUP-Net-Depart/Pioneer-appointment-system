import { dateKey } from './time.js';

export const positionLabels = { unknown: '待核对', member: '部员', deputy_head: '副部长', head: '部长', deputy_director: '副站长', director: '站长', president: '主席' };
export function positionsFor(unit) {
  return unit?.kind === 'center' ? ['president'] : unit?.kind === 'station' ? ['deputy_director', 'director'] : ['member', 'deputy_head', 'head'];
}
// Used when previewing proposed organization facts before they are persisted.
// Persisted identities are read from effective_member_roles.
export function organizationRoles(post, unit) {
  if (post.needsReview || !unit?.enabled) return [];
  if (post.assignmentType === 'exchange') return unit.code === 'hardware' ? ['exchange'] : [];
  if (!post.isPrimary) return [];
  if (unit.code === 'hardware' && ['member', 'deputy_head', 'head'].includes(post.positionCode))
    return post.positionCode === 'member' ? ['technician'] : ['technician', 'repair_lead'];
  if (unit.code === 'device_station' && ['deputy_director', 'director'].includes(post.positionCode) || unit.code === 'center' && post.positionCode === 'president') return ['repair_lead'];
  return [];
}
export function activeIdentity(item, context = {}) {
  const day = context.authorizationDate || context.businessDate || dateKey();
  const from = item.effectiveFrom || item.from || item.startDate || item.start;
  const to = item.effectiveTo || item.to || item.endDate || item.end;
  return item.active !== false && (!from || from.slice(0, 10) <= day) && (!to || day < to.slice(0, 10));
}
const roleParticipation = { technician: 'repair', exchange: 'exchange', office: 'office' };
// Participation travels with one complete grant. A qualification in a different
// campus/binding cannot satisfy the conditions of this grant.
export function grantParticipation(grant, context = {}) {
  if (!activeIdentity(grant.binding || {}, context) || !activeIdentity(grant.validity || {}, context)) return [];
  if (Array.isArray(grant.participation)) return [...new Set(grant.participation.filter(item => activeIdentity(item, context)).map(item => item.code))];
  return roleParticipation[grant.roleCode] ? [roleParticipation[grant.roleCode]] : [];
}
export function participationCodes(context = {}, target = {}) {
  const campuses = context.actor?.authorizedCampuses || [];
  const normalize = value => ({ '南湖': 'campus-nanhu', '浑南': 'campus-hunnan' })[value] || value;
  const requested = target.campusId ? [target.campusId] : target.campusIds || campuses;
  const authorized = requested.filter(id => campuses.some(value => normalize(value) === normalize(id)));
  if (!authorized.length) return [];
  return [...new Set((context.grants || []).flatMap(grant => {
    const scope = grant.scope || {};
    const bound = scope.campusIds ?? scope.campuses;
    if (Array.isArray(bound) && !authorized.some(id => bound.map(normalize).includes(normalize(id)))) return [];
    const departments = scope.departmentIds || scope.departments;
    if (departments && !departments.some(id => [target.departmentId, ...(target.departmentIds || [])].includes(id))) return [];
    if (scope.self && (target.memberId || target.assignedMemberId || context.actor?.memberId) !== context.actor?.memberId) return [];
    if (scope.objectIds && !scope.objectIds.includes(target.id)) return [];
    return grantParticipation(grant, context);
  }))];
}
