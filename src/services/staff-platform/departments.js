import { fail } from '../../lib/http.js';
import { inputString } from './shared.js';

export function canManageDepartments(context, platform) {
  // Departments are shared by all campuses. A campus or department grant must
  // not become permission to rename or disable the global organization.
  const grants = context.grants.filter(
    (grant) => !Object.keys(grant.scope || {}).some((key) => key !== 'all')
  );
  return platform.authorizer.evaluate(context.actor, 'settings.manage', {}, context, grants)
    .allowed;
}

export function departmentsDomain({ repository, platform, contextFor }) {
  async function saveDepartment(actor, input, departmentId) {
    const context = await contextFor(actor);
    if (!canManageDepartments(context, platform)) fail(403, '部门维护需要全局系统设置权限');
    const name = inputString(input, 'name', 80, true);
    if (typeof input.enabled !== 'boolean') fail(400, '部门状态不正确');
    const departments = await repository.listDepartments(true);
    const before = departmentId
      ? departments.find((department) => department.id === departmentId)
      : null;
    if (departmentId && !before) fail(404, '部门不存在');
    if (departmentId && (!Number.isInteger(input.revision) || input.revision < 0))
      fail(400, '部门版本不正确');
    if (departmentId && before.revision !== input.revision) fail(409, '部门已变化，请刷新后重试');
    if (
      departments.some((department) => department.name === name && department.id !== departmentId)
    )
      fail(409, '部门名称已存在');
    if (before?.name === name && before.enabled === input.enabled) return before;
    try {
      const result = await repository.saveDepartment(
        { id: departmentId, name, enabled: input.enabled, revision: input.revision },
        {
          actorMemberId: context.actor.memberId,
          actorAccount: actor.account,
          authVersion: context.authVersion,
          action: departmentId
            ? 'organization.department.updated'
            : 'organization.department.created',
          before,
          after: { name, enabled: input.enabled },
          requestId: input.requestId
        }
      );
      if (!result) fail(409, '部门或权限已变化，请刷新后重试');
      return result;
    } catch (error) {
      if (/UNIQUE constraint/.test(String(error.message))) fail(409, '部门名称已存在');
      throw error;
    }
  }
  return { saveDepartment };
}
