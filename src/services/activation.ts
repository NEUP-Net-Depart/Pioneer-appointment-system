import type { StaffAccountDto, StaffRole } from '../../shared/staff-types.ts';
import type { activationRepository } from '../db/activation.ts';
import type { userRepository } from '../db/users.ts';
import type { StaffRepository } from '../db/staff-platform.ts';
import type { StaffService } from './staff-platform.ts';
import { isObject } from '../../shared/api-types.ts';

type InvitationScope = { expectedRole: StaffRole; authorizedCampuses: string[] };
const campusNames: Partial<Record<string, string>> = { 'campus-nanhu': '南湖', 'campus-hunnan': '浑南' };
type ActivationInput = Record<string, unknown>;
import { fail } from '../lib/http.ts';
import { account, stringField, passwordInput } from '../lib/validation.ts';
import { CAMPUSES } from '../../shared/constants.ts';
import { nowIso } from '../../shared/time.ts';
import { hashPassword } from '../lib/passwords.ts';
import { issueAccessToken, hashAccessToken } from '../lib/access-tokens.ts';
import { requireGrantScope } from './permissions.ts';
import { businessIdentityEligible } from '../modules/identity/public.ts';
import { stableJson } from '../platform/contracts.ts';
import { tokenDigest } from './staff-platform/shared.ts';

export function activationService(
  repository: ReturnType<typeof activationRepository>,
  users: Pick<ReturnType<typeof userRepository>, 'find'>,
  staff: Pick<StaffService, 'scopedActor' | 'contextFor'>,
  members: Pick<StaffRepository, 'memberRow' | 'memberImportSnapshot' | 'listRoles' | 'grants'>
) {
  async function authorized(actor: StaffAccountDto) {
    return staff.scopedActor(actor, 'accounts.manage');
  }
  function manageable(actor: StaffAccountDto, item: InvitationScope) {
    requireGrantScope(actor, item.authorizedCampuses);
    // A scoped accounts.manage grant is the source of truth for ordinary
    // activation work. Keep only the protected top-level identity boundary.
    if (item.expectedRole === 'superadmin') fail(403, '不能管理系统管理员激活资格');
  }
  function inScope(actor: StaffAccountDto, item: InvitationScope) {
    return (
      item.expectedRole !== 'superadmin' &&
      item.authorizedCampuses.length > 0 &&
      item.authorizedCampuses.every((campus) => actor.authorizedCampuses.includes(campus))
    );
  }
  async function memberState(id: string, actor: StaffAccountDto) {
    const context = await staff.contextFor(actor);
    const member = await members.memberRow(id);
    if (!member) fail(404, '成员不存在');
    if (!member.student_id || !/^\d{6,20}$/.test(member.student_id)) fail(409, '请先完善成员学号');
    if (member.id === context.actor.memberId) fail(403, '不能配置本人的激活资格');
    const [snapshot, roles] = await Promise.all([
      members.memberImportSnapshot([member.student_id]),
      members.listRoles()
    ]);
    const row = snapshot.data.invitations[0];
    const invitation = row
      ? {
          expectedRole: row.expected_role,
          authorizedCampuses: JSON.parse(row.campuses) as string[],
          status: row.status
        }
      : null;
    if (snapshot.data.members[0]?.revision !== member.revision)
      fail(409, '成员资料已变化，请刷新后重试');
    if (snapshot.data.accounts.length || invitation?.status === 'activated')
      fail(409, '已创建登录账号，请刷新后管理账号');
    const homeCampus = campusNames[member.home_campus_id ?? ''];
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
    const campuses = invitation?.authorizedCampuses || (homeCampus ? [homeCampus] : []);
    const roleVersions = roles.map(({ id, revision, enabled }) => ({ id, revision, enabled }));
    const eligible = (selected: readonly string[]) => businessIdentityEligible({
      status: member.status, campuses: selected
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
      member: { ...member, student_id: member.student_id },
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
    async member(id: string, actor: StaffAccountDto) {
      actor = await authorized(actor);
      return (await memberState(id, actor)).view;
    },
    async configureMember(id: string, input: ActivationInput, actor: StaffAccountDto) {
      actor = await authorized(actor);
      const { context, member, snapshot, roleVersions, view, eligible } = await memberState(id, actor);
      if (input.stateToken !== view.stateToken) fail(409, '成员授权或激活资格已变化，请刷新后重试');
      if (!view.canConfigure) fail(409, '请确认成员有效且已设置授权校区');
      if (
        !Array.isArray(input.authorizedCampuses) ||
        !input.authorizedCampuses.length ||
        input.authorizedCampuses.some((campus: unknown) => !CAMPUSES.some(value => value === campus))
      )
        fail(400, '请选择激活授权校区');
      const campuses = [...new Set(input.authorizedCampuses as (typeof CAMPUSES)[number][])].sort();
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
        if (/integer overflow|UNIQUE constraint/.test(String(isObject(error) ? error.message : undefined)))
          fail(409, '成员授权或激活资格已变化，请刷新后重试');
        throw error;
      }
      return (await memberState(id, actor)).view;
    },
    async whitelist(actor: StaffAccountDto) {
      actor = await authorized(actor);
      return { items: (await repository.listWhitelist()).filter((item) => inScope(actor, item)) };
    },
    async changeWhitelist(id: string, input: ActivationInput, actor: StaffAccountDto) {
      actor = await authorized(actor);
      const item = await repository.findWhitelist(id);
      if (!item) fail(404, '白名单不存在');
      manageable(actor, item);
      if (input.status !== 'open' && input.status !== 'revoked') fail(400, '资格状态不正确');
      if (item.status === 'activated') fail(409, '已激活账号请在账号列表中管理');
      if (!(await repository.changeWhitelist(item, input.status, actor.account, nowIso())))
        fail(409, '白名单已更新，请刷新');
      return { ok: true };
    },
    async submit(input: ActivationInput) {
      const studentId = account(input.studentId),
        name = stringField(input.name, '姓名', 80, true);
      const homeCampus = CAMPUSES.find(campus => campus === input.homeCampus);
      if (!/^\d{6,20}$/.test(studentId) || name.length < 2 || !homeCampus)
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
            homeCampus,
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
    async status(id: string, receipt: string | null) {
      if (typeof receipt !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(receipt))
        fail(404, '申请不存在或回执无效');
      const item = await repository.publicStatus(id, hashAccessToken(receipt));
      if (!item) fail(404, '申请不存在或回执无效');
      return item;
    },
    async requests(actor: StaffAccountDto) {
      actor = await authorized(actor);
      const items = (await repository.listRequests()).filter((item) => inScope(actor, item));
      return { items };
    },
    async review(input: ActivationInput, actor: StaffAccountDto) {
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
        (status !== 'approved' && status !== 'rejected')
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
        if (/integer overflow|ACTIVATION_CONFLICT/.test(String(isObject(error) ? error.message : undefined)))
          fail(409, '申请、成员或授权已变化，请刷新后重试');
        if (String(isObject(error) ? error.message : undefined).includes('ACTIVATION_ADMIN_AUTHORIZATION_REQUIRED'))
          fail(409, '管理员资格尚未配置角色和校区，请先通过成员管理导入并显式授权，再审核激活');
        if (String(isObject(error) ? error.message : undefined).includes('ACTIVATION_QUALIFICATION_CHANGED'))
          fail(409, '成员资格或授权已变化，请先在成员管理中核实，再审核激活');
        throw error;
      }
      if (!result.applied.length) fail(409, '申请已被其他管理员处理，请刷新');
      return result;
    }
  };
}
