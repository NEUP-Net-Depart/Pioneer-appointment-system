import { fail } from '../../lib/http.js';
import { dateKey, nowIso, validDate } from '../../platform/time.js';
import { publicResourceRef } from '../../platform/contracts.js';
import { inputString, validateScope, validateGrant } from './shared.js';
import {
  businessPermissions,
  systemRole,
  delegationScope,
  delegableRole,
  editableMember
} from './delegation.js';

export function rolesDomain({
  repository,
  platform,
  contextFor,
  requirePermission,
  memberTarget,
  evaluate
}) {
  async function permissions(actor) {
    await requirePermission(actor, 'roles.manage');
    return {
      items: (await repository.permissionDefinitions()).map((item) => ({
        ...item,
        delegable: actor.role === 'superadmin' || businessPermissions.has(item.code)
      })),
      conditionProviders: platform.authorizer.conditionDefinitions(),
      contractVersion: 'staff-platform.v1'
    };
  }

  async function roles(actor) {
    const { context } = await requirePermission(actor, 'roles.manage');
    const items = await repository.listRoles();
    for (const role of items) {
      const bind = role.code !== 'superadmin' && (actor.role === 'superadmin' || !systemRole(role));
      try {
        await assertEditableRole(context, role);
        role.actions = { edit: true, bind };
      } catch (error) {
        if (error.status !== 403) throw error;
        role.actions = { edit: false, bind };
      }
    }
    return { items };
  }

  function authorizeGrants(context, grants) {
    return grants.map((grant) => {
      if (!businessPermissions.has(grant.permissionCode)) fail(403, '不能授予系统级权限');
      return {
        ...grant,
        scope: delegationScope(context, 'roles.manage', grant.scope, grant.validity)
      };
    });
  }

  async function assertEditableRole(context, role) {
    if (role.code === 'superadmin') fail(403, '最高管理员权限包受保护');
    if (context.actor.role === 'superadmin') return;
    if (systemRole(role)) fail(403, '不能管理系统级角色');
    for (const member of await repository.roleMembers(role.id, context.businessDate))
      await editableMember(repository, context, member, evaluate, 'roles.manage');
    // Updating a shared role affects every binding, including future bindings.
    // Require the complete old package to be within this manager's authority.
    authorizeGrants(context, role.grants);
  }

  async function createRole(actor, input) {
    const { context } = await requirePermission(actor, 'roles.manage');
    const code = inputString(input, 'code', 80, true);
    if (!/^[a-z][a-z0-9_.-]+$/.test(code)) fail(400, '角色 code 不正确');
    if (code === 'superadmin') fail(403, '系统管理员角色受保护');
    const name = inputString(input, 'name', 80, true);
    const level = Number.isSafeInteger(input.level) ? input.level : 1;
    if (level < 1 || level >= (actor.role === 'superadmin' ? 4 : 3))
      fail(403, '角色等级超出可管理范围');
    const definitions = Object.fromEntries(
      (await repository.permissionDefinitions()).map((item) => [item.code, item])
    );
    if (input.grants !== undefined && !Array.isArray(input.grants)) fail(400, '权限集合必须是数组');
    if (
      new Set((input.grants || []).map((grant) => grant?.permissionCode)).size !==
      (input.grants || []).length
    )
      fail(400, '角色不能重复绑定同一权限');
    for (const grant of input.grants || []) {
      if (!grant || typeof grant !== 'object') fail(400, '权限配置不正确');
      if (!definitions[grant.permissionCode]) fail(400, `未知权限：${grant.permissionCode || ''}`);
      validateGrant(definitions[grant.permissionCode], grant, actor, platform.authorizer);
    }
    if (actor.role !== 'superadmin')
      input = { ...input, grants: authorizeGrants(context, input.grants || []) };
    const result = await repository.createRole(
      { ...input, code, name, level },
      {
        actorMemberId: context.actor.memberId,
        actorAccount: actor.account,
        authVersion: context.authVersion,
        action: 'authorization.role.created',
        after: { code, name, level, grants: input.grants || [] },
        requestId: input.requestId
      }
    );
    if (!result) fail(409, '权限已变化，请重新登录后重试');
    return result;
  }

  async function updateRole(actor, id, input) {
    const { context } = await requirePermission(actor, 'roles.manage');
    const role = (await repository.listRoles()).find((item) => item.id === id);
    if (!role) fail(404, '角色不存在');
    const roleGuard =
      actor.role === 'superadmin'
        ? undefined
        : await repository.roleGuard(role.id, context.businessDate);
    await assertEditableRole(context, role);
    if (actor.role !== 'superadmin' && input.level >= 3) fail(403, '不能配置系统级角色');
    if (!Number.isInteger(input.revision)) fail(400, '角色版本不正确');
    if (
      input.level !== undefined &&
      (!Number.isInteger(input.level) || input.level < 1 || input.level >= 4)
    )
      fail(400, '角色等级应为 1–3');
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean')
      fail(400, '角色启用状态不正确');
    if (input.name !== undefined) inputString(input, 'name', 80, true);
    if (input.description !== undefined) inputString(input, 'description', 500);
    if (input.grants !== undefined) {
      if (!Array.isArray(input.grants)) fail(400, '权限集合必须是数组');
      const codes = input.grants.map((grant) => grant?.permissionCode);
      if (new Set(codes).size !== codes.length) fail(400, '角色不能重复绑定同一权限');
      const definitions = Object.fromEntries(
        (await repository.permissionDefinitions()).map((item) => [item.code, item])
      );
      if (codes.some((code) => !definitions[code])) fail(400, '角色包含未知权限');
      for (const grant of input.grants)
        validateGrant(definitions[grant.permissionCode], grant, actor, platform.authorizer);
    }
    if (actor.role !== 'superadmin' && input.grants)
      input = { ...input, grants: authorizeGrants(context, input.grants) };
    const result = await repository.updateRole(id, input, input.revision, {
      actorMemberId: context.actor.memberId,
      actorAccount: actor.account,
      authVersion: context.authVersion,
      action: 'authorization.grant.updated',
      roleGuard,
      sourceRef: publicResourceRef('authorization', 'role', id),
      after: input,
      requestId: input.requestId
    });
    if (!result) fail(409, '角色或权限已被其他操作修改，请刷新');
    return { ...result, authVersionChanged: true };
  }

  async function previewRole(actor, input) {
    const targetMember = await repository.memberRow(input.memberId);
    if (!targetMember) fail(404, '成员不存在');
    await requirePermission(
      actor,
      'roles.manage',
      memberTarget(targetMember, await repository.memberships(input.memberId))
    );
    const targetAccount = await repository.accountForMember(input.memberId);
    if (!targetAccount) fail(400, '该成员尚未关联账号');
    const context = await contextFor(
      {
        account: targetAccount.account,
        role: targetAccount.role,
        authorizedCampuses: input.campusIds || []
      },
      input.businessDate || dateKey()
    );
    const grants = input.grants || context.grants;
    const actorView = {
      ...context.actor,
      authorizedCampuses: input.campusIds || context.actor.authorizedCampuses
    };
    return {
      actor: actorView,
      grants,
      results: grants.map((grant) =>
        platform.authorizer.evaluate(actorView, grant.permissionCode, input.target || {}, context, [
          grant
        ])
      ),
      testedAt: nowIso()
    };
  }

  async function bindMemberRoles(actor, memberId, input) {
    const member = await repository.memberRow(memberId);
    if (!member) fail(404, '成员不存在');
    const { context } = await requirePermission(
      actor,
      'roles.manage',
      memberTarget(member, await repository.memberships(memberId))
    );
    const target = await editableMember(repository, context, member, evaluate, 'roles.manage');
    if (!Number.isInteger(input.revision)) fail(400, '成员版本不正确');
    if (!Array.isArray(input.bindings)) fail(400, '角色绑定必须是数组');
    const roles = Object.fromEntries((await repository.listRoles()).map((role) => [role.id, role]));
    if (input.bindings.some((binding) => !binding || !roles[binding.roleId]))
      fail(400, '角色绑定不存在');
    for (const binding of input.bindings) {
      if (
        binding.scope !== undefined &&
        (!binding.scope || typeof binding.scope !== 'object' || Array.isArray(binding.scope))
      )
        fail(400, '角色范围不正确');
      validateScope(binding.scope || {});
      for (const value of [binding.effectiveFrom, binding.effectiveTo])
        if (
          value !== undefined &&
          value !== null &&
          (typeof value !== 'string' || !validDate(value))
        )
          fail(400, '角色有效期不正确');
      if (
        binding.effectiveFrom &&
        binding.effectiveTo &&
        binding.effectiveTo <= binding.effectiveFrom
      )
        fail(400, '角色有效期不正确');
    }
    // Replacing a binding collection must also authorize removal of the old
    // bindings; otherwise a campus manager could revoke another campus's roles.
    for (const binding of await repository.roleBindings(memberId)) {
      const role = roles[binding.roleId];
      if (role) delegableRole(context, role, binding, target);
    }
    const bindings = input.bindings.map((binding) =>
      delegableRole(context, roles[binding.roleId], binding, target)
    );
    const ok = await repository.bindRoles(memberId, bindings, input.revision, {
      actorMemberId: context.actor.memberId,
      actorAccount: actor.account,
      authVersion: context.authVersion,
      action: 'authorization.member_roles.updated',
      targetAccountVersion: target.account,
      sourceRef: publicResourceRef('authorization', 'member', memberId),
      after: bindings,
      roleVersions: Object.values(roles).map(({ id, revision, enabled }) => ({
        id,
        revision,
        enabled
      })),
      requestId: input.requestId
    });
    if (!ok) fail(409, '成员授权已被其他操作修改，请刷新');
    return { memberId, bindings, authVersionInvalidated: true };
  }
  return { permissions, roles, createRole, updateRole, previewRole, bindMemberRoles };
}
