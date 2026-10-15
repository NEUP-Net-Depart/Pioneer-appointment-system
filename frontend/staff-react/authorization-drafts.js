// Only replace the field the operator edits; keep extension scopes and conditions intact.
export function withCampusScope(scope, campusIds) {
  const next = { ...scope };
  delete next.campuses;
  delete next.campusIds;
  if (campusIds !== null) next.campusIds = [...campusIds];
  return next;
}

export function setGrantEnabled(grants, definition, enabled, originalGrants = []) {
  const current = grants.filter(grant => grant.permissionCode === definition.code);
  if (enabled && current.length) return grants;
  if (!enabled) return grants.filter(grant => grant.permissionCode !== definition.code);
  const originals = originalGrants.filter(grant => grant.permissionCode === definition.code);
  if (originals.length) return [...grants, ...structuredClone(originals)];
  const scope = {};
  if (definition.scopeKinds?.includes('campus')) scope.campuses = 'bound';
  if (definition.scopeKinds?.includes('self')) scope.self = true;
  return [...grants, { permissionCode: definition.code, scope,
    conditions: (definition.conditionKinds || []).map(code => ({ code, parameters: {} })), validity: {} }];
}

export function roleBindingsPayload(bindings) {
  return bindings.map(binding => ({ ...binding,
    effectiveTo: binding.effectiveTo || null,
    scope: structuredClone(binding.scope || {}) }));
}
