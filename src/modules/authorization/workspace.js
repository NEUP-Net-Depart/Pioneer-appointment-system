import { createAuthorizer } from './public.js';

// Navigation is a projection of complete grants, including their conditions and
// validity. Commands must still evaluate against the actual resource.
export function workspacePermissions(actor, context, authorizer = createAuthorizer()) {
  const grants = context.grants || [];
  return Object.fromEntries([...new Set(grants.map(grant => grant.permissionCode))].map(code => {
    const allowed = grants.filter(grant => grant.permissionCode === code).some(grant => {
      const scope = grant.scope || {};
      const departments = scope.departmentIds || scope.departments || [undefined];
      const objects = scope.objectIds || [undefined];
      return (actor.authorizedCampuses || []).some(campusId => departments.some(departmentId => objects.some(id =>
        authorizer.evaluate(actor, code, { campusId, departmentId, id, memberId: actor.memberId, businessDate: context.businessDate }, context, [grant]).allowed)));
    });
    return [code, allowed];
  }));
}
