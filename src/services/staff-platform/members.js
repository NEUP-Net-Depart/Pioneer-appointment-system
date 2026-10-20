import { fail } from '../../lib/http.js';
import { dateKey, validDate } from '../../platform/time.js';
import { publicResourceRef, SCHEMA_VERSION } from '../../platform/contracts.js';
import { memberPublic } from '../../modules/identity/public.js';
import { staffIdentities } from '../../../shared/staff-identities.js';
import { inputString, csvRows } from './shared.js';

export function membersDomain({ repository, platform, contextFor, evaluate }) {
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
    if (!evaluate(context, 'members.manage', memberTarget(member, memberships, overrides)).allowed)
      fail(403, '缺少权限：members.manage');
    return { context, memberships };
  }

  function memberCursor(member) {
    return encodeURIComponent(JSON.stringify([member.name, member.memberId]));
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
    const withIdentities = async (items) => {
      const contexts = await repository.fieldContexts(
        items.map((item) => item.memberId),
        context.businessDate
      );
      return items.map((item) => ({
        ...item,
        identities: staffIdentities(contexts.get(item.memberId), platform.authorizer)
      }));
    };
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
        if (!evaluate(context, 'members.manage', memberTarget(item, memberships)).allowed) continue;
        items.push({ ...item, memberships });
        if (items.length === 101)
          return {
            items: await withIdentities(items.slice(0, 100)),
            nextCursor: memberCursor(items[99]),
            schemaVersion: SCHEMA_VERSION
          };
      }
      if (candidates.length < 101)
        return {
          items: await withIdentities(items),
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
    await requireMemberPermission(actor, target);
    if (!validDate(businessDate)) fail(400, '业务日期不正确');
    const [memberMemberships, workProfiles, account, contexts] = await Promise.all([
      repository.listMemberships(memberId),
      repository.profileHistory(memberId),
      repository.accountForMember(memberId),
      repository.fieldContexts([memberId], businessDate)
    ]);
    return {
      bindings: await repository.roleBindings(memberId),
      member: {
        ...memberPublic(target, { memberships: memberMemberships, profiles: workProfiles }),
        identities: staffIdentities(contexts.get(memberId), platform.authorizer)
      },
      account: account
        ? {
            account: account.account,
            status: account.status,
            protected: !!account.protected,
            role: account.role,
            authVersion: account.auth_version || 0
          }
        : null
    };
  }

  async function saveWorkProfile(actor, memberId, input) {
    const member = await repository.memberRow(memberId);
    if (!member) fail(404, '成员不存在');
    const { context } = await requireMemberPermission(actor, member);
    if (actor.role !== 'superadmin') fail(403, '工作资格和交流培训结果由最高管理员确认');
    if (!Number.isInteger(input.revision) || input.revision < 0) fail(400, '成员版本不正确');
    let before = null;
    const reason = inputString(input, 'reason', 300),
      receipt = input.requestId;
    if (input.id) {
      before = (await repository.profileHistory(memberId)).find((item) => item.id === input.id);
      if (!before) fail(404, '工作资格不存在');
      if (
        !Number.isInteger(input.profileRevision) ||
        input.profileRevision < 0 ||
        !validDate(input.effectiveTo) ||
        input.effectiveTo < before.effectiveFrom
      )
        fail(400, '资格结束日期或版本不正确');
      if (before.effectiveTo && input.effectiveTo > before.effectiveTo)
        fail(400, '已结束资格不能延长，请新增审核记录');
      input = {
        id: before.id,
        effectiveTo: input.effectiveTo,
        profileRevision: input.profileRevision,
        revision: input.revision
      };
    } else {
      if (
        !['repair', 'exchange', 'office'].includes(input.profileCode) ||
        !validDate(input.effectiveFrom) ||
        (input.effectiveTo &&
          (!validDate(input.effectiveTo) || input.effectiveTo <= input.effectiveFrom))
      )
        fail(400, '工作资格或有效期不正确');
      if (input.profileCode === 'exchange' && input.trainingConfirmed !== true)
        fail(400, '请先确认交流人员已通过维修培训');
    }
    const result = await repository.saveWorkProfile(memberId, input, input.revision, {
      actorMemberId: context.actor.memberId,
      actorAccount: actor.account,
      authVersion: context.authVersion,
      action: before ? 'identity.qualification.ended' : 'identity.qualification.granted',
      before,
      after: input,
      reason,
      requestId: receipt
    });
    if (!result) fail(409, '成员或资格已变化，或有效期与已有资格重叠，请刷新后重试');
    return { items: result, authVersionChanged: true };
  }

  async function updateMember(actor, memberId, input) {
    const before = await repository.memberRow(memberId);
    if (input.status === 'inactive' && (await repository.accountForMember(memberId))?.protected)
      fail(403, '受保护的负责人不能停用');
    if (!before) fail(404, '成员不存在');
    const { context } = await requireMemberPermission(actor, before);
    if (input.homeCampusId)
      await requireMemberPermission(actor, before, { campusId: input.homeCampusId });
    if (!Number.isInteger(input?.revision) || input.revision < 0) fail(400, '成员版本不正确');
    const patch = {};
    if (input.name !== undefined) patch.name = inputString(input, 'name', 80, true);
    if (input.studentId !== undefined)
      patch.studentId = input.studentId ? inputString(input, 'studentId', 40, true) : '';
    if (input.homeCampusId !== undefined) {
      patch.homeCampusId = inputString(input, 'homeCampusId', 80, true);
      if (!['campus-nanhu', 'campus-hunnan'].includes(patch.homeCampusId))
        fail(400, '所属校区不正确');
    }
    if (input.status !== undefined) {
      if (!['active', 'inactive'].includes(input.status)) fail(400, '成员状态不正确');
      patch.status = input.status;
    }
    const after = await repository.updateMember(memberId, patch, input.revision, {
      actorMemberId: context.actor.memberId,
      actorAccount: actor.account,
      authVersion: context.authVersion,
      action: 'identity.member.updated',
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

  async function addMembership(actor, memberId, input) {
    if (!Number.isInteger(input?.revision) || input.revision < 0) fail(400, '成员版本不正确');
    for (const key of ['departmentId', 'effectiveFrom']) inputString(input, key, 80, true);
    if (!validDate(input.effectiveFrom) || (input.effectiveTo && !validDate(input.effectiveTo)))
      fail(400, '任职有效期不正确');
    if (
      !['primary', 'secondary', 'exchange', 'temporary'].includes(
        input.assignmentType || 'secondary'
      )
    )
      fail(400, '任职类型不正确');
    if (input.effectiveTo && input.effectiveTo <= input.effectiveFrom)
      fail(400, '任职有效期不正确');
    const member = await repository.memberRow(memberId);
    if (!member) fail(404, '成员不存在');
    const { context } = await requireMemberPermission(actor, member);
    await requireMemberPermission(actor, member, { departmentIds: [input.departmentId] });
    if (!(await repository.listDepartments()).some((item) => item.id === input.departmentId))
      fail(400, '请选择有效部门');
    const result = await repository.addMembership(memberId, input, input.revision, {
      actorMemberId: context.actor.memberId,
      actorAccount: actor.account,
      authVersion: context.authVersion,
      action: 'organization.membership.updated',
      after: input,
      requestId: input.requestId
    });
    if (!result) fail(409, '成员版本或任职范围已变化，请刷新');
    return result;
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

  async function importMembers(actor, input) {
    const context = await contextFor(actor);
    if (!context.permissions['members.manage']) fail(403, '缺少权限：members.manage');
    const rows = csvRows(String(input.csv || '').replace(/^\uFEFF/, ''));
    if (rows.length < 2) fail(400, '成员导入至少需要表头和一行数据');
    const headers = rows.shift().map((value) => value.trim());
    if (rows.length > 200) fail(400, '每次最多导入 200 名成员，请分批导入');
    const roleCodes = new Set(
      (await repository.listRoles()).filter((role) => role.enabled).map((role) => role.code)
    );
    const departments = new Set((await repository.listDepartments()).map((item) => item.id));
    const index = (key) => headers.indexOf(key);
    for (const key of ['studentId', 'name', 'homeCampusId'])
      if (index(key) < 0) fail(400, `缺少导入列：${key}`);
    const items = rows.map((cells, lineIndex) => {
      if (cells.length !== headers.length) fail(400, `CSV 第 ${lineIndex + 2} 行列数不正确`);
      cells = cells.map((value) => value.trim());
      const item = {
        studentId: cells[index('studentId')],
        name: cells[index('name')],
        homeCampusId: cells[index('homeCampusId')],
        departmentId: index('departmentId') >= 0 ? cells[index('departmentId')] : '',
        assignmentType: index('assignmentType') >= 0 ? cells[index('assignmentType')] : 'primary',
        effectiveFrom: index('effectiveFrom') >= 0 ? cells[index('effectiveFrom')] : dateKey(),
        trainingConfirmed:
          index('trainingConfirmed') >= 0 && cells[index('trainingConfirmed')] === 'true',
        accountRole: index('accountRole') >= 0 ? cells[index('accountRole')] : '',
        accountTargets:
          index('accountTargets') >= 0
            ? cells[index('accountTargets')].split('|').filter(Boolean)
            : [],
        updateAccountCampuses: index('authorizedCampuses') >= 0,
        workProfiles:
          index('workProfiles') >= 0
            ? cells[index('workProfiles')]
                .split('|')
                .map((value) => value.trim())
                .filter(Boolean)
            : [],
        roleCodes:
          index('roleCodes') >= 0
            ? cells[index('roleCodes')]
                .split('|')
                .map((value) => value.trim())
                .filter(Boolean)
            : [],
        authorizedCampuses:
          index('authorizedCampuses') >= 0
            ? cells[index('authorizedCampuses')]
                .split('|')
                .map((value) => value.trim())
                .filter(Boolean)
            : []
      };
      if (
        !/^\d{6,20}$/.test(item.studentId) ||
        !item.name ||
        !['campus-nanhu', 'campus-hunnan'].includes(item.homeCampusId)
      )
        fail(400, `第 ${lineIndex + 2} 行成员数据不正确`);
      if (
        item.workProfiles.some(
          (value) => !['repair', 'exchange', 'office', 'repair_lead', 'office_lead'].includes(value)
        )
      )
        fail(400, `第 ${lineIndex + 2} 行工作属性不正确`);
      if (item.accountRole && !['technician', 'admin'].includes(item.accountRole))
        fail(400, `第 ${lineIndex + 2} 行账号类型不正确`);
      if (
        item.accountRole === 'admin' &&
        (!item.roleCodes.length || !item.authorizedCampuses.length)
      )
        fail(400, `第 ${lineIndex + 2} 行管理员邀请必须明确配置角色和授权校区`);
      if (
        item.authorizedCampuses.some(
          (value) => !['campus-nanhu', 'campus-hunnan', '南湖', '浑南'].includes(value)
        )
      )
        fail(400, `第 ${lineIndex + 2} 行授权校区不正确`);
      if (
        !validDate(item.effectiveFrom) ||
        (item.departmentId && !departments.has(item.departmentId)) ||
        !['primary', 'secondary', 'exchange', 'temporary'].includes(item.assignmentType)
      )
        fail(400, `第 ${lineIndex + 2} 行任职或生效日期不正确`);
      if (
        actor.role !== 'superadmin' &&
        (item.accountRole ||
          item.roleCodes.length ||
          item.workProfiles.length ||
          item.updateAccountCampuses ||
          item.accountTargets.length)
      )
        fail(403, '角色、工作资格和账号校区授权由最高管理员配置');
      if (
        item.workProfiles.includes('exchange') &&
        (!item.trainingConfirmed || item.workProfiles.includes('repair'))
      )
        fail(400, `第 ${lineIndex + 2} 行须确认交流培训通过，且不能同时导入普通维修资格`);
      // Older exchange CSVs used the technician package. Keep accepting them,
      // but bind the distinct exchange role without changing actual membership.
      if (item.workProfiles.includes('exchange'))
        item.roleCodes = [
          ...new Set(item.roleCodes.map((code) => (code === 'technician' ? 'exchange' : code)))
        ];
      if (
        item.roleCodes.some(
          (code) => !roleCodes.has(code) || ['superadmin', 'legacy_admin'].includes(code)
        )
      )
        fail(400, `第 ${lineIndex + 2} 行角色不存在、已停用或不能通过名单导入`);
      return item;
    });
    if (new Set(items.map((item) => item.studentId)).size !== items.length)
      fail(400, '导入文件包含重复学号');
    const previewItems = [];
    for (const item of items) {
      if (
        !evaluate(context, 'members.manage', {
          campusId: item.homeCampusId,
          departmentIds: item.departmentId ? [item.departmentId] : []
        }).allowed
      )
        fail(403, '导入包含管理范围外的成员');
      if (
        actor.role !== 'superadmin' &&
        (item.roleCodes.length ||
          item.workProfiles.length ||
          item.updateAccountCampuses ||
          item.accountTargets.length)
      )
        fail(403, '角色、工作资格和账号校区授权由最高管理员配置');
      const existing = (await repository.listMembers({ studentId: item.studentId }))[0];
      if (existing) await requireMemberPermission(actor, existing);
      const accounts = existing
        ? await repository.accountsForMember(existing.id || existing.memberId)
        : [];
      if (item.accountTargets.length && !item.updateAccountCampuses)
        fail(400, '指定登录账号时必须提供 authorizedCampuses 列');
      if (item.accountTargets.includes('*') && item.accountTargets.length !== 1)
        fail(400, '全部账号标记 * 不能与具体账号混用');
      if (item.accountTargets.some((account) => account !== '*' && !accounts.includes(account)))
        fail(400, '指定的登录账号不属于该成员');
      if (item.updateAccountCampuses && accounts.length > 1 && !item.accountTargets.length)
        fail(400, '多账号成员必须用 accountTargets 指定登录账号，或填写 * 更新全部账号');
      if (item.updateAccountCampuses && accounts.length === 1 && !item.accountTargets.length)
        item.accountTargets = accounts;
      previewItems.push({
        ...item,
        memberId: `member-${item.studentId}`,
        accountTargets: item.accountTargets.includes('*') ? accounts : item.accountTargets
      });
    }
    if (!input.confirm)
      return {
        mode: 'preview',
        items: previewItems,
        warnings: previewItems.flatMap((item) => {
          const messages = [];
          if (!item.roleCodes.length && !item.workProfiles.length)
            messages.push('未设置工作属性或角色，本次导入不会新增工作资格或角色授权');
          if (item.updateAccountCampuses && item.accountTargets.length)
            messages.push(
              item.authorizedCampuses.length
                ? `将替换登录账号 ${item.accountTargets.join('、')} 的校区授权为：${item.authorizedCampuses.join('、')}`
                : `将清空登录账号 ${item.accountTargets.join('、')} 的全部校区授权`
            );
          return messages.map((message) => ({ studentId: item.studentId, message }));
        }),
        requestId: input.requestId || ''
      };
    const memberRows = await repository.importMembers(items, actor.account, {
      actorMemberId: context.actor.memberId,
      actorAccount: actor.account,
      action: 'identity.members.imported',
      sourceRef: publicResourceRef('identity', 'import', input.requestId || crypto.randomUUID()),
      after: { count: items.length },
      requestId: input.requestId
    });
    const byStudentId = Object.fromEntries(memberRows.map((row) => [row.student_id, row]));
    const result = items.map((item) => ({
      memberId: byStudentId[item.studentId]?.id || `member-${item.studentId}`,
      studentId: item.studentId,
      name: item.name,
      status: 'updated'
    }));
    return {
      mode: 'confirmed',
      items: result,
      count: result.length,
      requestId: input.requestId || ''
    };
  }
  return {
    memberTarget,
    memberList,
    memberDetail,
    saveWorkProfile,
    updateMember,
    addMembership,
    endMembership,
    importMembers
  };
}
