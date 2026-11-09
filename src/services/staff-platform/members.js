import { fail } from '../../lib/http.js';
import { dateKey, validDate } from '../../platform/time.js';
import { publicResourceRef, SCHEMA_VERSION } from '../../platform/contracts.js';
import { memberPublic } from '../../modules/identity/public.js';
import { staffIdentities } from '../../../shared/staff-identities.js';
import { inputString, csvRows, tokenDigest } from './shared.js';
import { editableMember, delegableRole } from './delegation.js';
import { memberImportDomain } from './member-import.js';
import { positionsFor, globalLeadershipPositions } from '../../../shared/staff-organization.js';
import { NEU_COLLEGES } from '../../../shared/neu-colleges.js';

export function membersDomain({ repository, platform, contextFor, evaluate }) {
  const { importMembers, createMember } = memberImportDomain({ repository, contextFor, evaluate });
  function memberTarget(member, memberships, overrides = {}) {
    const memberId = member.memberId || member.id;
    return {
      id: memberId,
      memberId,
      campusId: member.homeCampusId ?? member.home_campus_id,
      departmentIds: memberships.map((item) => item.departmentId),
      ...overrides
    };
  }

  async function requireMemberPermission(actor, member, overrides = {}) {
    const context = await contextFor(actor);
    const memberships = await repository.memberships(
      member.memberId || member.id,
      context.businessDate
    );
    const campuses = [member.homeCampusId || member.home_campus_id];
    if (
      !campuses.some(
        (campusId) =>
          evaluate(
            context,
            'members.manage',
            memberTarget(member, memberships, { campusId, ...overrides })
          ).allowed
      )
    )
      fail(403, '缺少权限：members.manage');
    return { context, memberships };
  }

  function memberCursor(member) {
    return encodeURIComponent(JSON.stringify([member.name, member.memberId]));
  }

  function canReadMemberAudit(context, member, memberships) {
    const globalContext = {
      ...context,
      grants: context.grants.filter(
        (grant) =>
          !grant.conditions?.length &&
          Object.keys(grant.scope || {}).every((key) =>
            ['all', 'campusIds', 'campuses'].includes(key)
          )
      )
    };
    return ['campus-nanhu', 'campus-hunnan'].every(
      (campusId) =>
        evaluate(globalContext, 'members.manage', memberTarget(member, memberships, { campusId }))
          .allowed
    );
  }

  function visibleIdentityContext(identity, viewer, member, memberships) {
    if (!identity) return identity;
    return {
      ...identity,
      actor: {
        ...identity.actor,
        authorizedCampuses: (identity.actor.authorizedCampuses || []).filter(
          (campusId) =>
            evaluate(viewer, 'members.manage', memberTarget(member, memberships, { campusId }))
              .allowed
        )
      }
    };
  }

  function parseMemberCursor(value) {
    if (!value) return undefined;
    try {
      if (typeof value !== 'string' || value.length > 2048) throw new Error();
      const parts = JSON.parse(decodeURIComponent(value));
      if (
        !Array.isArray(parts) ||
        parts.length !== 2 ||
        parts.some((part) => typeof part !== 'string') ||
        parts[0].length > 80 ||
        !parts[1] ||
        parts[1].length > 128
      )
        throw new Error();
      return { name: parts[0], memberId: parts[1] };
    } catch {
      fail(400, '成员分页游标不正确');
    }
  }

  async function memberList(actor, filters = {}) {
    const context = await contextFor(actor);
    if (!context.permissions['members.manage']) fail(403, '缺少权限：members.manage');
    if (filters.status && !['active', 'inactive'].includes(filters.status))
      fail(400, '成员状态不正确');
    const query = {
      q: inputString(filters, 'q', 120),
      status: filters.status,
      homeCampusId: inputString(filters, 'homeCampusId', 80),
      businessDate: context.businessDate
    };
    let after = parseMemberCursor(filters.cursor);
    const items = [];
    const withIdentities = (items) =>
      items.map((item) => ({
        ...item,
        identities: staffIdentities({
          actor: { role: item.role },
          memberships: item.memberships || []
        })
      }));
    // Scan in bounded database pages, but fill a page with authorized members.
    // The public cursor references only the last returned (visible) member.
    for (;;) {
      const candidates = await repository.listMembers({ ...query, after });
      const membershipItems = await repository.membershipsForMembers(
        candidates.map((item) => item.memberId),
        context.businessDate
      );
      const byMember = new Map();
      for (const membership of membershipItems) {
        if (!byMember.has(membership.memberId)) byMember.set(membership.memberId, []);
        byMember.get(membership.memberId).push(membership);
      }
      for (const item of candidates) {
        const memberships = byMember.get(item.memberId) || [];
        const access = [item.homeCampusId];
        if (
          !access.some(
            (campusId) =>
              evaluate(context, 'members.manage', memberTarget(item, memberships, { campusId }))
                .allowed
          )
        )
          continue;
        const visible = { ...item };
        delete visible.accessCampusIds;
        items.push({ ...visible, memberships });
        if (items.length === 101)
          return {
            items: withIdentities(items.slice(0, 100)),
            nextCursor: memberCursor(items[99]),
            schemaVersion: SCHEMA_VERSION
          };
      }
      if (candidates.length < 101)
        return {
          items: withIdentities(items),
          nextCursor: null,
          schemaVersion: SCHEMA_VERSION
        };
      const last = candidates.at(-1);
      after = { name: last.name, memberId: last.memberId };
    }
  }

  async function memberDetail(actor, memberId, businessDate = dateKey()) {
    const target = await repository.memberRow(memberId);
    if (!target) fail(404, '成员不存在');
    const { context, memberships } = await requireMemberPermission(actor, target);
    let editable = true;
    try {
      await editableMember(repository, context, target, evaluate);
    } catch (error) {
      if (error.status !== 403) throw error;
      editable = false;
    }
    if (!validDate(businessDate)) fail(400, '业务日期不正确');
    const [memberMemberships, account, contexts, roles] = await Promise.all([
      repository.listMemberships(memberId),
      repository.accountForMember(memberId),
      repository.fieldContexts([memberId], businessDate),
      repository.listRoles()
    ]);
    return {
      actions: {
        edit: editable,
        readAudit: canReadMemberAudit(context, target, memberships),
        editRoles:
          !account?.protected &&
          account?.role !== 'superadmin' &&
          memberId !== context.actor.memberId &&
          context.permissions['roles.manage']
      },
      bindings: context.permissions['roles.manage']
        ? (await repository.roleBindings(memberId)).filter((binding) => {
            try {
              delegableRole(
                context,
                roles.find((role) => role.id === binding.roleId),
                binding,
                {
                  campuses: account ? JSON.parse(account.campuses || '[]') : [target.home_campus_id]
                }
              );
              return true;
            } catch (error) {
              if (error.status !== 403) throw error;
              return false;
            }
          })
        : [],
      member: {
        ...memberPublic(target, { memberships: memberMemberships }),
        identities: staffIdentities(
          visibleIdentityContext(contexts.get(memberId), context, target, memberships),
          platform.authorizer
        )
      },
      account: account
        ? {
            account: account.account,
            status: account.status,
            protected: !!account.protected,
            role: account.role,
            authorizedCampuses: JSON.parse(account.campuses || '[]'),
            authVersion: account.auth_version || 0
          }
        : null
    };
  }

  async function updateMember(actor, memberId, input) {
    const before = await repository.memberRow(memberId);
    if (!before) fail(404, '成员不存在');
    const { context } = await requireMemberPermission(actor, before);
    const targetState = await editableMember(repository, context, before, evaluate);
    if (input.homeCampusId)
      await requireMemberPermission(actor, before, { campusId: input.homeCampusId });
    if (!Number.isInteger(input?.revision) || input.revision < 0) fail(400, '成员版本不正确');
    const patch = {};
    if (input.name !== undefined) patch.name = inputString(input, 'name', 80, true);
    if (input.studentId !== undefined)
      patch.studentId = input.studentId ? inputString(input, 'studentId', 40, true) : '';
    if (input.college !== undefined) patch.college = inputString(input, 'college', 100);
    if (input.major !== undefined) patch.major = inputString(input, 'major', 100);
    if (input.homeCampusId !== undefined) {
      patch.homeCampusId = inputString(input, 'homeCampusId', 80, true);
      if (!['campus-nanhu', 'campus-hunnan'].includes(patch.homeCampusId))
        fail(400, '所属校区不正确');
    }
    if (input.status !== undefined) {
      if (!['active', 'inactive'].includes(input.status)) fail(400, '成员状态不正确');
      patch.status = input.status;
    }
    const previous = memberPublic(before);
    for (const key of Object.keys(patch)) if (patch[key] === previous[key]) delete patch[key];
    if (!Object.keys(patch).length) {
      if (before.revision !== input.revision) fail(409, '成员已被其他操作修改，请刷新');
      return { member: previous, revision: before.revision };
    }
    let invitationGuard,
      syncInvitationName = false;
    if (patch.name && !targetState.account && before.student_id) {
      const snapshot = await repository.memberImportSnapshot([before.student_id]);
      invitationGuard = snapshot.guard;
      const invitation = snapshot.data.invitations[0];
      if (invitation?.status === 'open' && invitation.expected_name !== patch.name) {
        const campuses = JSON.parse(invitation.campuses);
        if (
          !campuses.length ||
          campuses.some(
            (campus) => !evaluate(context, 'accounts.manage', { campusId: campus }).allowed
          )
        )
          fail(403, '同步待激活姓名需要激活资格所在校区的账号管理权限');
        syncInvitationName = true;
      }
    }
    const after = await repository.updateMember(memberId, patch, input.revision, {
      actorMemberId: context.actor.memberId,
      actorAccount: actor.account,
      authVersion: context.authVersion,
      action: 'identity.member.updated',
      targetAccountVersion: targetState.account,
      invitationGuard,
      syncInvitationName,
      sourceRef: publicResourceRef('identity', 'member', memberId),
      before,
      after: patch,
      requestId: input.requestId,
      reason: input.reason
    });
    if (!after) fail(409, '成员已被其他操作修改，请刷新');
    const account = await repository.accountForMember(memberId);
    return {
      member: memberPublic(after),
      revision: after.revision,
      affectedResources: [{ module: 'identity', type: 'member', id: memberId }],
      accountStatus: account?.status || ''
    };
  }

  async function ownProfile(actor, input) {
    const context = await contextFor(actor);
    const memberId = context.actor.memberId;
    const before = await repository.memberRow(memberId);
    if (!before) fail(404, '成员资料不存在');
    if (input === undefined) return { member: memberPublic(before) };
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => !['name', 'college', 'revision', 'requestId'].includes(key))
    )
      fail(400, '仅可修改本人姓名和学院');
    if (!Number.isInteger(input.revision) || input.revision < 0) fail(400, '成员版本不正确');
    const patch = {};
    if (input.name !== undefined) patch.name = inputString(input, 'name', 80, true);
    if (input.college !== undefined) {
      if (!NEU_COLLEGES.includes(input.college)) fail(400, '请选择东北大学学院');
      patch.college = input.college;
    }
    if (!Object.keys(patch).length) fail(400, '请选择要修改的资料');
    const after = await repository.updateMember(memberId, patch, input.revision, {
      actorMemberId: memberId,
      actorAccount: actor.account,
      authVersion: context.authVersion,
      action: 'identity.member.profile.updated',
      sourceRef: publicResourceRef('identity', 'member', memberId),
      before: { name: before.name, college: before.college },
      after: patch,
      requestId: input.requestId
    });
    if (!after) fail(409, '成员资料已变化，请刷新后重试');
    return { member: memberPublic(after) };
  }

  async function addMembership(actor, memberId, input) {
    if (!Number.isInteger(input?.revision) || input.revision < 0) fail(400, '成员版本不正确');
    for (const key of ['departmentId', 'effectiveFrom']) inputString(input, key, 80, true);
    if (!validDate(input.effectiveFrom) || (input.effectiveTo && !validDate(input.effectiveTo)))
      fail(400, '任职有效期不正确');
    if (!['primary', 'exchange'].includes(input.assignmentType || 'primary'))
      fail(400, '任职类型不正确');
    if (input.effectiveTo && input.effectiveTo <= input.effectiveFrom)
      fail(400, '任职有效期不正确');
    const member = await repository.memberRow(memberId);
    if (!member) fail(404, '成员不存在');
    const { context } = await requireMemberPermission(actor, member);
    const targetState = await editableMember(repository, context, member, evaluate);
    await requireMemberPermission(actor, member, { departmentIds: [input.departmentId] });
    const unit = (await repository.listDepartments()).find(
      (item) => item.id === input.departmentId
    );
    if (!unit) fail(400, '请选择有效组织');
    if (input.assignmentType === 'exchange' && unit.code !== 'hardware')
      fail(400, '交流参与必须指向硬件部');
    if (!positionsFor(unit).includes(input.positionCode || 'member')) fail(400, '职位与组织不匹配');
    input = {
      ...input,
      assignmentType: input.assignmentType || 'primary',
      positionCode: input.positionCode || 'member',
      isPrimary: (input.assignmentType || 'primary') === 'primary'
    };
    if (
      globalLeadershipPositions.includes(input.positionCode) &&
      !['campus-nanhu', 'campus-hunnan'].every(
        (campusId) => evaluate(context, 'members.manage', { campusId }).allowed
      )
    )
      fail(403, '跨校区管理任职须由具有全部校区管理范围的负责人设置');
    const existing = await repository.listMemberships(memberId);
    if (input.replacesMembershipId) {
      const previous = existing.find((item) => item.id === input.replacesMembershipId);
      if (
        !input.isPrimary ||
        !previous?.isPrimary ||
        previous.effectiveFrom >= input.effectiveFrom ||
        (previous.effectiveTo && previous.effectiveTo < input.effectiveFrom)
      )
        fail(409, '接替任职或生效日期不正确');
      input.replacesRevision = previous.revision;
    }
    if (
      input.isPrimary &&
      existing.some(
        (item) =>
          item.id !== input.replacesMembershipId &&
          item.isPrimary &&
          item.effectiveFrom < (input.effectiveTo || '9999-12-31') &&
          (!item.effectiveTo || input.effectiveFrom < item.effectiveTo)
      )
    )
      fail(409, '主部门任职重叠，请先结束原任职后再调岗');
    const result = await repository.addMembership(memberId, input, input.revision, {
      actorMemberId: context.actor.memberId,
      actorAccount: actor.account,
      authVersion: context.authVersion,
      action: 'organization.membership.updated',
      targetAccountVersion: targetState.account,
      after: input,
      requestId: input.requestId
    });
    if (!result) fail(409, '成员版本或任职范围已变化，请刷新');
    return result;
  }

  async function memberAudit(actor, memberId) {
    const member = await repository.memberRow(memberId);
    if (!member) fail(404, '成员不存在');
    const { context, memberships } = await requireMemberPermission(actor, member);
    if (!canReadMemberAudit(context, member, memberships))
      fail(403, '完整人员审计需要覆盖两个校区的管理权限');
    return { items: await repository.memberAudit(memberId) };
  }

  async function endMembership(actor, memberId, membershipId, input) {
    if (!Number.isInteger(input?.revision) || input.revision < 0 || !validDate(input.effectiveTo))
      fail(400, '任职版本或结束日期不正确');
    const existing = (await repository.listMemberships(memberId)).find(
      (item) => item.id === membershipId
    );
    if (!existing) fail(404, '任职关系不存在');
    const member = await repository.memberRow(memberId);
    if (!member) fail(404, '成员不存在');
    const { context } = await requireMemberPermission(actor, member, {
      departmentIds: [existing.departmentId]
    });
    const targetState = await editableMember(repository, context, member, evaluate);
    if (input.effectiveTo <= existing.effectiveFrom) fail(400, '任职结束日期必须晚于生效日期');
    const result = await repository.endMembership(
      memberId,
      membershipId,
      input.effectiveTo,
      input.revision,
      {
        actorMemberId: context.actor.memberId,
        actorAccount: actor.account,
        authVersion: context.authVersion,
        action: 'organization.membership.ended',
        targetAccountVersion: targetState.account,
        sourceRef: publicResourceRef('organization', 'membership', membershipId),
        before: existing,
        after: { ...existing, effectiveTo: input.effectiveTo },
        requestId: input.requestId,
        reason: input.reason
      }
    );
    if (!result) fail(409, '任职已被其他操作修改，请刷新');
    return result;
  }

  async function importEducation(actor, input) {
    const context = await contextFor(actor);
    if (!context.permissions['members.manage']) fail(403, '缺少权限：members.manage');
    if (typeof input.csv !== 'string' || input.csv.length > 120000) fail(400, '名单文件过大');
    const rows = csvRows(String(input.csv || '').replace(/^\uFEFF/, ''));
    if (rows.length < 2 || rows.length > 201) fail(400, '每次请导入 1 至 200 名成员');
    const headers = rows.shift().map((value) => value.trim());
    if (headers.join(',') !== 'studentId,college') fail(400, '请使用 studentId,college 两列表头');
    const seen = new Set();
    const items = [];
    for (const [index, cells] of rows.entries()) {
      if (cells.length !== headers.length) fail(400, `第 ${index + 2} 行列数不正确`);
      const [studentId, enteredCollege] = cells.map((value) => value.trim());
      if (!/^\d{6,20}$/.test(studentId) || enteredCollege.length > 100)
        fail(400, `第 ${index + 2} 行学号或学院不正确`);
      if (seen.has(studentId)) fail(400, `学号 ${studentId} 重复`);
      seen.add(studentId);
      const mappedCollege = input.collegeByStudentId?.[studentId];
      const college =
        (typeof mappedCollege === 'string' ? mappedCollege.trim() : '') || enteredCollege;
      if (input.confirm && (!college || college.length > 100))
        fail(400, `请补全学号 ${studentId} 的学院`);
      const member = (await repository.listMembers({ studentId }))[0];
      if (!member) fail(400, `第 ${index + 2} 行学号未匹配到成员`);
      await requireMemberPermission(actor, member);
      await editableMember(repository, context, member, evaluate);
      items.push({
        memberId: member.memberId,
        studentId,
        name: member.name,
        major: member.major,
        college,
        revision: member.revision,
        oldCollege: member.college,
        oldMajor: member.major
      });
    }
    const previewToken = await tokenDigest(
      JSON.stringify(
        items.map(({ memberId, studentId, major, college, revision }) => ({
          memberId,
          studentId,
          major,
          college,
          revision
        }))
      )
    );
    if (!input.confirm) return { mode: 'preview', items, previewToken };
    if (input.previewToken !== previewToken) fail(409, '导入内容已变化，请重新预览');
    if (
      !items.every(
        (item) =>
          Number.isInteger(input.expectedRevisions?.[item.studentId]) &&
          input.expectedRevisions[item.studentId] === item.revision
      )
    )
      fail(409, '成员资料已变化，请重新预览');
    try {
      await repository.importEducation(items, {
        actorMemberId: context.actor.memberId,
        actorAccount: actor.account,
        authVersion: context.authVersion,
        action: 'identity.education.imported',
        sourceRef: publicResourceRef(
          'identity',
          'education-import',
          input.requestId || crypto.randomUUID()
        ),
        after: { count: items.length },
        requestId: input.requestId
      });
    } catch (error) {
      if (/integer overflow/.test(String(error.message))) fail(409, '成员或权限已变化，请重新预览');
      throw error;
    }
    return { mode: 'confirmed', count: items.length };
  }
  return {
    memberTarget,
    memberList,
    memberDetail,
    memberAudit,
    updateMember,
    ownProfile,
    addMembership,
    endMembership,
    importMembers,
    createMember,
    importEducation
  };
}
