import { fail } from '../../lib/http.js';
import { campusId, intersectScopes } from '../../modules/authorization/scopes.js';

// Business managers can authorize workers without acquiring their work identity.
// System audit, deletion and superadmin capabilities remain outside this boundary.
export const businessPermissions = new Set([
  'repair.summary.read',
  'repair.start',
  'repair.finish.own',
  'repair.correct',
  'repair.transfer',
  'customer.identity.read',
  'customer.contact.read',
  'onsite.create',
  'onsite.frontdesk.create',
  'statistics.read',
  'settings.manage',
  'accounts.manage',
  'members.manage',
  'roles.manage',
  'roster.read',
  'roster.repair.manage',
  'roster.repair.configure',
  'roster.office.manage',
  'leave.review',
  'attendance.self',
  'attendance.session.manage',
  'attendance.correct',
  'attendance.export'
]);

export function systemRole(role) {
  return (
    role.code === 'superadmin' ||
    role.level >= 3 ||
    role.grants.some((grant) => !businessPermissions.has(grant.permissionCode))
  );
}

function interval(value = {}) {
  return [
    value.effectiveFrom || value.from || value.startDate || value.start || '',
    value.effectiveTo || value.to || value.endDate || value.end || '9999-12-31'
  ].map((date) => date?.slice(0, 10) || '');
}

export function delegationScope(context, permission, scope = {}, validity = {}, target = {}) {
  if (context.actor.role === 'superadmin') return scope;
  if (scope.all) fail(403, '不能授予全局权限');
  const raw = scope.campusIds ?? scope.campuses;
  const campuses = (
    Array.isArray(raw) ? raw : target.campuses || context.actor.authorizedCampuses || []
  ).map(campusId);
  if (!campuses.length) fail(403, '授权必须限定在可管理校区内');
  const [requestedFrom, to] = interval(validity);
  const from = requestedFrom > context.businessDate ? requestedFrom : context.businessDate;
  const sources = context.grants.filter((grant) => grant.permissionCode === permission);
  for (const campus of campuses) {
    const allowed =
      (context.actor.authorizedCampuses || []).map(campusId).includes(campus) &&
      sources.some((grant) => {
        const source = grant.scope || {};
        const values = source.campusIds ?? source.campuses;
        if (Array.isArray(values) && !values.map(campusId).includes(campus)) return false;
        // A grant limited to a particular person, department or condition cannot
        // be converted into a general role that applies to other resources.
        if (
          source.self ||
          source.departmentIds ||
          source.departments ||
          source.objectIds ||
          grant.conditions?.length
        )
          return false;
        const [grantFrom, grantTo] = interval(grant.validity),
          [bindingFrom, bindingTo] = interval(grant.binding);
        return from >= grantFrom && from >= bindingFrom && to <= grantTo && to <= bindingTo;
      });
    if (!allowed) fail(403, '授权范围或有效期超出可管理范围');
  }
  return { ...scope, campuses: undefined, campusIds: [...new Set(campuses)] };
}

export function delegableRole(context, role, binding = {}, target = {}) {
  if (role.code === 'superadmin') fail(403, '不能分配系统管理员角色');
  if (context.actor.role === 'superadmin') return binding;
  if (systemRole(role)) fail(403, '不能管理系统级角色或权限');
  const scope = delegationScope(
    context,
    'roles.manage',
    binding.scope,
    {
      effectiveFrom: binding.effectiveFrom || context.businessDate,
      effectiveTo: binding.effectiveTo
    },
    target
  );
  for (const grant of role.grants) {
    const effective = intersectScopes(grant.scope, scope);
    const [grantFrom, grantTo] = interval(grant.validity),
      [bindingFrom, bindingTo] = interval(binding);
    delegationScope(
      context,
      'roles.manage',
      effective,
      {
        effectiveFrom: [grantFrom, bindingFrom || context.businessDate].sort().at(-1),
        effectiveTo: [grantTo, bindingTo].sort()[0]
      },
      target
    );
  }
  return { ...binding, scope };
}

export async function editableMember(
  repository,
  context,
  member,
  evaluate,
  permission = 'members.manage'
) {
  const memberId = member.memberId || member.id;
  const account = await repository.accountForMember(memberId);
  if (memberId === context.actor.memberId || account?.protected || account?.role === 'superadmin')
    fail(403, '不能修改本人或受保护系统账号的成员授权');
  const campuses = account
    ? JSON.parse(account.campuses || '[]').map(campusId)
    : [member.homeCampusId || member.home_campus_id];
  const memberships = await repository.memberships(memberId, context.businessDate);
  for (const campus of campuses) {
    if (
      !evaluate(context, permission, {
        id: memberId,
        memberId,
        campusId: campus,
        departmentIds: memberships.map((item) => item.departmentId)
      }).allowed
    )
      fail(403, '成员账号包含管理范围以外的校区');
  }
  return { account, campuses };
}
