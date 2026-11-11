import { fail } from '../lib/http.js';
import { account, stringField, passwordInput } from '../lib/validation.js';
import { CAMPUSES } from '../../shared/constants.js';
import { nowIso } from '../../shared/time.js';
import { hashPassword } from '../lib/passwords.js';
import { issueAccessToken, hashAccessToken } from '../lib/access-tokens.js';
import { requireGrantScope } from './permissions.js';
import { businessIdentityEligible } from '../modules/identity/public.js';
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
    const homeCampus = { 'campus-nanhu': '南湖', 'campus-hunnan': '浑南' }[member.home_campus_id];
    if (invitation) manageable(actor, invitation);
    else {
      if (!homeCampus) fail(409, '请先设置成员所属校区');
      requireGrantScope(actor, [homeCampus]);
    }
    if (snapshot.data.activationBindings.some((binding) => binding.member_id !== member.id))
      fail(409, '激活资格已关联其他人员，请核对现有资料');
    const grants = await members.grants(member.id);
    if (grants.some(grant => grant.roleCode === 'superadmin')) fail(403, '不能配置系统管理员激活资格');
    const roleIds = new Set(grants.map(grant => grant.roleId));
    const activeRoles = roles.filter(role => role.enabled && roleIds.has(role.id));
    const campuses = invitation?.authorizedCampuses || [homeCampus];
    const roleVersions = roles.map(({ id, revision, enabled }) => ({ id, revision, enabled }));
    const eligible = (selected) => businessIdentityEligible({
      memberId: member.id, status: member.status, campuses: selected, grants,
      authorizationDate: context.authorizationDate || context.businessDate,
      memberships: snapshot.data.memberships.map(row => ({ departmentId: row.department_id, effectiveFrom: row.effective_from, effectiveTo: row.effective_to, assignmentType: row.assignment_type, isPrimary: !!row.is_primary }))
    });
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
      eligible,
      view: {
        studentId: member.student_id,
        name: member.name,
        roleNames: activeRoles.map((role) => role.name),
        authorizedCampuses: invitation?.authorizedCampuses || campuses,
        availableCampuses: actor.authorizedCampuses,
        expectedRole: invitation?.expectedRole || 'technician',
        status: invitation?.status || 'unset',
        stateToken,
        canConfigure: eligible(actor.authorizedCampuses)
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
      const { context, member, snapshot, roleVersions, view, eligible } = await memberState(id, actor);
      if (input.stateToken !== view.stateToken) fail(409, '成员授权或激活资格已变化，请刷新后重试');
      if (!view.canConfigure) fail(409, '请确认成员有效且已设置授权校区');
      if (
        !Array.isArray(input.authorizedCampuses) ||
        !input.authorizedCampuses.length ||
        input.authorizedCampuses.some((campus) => !CAMPUSES.includes(campus))
      )
        fail(400, '请选择激活授权校区');
      const campuses = [...new Set(input.authorizedCampuses)].sort();
      requireGrantScope(actor, campuses);
      if (!eligible(campuses)) fail(409, '所选校区没有有效业务身份或授权');
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
      if (!whitelist.activationMemberId)
        fail(409, '激活资格尚未关联人员，请联系负责人核对任职和校区');
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
      const items = [], guards = [];
      for (const id of ids) {
        const item = await repository.findRequest(id);
        if (!item) fail(404, '申请不存在');
        manageable(actor, item);
        if (item.status !== 'pending' || (status === 'approved' && item.whitelistStatus !== 'open'))
          fail(409, '申请或资格已更新，请刷新');
        if (status === 'approved') {
          const invitation = await repository.findWhitelist(item.studentId);
          if (!invitation?.activationMemberId) fail(409, '激活资格尚未关联人员');
          const state = await memberState(invitation.activationMemberId, actor);
          if (!state.eligible(item.authorizedCampuses)) fail(409, '成员身份或授权已变化');
          guards.push({ snapshot: state.snapshot.guard, roleVersions: state.roleVersions });
        }
        items.push(item);
      }
      let result;
      try {
        const context = await staff.contextFor(actor);
        result = await repository.review(items, status, note, actor.account, nowIso(), guards, { memberId: context.actor.memberId, authVersion: context.authVersion });
      } catch (error) {
        if (/integer overflow|ACTIVATION_CONFLICT/.test(String(error.message)))
          fail(409, '申请、成员或授权已变化，请刷新后重试');
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
