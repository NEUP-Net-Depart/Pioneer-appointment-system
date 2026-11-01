import { fail } from '../lib/http.js';
import { account, stringField, passwordInput } from '../lib/validation.js';
import { CAMPUSES } from '../../shared/constants.js';
import { nowIso } from '../../shared/time.js';
import { parseWhitelistCsv } from '../lib/whitelist-csv.js';
import { hashPassword } from '../lib/passwords.js';
import { issueAccessToken, hashAccessToken } from '../lib/access-tokens.js';
import { requireGrantScope } from './permissions.js';
import { activeAt } from '../modules/identity/public.js';
import { intersectScopes } from '../modules/authorization/scopes.js';
import { stableJson } from '../platform/contracts.js';
import { tokenDigest } from './staff-platform/shared.js';

export function activationService(repository, users, staff, members) {
  async function authorized(actor) {
    return staff.scopedActor(actor, 'accounts.manage');
  }
  function manageable(actor, item) {
    requireGrantScope(actor, item.authorizedCampuses);
    // A scoped accounts.manage grant is the source of truth for ordinary
    // activation work. Keep only the protected top-level identity boundary.
    if (item.expectedRole === 'superadmin') fail(403, '不能管理系统管理员激活资格');
  }
  function inScope(actor, item) {
    return (
      item.expectedRole !== 'superadmin' &&
      item.authorizedCampuses.length > 0 &&
      item.authorizedCampuses.every((campus) => actor.authorizedCampuses.includes(campus))
    );
  }
  async function memberState(id, actor) {
    const context = await staff.contextFor(actor);
    const member = await members.memberRow(id);
    if (!member) fail(404, '成员不存在');
    if (!/^\d{6,20}$/.test(member.student_id || '')) fail(409, '请先完善成员学号');
    requireGrantScope(actor, [member.home_campus_id === 'campus-hunnan' ? '浑南' : '南湖']);
    if (member.id === context.actor.memberId) fail(403, '不能配置本人的激活资格');
    const [snapshot, roles] = await Promise.all([
      members.memberImportSnapshot([member.student_id]),
      members.listRoles()
    ]);
    const row = snapshot.data.invitations[0];
    const invitation = row
      ? {
          expectedRole: row.expected_role,
          authorizedCampuses: JSON.parse(row.campuses),
          status: row.status
        }
      : null;
    if (snapshot.data.members[0]?.revision !== member.revision)
      fail(409, '成员资料已变化，请刷新后重试');
    if (snapshot.data.accounts.length || invitation?.status === 'activated')
      fail(409, '已创建登录账号，请刷新后管理账号');
    if (invitation) manageable(actor, invitation);
    if (snapshot.data.activationBindings.some((binding) => binding.member_id !== member.id))
      fail(409, '激活资格已关联其他人员，请核对现有资料');
    const bindings = snapshot.data.bindings.filter((binding) =>
      activeAt(binding.effective_from, binding.effective_to, context.businessDate)
    );
    const activeRoles = roles.filter(
      (role) => role.enabled && bindings.some((binding) => binding.role_id === role.id)
    );
    if (activeRoles.some((role) => role.code === 'superadmin'))
      fail(403, '不能配置系统管理员激活资格');
    const management = new Set([
      'accounts.manage',
      'members.manage',
      'roles.manage',
      'settings.manage',
      'statistics.read',
      'roster.repair.manage',
      'roster.office.manage',
      'attendance.correct'
    ]);
    const isManager = activeRoles.some((role) =>
      role.grants.some((grant) => management.has(grant.permissionCode))
    );
    const qualified = snapshot.data.profiles.some((profile) =>
      activeAt(profile.effective_from, profile.effective_to, context.businessDate)
    );
    const campuses = [
      ...new Set(
        activeRoles
          .flatMap((role) =>
            bindings
              .filter((binding) => binding.role_id === role.id)
              .flatMap((binding) =>
                role.grants.flatMap((grant) => {
                  const scope = intersectScopes(grant.scope, JSON.parse(binding.scope_bindings));
                  return Array.isArray(scope.campusIds) ? scope.campusIds : [member.home_campus_id];
                })
              )
          )
          .map((id) => (id === 'campus-hunnan' ? '浑南' : '南湖'))
      )
    ].sort();
    const roleVersions = activeRoles.map(({ id, revision, enabled }) => ({
      id,
      revision,
      enabled
    }));
    const stateToken = await tokenDigest(
      stableJson({
        snapshot: snapshot.guard.value,
        roleVersions,
        actor: actor.account,
        authVersion: context.authVersion
      })
    );
    return {
      context,
      member,
      snapshot,
      roleVersions,
      view: {
        studentId: member.student_id,
        name: member.name,
        roleNames: activeRoles.map((role) => role.name),
        authorizedCampuses: invitation?.authorizedCampuses || campuses,
        availableCampuses: actor.authorizedCampuses,
        expectedRole: invitation?.expectedRole || (isManager ? 'admin' : 'technician'),
        status: invitation?.status || 'unset',
        stateToken,
        canConfigure:
          member.status === 'active' &&
          activeRoles.some((role) => role.grants.length) &&
          (qualified || isManager)
      }
    };
  }
  return {
    async member(id, actor) {
      actor = await authorized(actor);
      return (await memberState(id, actor)).view;
    },
    async configureMember(id, input, actor) {
      actor = await authorized(actor);
      const { context, member, snapshot, roleVersions, view } = await memberState(id, actor);
      if (input.stateToken !== view.stateToken) fail(409, '成员授权或激活资格已变化，请刷新后重试');
      if (!view.canConfigure) fail(409, '请先在人员详情中配置有效角色及所需工作资格');
      if (
        !Array.isArray(input.authorizedCampuses) ||
        !input.authorizedCampuses.length ||
        input.authorizedCampuses.some((campus) => !CAMPUSES.includes(campus))
      )
        fail(400, '请选择激活授权校区');
      const campuses = [...new Set(input.authorizedCampuses)].sort();
      requireGrantScope(actor, campuses);
      const previous = snapshot.data.invitations[0];
      if (
        previous?.status === 'open' &&
        previous.expected_name === member.name &&
        snapshot.data.activationBindings.length &&
        stableJson(JSON.parse(previous.campuses).sort()) === stableJson(campuses)
      )
        return view;
      try {
        await repository.configureMemberWhitelist(
          {
            studentId: member.student_id,
            memberId: member.id,
            expectedName: member.name,
            expectedRole: view.expectedRole,
            authorizedCampuses: campuses
          },
          {
            actorAccount: actor.account,
            actorMemberId: context.actor.memberId,
            authVersion: context.authVersion
          },
          snapshot.guard,
          roleVersions,
          nowIso()
        );
      } catch (error) {
        if (/integer overflow|UNIQUE constraint/.test(String(error.message)))
          fail(409, '成员授权或激活资格已变化，请刷新后重试');
        throw error;
      }
      return (await memberState(id, actor)).view;
    },
    async import(input, actor) {
      actor = await authorized(actor);
      const items = parseWhitelistCsv(input),
        fresh = [],
        skipped = [];
      const [staff, whitelist] = await Promise.all([users.list(), repository.listWhitelist()]);
      const existing = new Set([
        ...staff.map((item) => item.account),
        ...whitelist.map((item) => item.studentId)
      ]);
      for (const item of items) {
        manageable(actor, item);
        if (item.expectedRole === 'admin')
          fail(
            400,
            '管理员请通过成员管理导入，并明确配置角色和授权校区；普通加入名单仅支持维修人员'
          );
        if (existing.has(item.studentId)) skipped.push(item.studentId);
        else fresh.push(item);
      }
      if (fresh.length) await repository.importWhitelist(fresh, actor.account, nowIso());
      return { imported: fresh.map((item) => item.studentId), skipped };
    },
    async whitelist(actor) {
      actor = await authorized(actor);
      return { items: (await repository.listWhitelist()).filter((item) => inScope(actor, item)) };
    },
    async changeWhitelist(id, input, actor) {
      actor = await authorized(actor);
      const item = await repository.findWhitelist(id);
      if (!item) fail(404, '白名单不存在');
      manageable(actor, item);
      if (!['open', 'revoked'].includes(input.status)) fail(400, '资格状态不正确');
      if (item.status === 'activated') fail(409, '已激活账号请在账号列表中管理');
      if (!(await repository.changeWhitelist(item, input.status, actor.account, nowIso())))
        fail(409, '白名单已更新，请刷新');
      return { ok: true };
    },
    async submit(input) {
      const studentId = account(input.studentId),
        name = stringField(input.name, '姓名', 80, true);
      if (!/^\d{6,20}$/.test(studentId) || name.length < 2 || !CAMPUSES.includes(input.homeCampus))
        fail(400, '学号、姓名或所属校区不正确');
      const password = passwordInput(input.password);
      const whitelist = await repository.findWhitelist(studentId);
      if (
        !whitelist ||
        whitelist.status !== 'open' ||
        (whitelist.expectedName && whitelist.expectedName !== name) ||
        (await users.find(studentId))
      )
        fail(400, '当前资料无法提交激活申请，请联系管理员核实');
      if (whitelist.expectedRole === 'admin' && !whitelist.activationMemberId)
        fail(409, '管理员资格尚未配置角色和校区，请联系负责人通过成员管理导入并显式授权');
      const receipt = issueAccessToken(),
        id = crypto.randomUUID();
      if (
        !(await repository.submit(
          {
            id,
            studentId,
            name,
            homeCampus: input.homeCampus,
            passwordHash: hashPassword(password),
            receiptHash: receipt.hash,
            createdAt: nowIso()
          },
          whitelist.revision
        ))
      )
        fail(409, '资格已更新，请联系管理员');
      return { id, receipt: receipt.token, status: 'pending' };
    },
    async status(id, receipt) {
      if (typeof receipt !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(receipt))
        fail(404, '申请不存在或回执无效');
      const item = await repository.publicStatus(id, hashAccessToken(receipt));
      if (!item) fail(404, '申请不存在或回执无效');
      return item;
    },
    async requests(actor) {
      actor = await authorized(actor);
      const items = (await repository.listRequests()).filter((item) => inScope(actor, item));
      return { items };
    },
    async review(input, actor) {
      actor = await authorized(actor);
      const ids = input.ids,
        status = input.status,
        note = stringField(input.reviewNote, '审核说明', 300);
      if (
        !Array.isArray(ids) ||
        !ids.length ||
        ids.length > 100 ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => typeof id !== 'string' || id.length > 40) ||
        !['approved', 'rejected'].includes(status)
      )
        fail(400, '审核申请或状态不正确');
      if (status === 'approved' && input.identityVerified !== true)
        fail(400, '审批前必须逐人核验身份');
      const items = [];
      for (const id of ids) {
        const item = await repository.findRequest(id);
        if (!item) fail(404, '申请不存在');
        manageable(actor, item);
        if (item.status !== 'pending' || (status === 'approved' && item.whitelistStatus !== 'open'))
          fail(409, '申请或资格已更新，请刷新');
        items.push(item);
      }
      let result;
      try {
        result = await repository.review(items, status, note, actor.account, nowIso());
      } catch (error) {
        if (String(error.message).includes('ACTIVATION_ADMIN_AUTHORIZATION_REQUIRED'))
          fail(409, '管理员资格尚未配置角色和校区，请先通过成员管理导入并显式授权，再审核激活');
        if (String(error.message).includes('ACTIVATION_QUALIFICATION_CHANGED'))
          fail(409, '成员资格或授权已变化，请先在成员管理中核实，再审核激活');
        throw error;
      }
      if (!result.applied.length) fail(409, '申请已被其他管理员处理，请刷新');
      return result;
    }
  };
}
