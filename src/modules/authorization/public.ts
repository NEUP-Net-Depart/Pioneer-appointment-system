import type { EffectivePeriod, GrantScope } from '../../../shared/staff-types.ts';
import type { EffectiveGrant, PolicyActor, PolicyContext, PolicyResource } from './types.ts';
import { isObject } from '../../../shared/api-types.ts';

interface GrantRow {
  id: string; permission_code: string; scope_spec: string; condition_spec: string;
  validity_spec: string; role_id: string; role_code: string;
}
export type Authorizer = ReturnType<typeof createAuthorizer>;

import { activeMemberships, globalLeadershipPositions, isLeader, participationCodes } from '../../../shared/staff-organization.ts';
import { campusId, validScope } from './scopes.ts';
import { dateKey, validDate } from '../../platform/time.ts';
import { conditionProviders, validCondition } from './conditions.ts';
import { parseJson } from '../../platform/contracts.ts';
import { isRetiredElder } from '../../../shared/staff-identities.ts';

export const staffRepairPermissions = ['repair.summary.read','repair.start','repair.receive','repair.finish.own','repair.transfer','customer.identity.read','customer.contact.read','onsite.create'];
const repairOperations = ['repair.start','repair.finish.own','repair.transfer'];
const receptionOperations = ['repair.receive','onsite.create'];

export const managementPermissions=['members.manage','accounts.manage','booking.manage','repair.correct','statistics.read','roster.manage','attendance.session.manage','attendance.correct','attendance.export'];
export const identityPermissions=[...staffRepairPermissions,...managementPermissions,'roster.read','attendance.self','attendance.token.issue'];

