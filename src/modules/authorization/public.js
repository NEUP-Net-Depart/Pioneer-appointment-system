import { conditionProviders } from './conditions.js';
import { parseJson } from '../../platform/contracts.js';

function values(value) {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function scopeMatches(scope, target = {}, actor = {}) {
  if (!scope || scope.all === true) return true;
  const boundCampuses = actor.authorizedCampuses || [];
  const rawCampuses = scope.campusIds || scope.campuses;
  const campuses = rawCampuses === 'bound' || rawCampuses === 'legacy' ? boundCampuses : values(rawCampuses);
  const departments = values(scope.departmentIds || scope.departments);
  const campusNames = { 'campus-nanhu': '南湖', 'campus-hunnan': '浑南', '南湖': '南湖', '浑南': '浑南' };
  const targetCampuses = values(target.campusId || target.campusIds || actor.authorizedCampuses);
  const targetDepartments = values(target.departmentId || target.departmentIds);
  if (campuses.length && !targetCampuses.some(value => campuses.some(candidate => candidate === value || campusNames[candidate] === campusNames[value] || actor.campusNameMap?.[candidate] === value))) return false;
  if (departments.length && !targetDepartments.some(value => departments.includes(value))) return false;
  if (scope.self && target.memberId && target.memberId !== actor.memberId) return false;
  if (scope.objectIds && target.id && !values(scope.objectIds).includes(target.id)) return false;
  return true;
}

export function createAuthorizer({ providers = conditionProviders() } = {}) {
  return {
    evaluate(actor, permissionCode, target = {}, context = {}, grants = []) {
      const matchedGrantIds = [];
      const explanations = [];
      for (const grant of grants.filter(item => item.permissionCode === permissionCode)) {
        const scope = grant.scope || {};
        if (!scopeMatches(scope, target, actor)) continue;
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
