import { campusId } from './scopes.js';
import { dateKey, validDate } from '../../platform/time.js';
import { conditionProviders } from './conditions.js';
import { parseJson } from '../../platform/contracts.js';

function values(value) {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function validityMatches(validity, context = {}) {
  if (!validity || typeof validity !== 'object' || Array.isArray(validity)) return true;
  const businessDate = context.businessDate || context.date || dateKey();
  const from = validity.effectiveFrom || validity.from || validity.startDate || validity.start;
  const to = validity.effectiveTo || validity.to || validity.endDate || validity.end;
  if ((from && !validDate(String(from).slice(0, 10))) || (to && !validDate(String(to).slice(0, 10)))) return false;
  if (from && businessDate < String(from).slice(0, 10)) return false;
  if (to && businessDate >= String(to).slice(0, 10)) return false;
  return true;
}

function scopeMatches(scope, target = {}, actor = {}) {
  if (!scope) return false;
  const rawCampuses = scope.campusIds ?? scope.campuses;
  const campusValues = rawCampuses === 'bound' || rawCampuses === 'legacy' ? actor.authorizedCampuses || [] : values(rawCampuses);
  if (rawCampuses !== undefined) {
    const targets = values(target.campusId || target.campusIds || actor.authorizedCampuses);
    if (!campusValues.length || !targets.some(value => campusValues.some(candidate => campusId(candidate) === campusId(value)))) return false;
  }
  const departments = scope.departmentIds ?? scope.departments;
  if (departments !== undefined && !values(target.departmentId || target.departmentIds).some(value => values(departments).includes(value))) return false;
  if (scope.self && (target.memberId || target.assignedMemberId) && (target.memberId || target.assignedMemberId) !== actor.memberId) return false;
  if (scope.objectIds !== undefined && (!target.id || !values(scope.objectIds).includes(target.id))) return false;
  return true;
}

export function createAuthorizer({ providers = conditionProviders() } = {}) {
  return {
    evaluate(actor, permissionCode, target = {}, context = {}, grants = []) {
      const matchedGrantIds = [];
      const explanations = [];
      for (const grant of grants.filter(item => item.permissionCode === permissionCode)) {
        const scope = grant.scope || {};
        if (!validityMatches(grant.validity, context) || !scopeMatches(scope, target, actor)) continue;
        const conditions = grant.conditions || [];
        const failed = conditions.find(condition => {
          const provider = providers[condition.code];
          return !provider || !provider.check({ actor, resource: target, context, parameters: condition.parameters || {} });
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
    grantsFromRows(rows) {
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