function values(value?: string | readonly string[] | null): readonly string[];
function values(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

export function validGrantValidity(validity: unknown): validity is EffectivePeriod | undefined {
  if (validity === undefined) return true;
  if (!isObject(validity)) return false;
  for (const key of ['effectiveFrom', 'from', 'startDate', 'start', 'effectiveTo', 'to', 'endDate', 'end']) {
    const value = validity[key];
    if (value !== undefined && value !== null && (typeof value !== 'string' || !validDate(value.slice(0, 10)))) return false;
  }
  const period = validity as EffectivePeriod;
  const from = period.effectiveFrom || period.from || period.startDate || period.start;
  const to = period.effectiveTo || period.to || period.endDate || period.end;
  return !(from && to && to.slice(0, 10) <= from.slice(0, 10));
}

function validityMatches(validity: EffectivePeriod | undefined, context: PolicyContext = {}) {
  if (!validGrantValidity(validity)) return false;
  if (validity === undefined) return true;
  const businessDate = context.authorizationDate || context.businessDate || context.date || dateKey();
  const period = validity as EffectivePeriod;
  const from = period.effectiveFrom || period.from || period.startDate || period.start;
  const to = period.effectiveTo || period.to || period.endDate || period.end;
  if ((from && !validDate(String(from).slice(0, 10))) || (to && !validDate(String(to).slice(0, 10)))) return false;
  if (from && businessDate < String(from).slice(0, 10)) return false;
  if (to && businessDate >= String(to).slice(0, 10)) return false;
  return true;
}

function scopeMatches(scope: GrantScope, target: PolicyResource = {}, actor: PolicyActor = {}) {
  if (!validScope(scope)) return false;
  const requestedCampuses = values(target.campusId || target.campusIds);
  if (requestedCampuses.some(id => !(actor.authorizedCampuses || []).some(value => campusId(value) === campusId(id)))) return false;
  const rawCampuses = scope.campusIds ?? scope.campuses;
  const campusValues = rawCampuses === 'bound' ? actor.authorizedCampuses || [] : values(rawCampuses);
  if (rawCampuses !== undefined) {
    const targets = values(target.campusId || target.campusIds || actor.authorizedCampuses);
    const includes = (value: string) => campusValues.some(candidate => campusId(candidate) === campusId(value)) &&
      (!Array.isArray(actor.authorizedCampuses) || actor.authorizedCampuses.some(candidate => campusId(candidate) === campusId(value)));
    if (!campusValues.length || (requestedCampuses.length ? !targets.every(includes) : !targets.some(includes))) return false;
  }
  const departments = scope.departmentIds ?? scope.departments;
  if (departments !== undefined && !values(target.departmentId || target.departmentIds).some(value => values(departments).includes(value))) return false;
  if (scope.self && (!actor.memberId || (target.memberId || target.assignedMemberId) !== actor.memberId)) return false;
  if (scope.objectIds !== undefined && (!target.id || !values(scope.objectIds).includes(target.id))) return false;
  return true;
}

export function createAuthorizer({ providers = conditionProviders() } = {}) {
  return {
    eligibleGrants(permissionCode: string, context: PolicyContext = {}, grants: readonly EffectiveGrant[] = []) {
      return grants.filter(grant => grant.permissionCode === permissionCode && validityMatches(grant.validity, context));
    },
    validCondition: (condition: unknown) => validCondition(condition, providers),
    conditionDefinitions: () => Object.values(providers).map(({ code, version, description, parameterSchema }) => ({ code, version, description, parameterSchema })),
    evaluate(actor: PolicyActor, permissionCode: string, target: PolicyResource = {}, context: PolicyContext = {}, grants: readonly EffectiveGrant[] = []) {
      if (actor?.status && !['enabled', 'active'].includes(actor.status) || actor?.memberStatus === 'inactive')
        return { allowed: false, matchedGrantIds: [], reasonCode: 'INACTIVE', scope: [], explanations: [] };
      if (identityPermissions.includes(permissionCode)) {
        const posts=activeMemberships(context);
        const retired=isRetiredElder(context);
        let campuses=actor?.authorizedCampuses || [];
        if(permissionCode==='booking.manage' && actor?.role!=='superadmin' && !retired &&
          !posts.some(post=>post.isPrimary && globalLeadershipPositions.includes(post.positionCode))) {
          campuses=campuses.filter(id=>campusId(id)===campusId(actor?.homeCampus));
        }
        const requested=values(target.campusId || target.campusIds);
        const scoped=!!actor?.memberId && !!campuses.length && requested.every(id=>campuses.some(value=>campusId(value)===campusId(id)));
        let eligible=true;
        const affairs=posts.some(post=>post.assignmentType==='maintenance_affairs');
        const repairs=posts.some(post=>post.departmentCode==='hardware' && post.assignmentType!=='maintenance_affairs');
        if(repairOperations.includes(permissionCode))eligible=repairs;
        if(receptionOperations.includes(permissionCode))eligible=repairs || affairs;
        if(managementPermissions.includes(permissionCode))eligible=actor?.role==='superadmin' || isLeader(context) || retired;
        if(permissionCode==='attendance.self')eligible=retired || actor?.role==='superadmin' || isLeader(context) || participationCodes(context,target).length>0;
        if(permissionCode==='attendance.token.issue')eligible=actor?.role==='superadmin' || isLeader(context) || retired || affairs;
        const allowed=scoped && eligible;
        return {allowed,matchedGrantIds:[],reasonCode:allowed?'IDENTITY_SCOPE':'IDENTITY_SCOPE_DENIED',scope:allowed?[{campusIds:campuses}]:[],explanations:[]};
      }
      const matchedGrantIds = [];
      const explanations = [];
      for (const grant of grants.filter(item => item.permissionCode === permissionCode)) {
        const scope = grant.scope === undefined ? {} : grant.scope;
        if (!validityMatches(grant.binding, context) || !validityMatches(grant.validity, context) || !scopeMatches(scope, target, actor)) continue;
        const conditions = grant.conditions === undefined ? [] : grant.conditions;
        if (!Array.isArray(conditions)) continue;
        const failed = conditions.some(condition => {
          const provider = providers[condition?.code];
          return !validCondition(condition, providers) || !provider || !provider.check({ actor, resource: target, context, grant, parameters: condition.parameters || {} });
        });
        if (failed) continue;
        matchedGrantIds.push(grant.id || grant.grantId || permissionCode);
        explanations.push({ grantId: grant.id || grant.grantId || permissionCode, scope, conditions });
      }
      return {
        allowed: matchedGrantIds.length > 0,
        matchedGrantIds,
        reasonCode: matchedGrantIds.length ? 'MATCHED' : 'NO_MATCHING_GRANT',
        scope: explanations.map(item => item.scope),
        explanations,
        authVersion: actor.authVersion || 0
      };
    },
    grantsFromRows(rows: readonly GrantRow[]): EffectiveGrant[] {
      return rows.map(row => ({
        id: row.id,
        permissionCode: row.permission_code,
        scope: parseJson(row.scope_spec, {}),
        conditions: parseJson(row.condition_spec, []),
        validity: parseJson(row.validity_spec, {}),
        roleId: row.role_id,
        roleCode: row.role_code
      }));
    }
  };
}
