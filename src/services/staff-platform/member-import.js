import { fail } from '../../lib/http.js';
import { validDate } from '../../platform/time.js';
import { publicResourceRef, stableJson } from '../../platform/contracts.js';
import { memberPublic, activeAt } from '../../modules/identity/public.js';
import { campusId } from '../../modules/authorization/scopes.js';
import { csvRows, inputString, tokenDigest } from './shared.js';
import { editableMemberState, delegationScope, delegableRole } from './delegation.js';

const campusName = (id) => (id === 'campus-hunnan' ? '浑南' : '南湖');
const sorted = (items) => [...new Set(items)].sort();
const list = (value) => {
  if (value === undefined || value === '') return [];
  if (!Array.isArray(value) && typeof value !== 'string') fail(400, '名单配置不正确');
  const items = Array.isArray(value) ? value : value.split('|');
  if (items.some((item) => typeof item !== 'string')) fail(400, '名单配置不正确');
  return sorted(items.map((item) => item.trim()).filter(Boolean));
};
const scopeKey = (scope) =>
  stableJson(
    Object.fromEntries(
      Object.entries(scope).map(([key, value]) => [
        key,
        Array.isArray(value) ? sorted(value) : value
      ])
    )
  );

function normalizeMember(row, defaults, businessDate) {
  const value = (key) => row[key] || defaults[key];
  const item = {
    studentId: inputString(row, 'studentId', 20, true),
    name: inputString(row, 'name', 80, true),
    homeCampusId: value('homeCampusId'),
    college: inputString(row, 'college', 100) || undefined,
    major: inputString(row, 'major', 100) || undefined,
    departmentId: value('departmentId') || '',
    assignmentType: value('assignmentType') || 'primary',
    effectiveFrom: value('effectiveFrom') || businessDate,
    workProfiles: list(value('workProfiles')),
    roleCodes: list(value('roleCodes')),
    authorizedCampuses: sorted(list(value('authorizedCampuses')).map(campusId)),
    trainingConfirmed: value('trainingConfirmed') === true || value('trainingConfirmed') === 'true',
    accountRole: value('accountRole') || ''
  };
  if (
    !/^\d{6,20}$/.test(item.studentId) ||
    !['campus-nanhu', 'campus-hunnan'].includes(item.homeCampusId)
  )
    fail(400, '学号或所属校区不正确');
  if (
    !validDate(item.effectiveFrom) ||
    !['primary', 'secondary', 'exchange', 'temporary'].includes(item.assignmentType)
  )
    fail(400, '任职类型或生效日期不正确');
  if (item.workProfiles.some((code) => !['repair', 'exchange', 'office'].includes(code)))
    fail(400, '工作资格不正确');
  if (item.authorizedCampuses.some((id) => !['campus-nanhu', 'campus-hunnan'].includes(id)))
    fail(400, '授权校区不正确');
  if (item.accountRole && !['technician', 'admin'].includes(item.accountRole))
    fail(400, '账号类型不正确');
  if (item.workProfiles.includes('exchange')) {
    if (!item.trainingConfirmed || item.workProfiles.includes('repair'))
      fail(400, '请确认交流培训通过，且不能同时导入普通维修资格');
    item.roleCodes = sorted(
      item.roleCodes.map((code) => (code === 'technician' ? 'exchange' : code))
    );
  }
  if (item.accountRole === 'admin' && (!item.roleCodes.length || !item.authorizedCampuses.length))
    fail(400, '管理员邀请必须明确配置角色和授权校区');
  return item;
}

function parseImport(input, businessDate) {
  if (typeof input.csv !== 'string' || input.csv.length > 1024 * 1024)
    fail(400, '成员导入内容不正确');
  const rows = csvRows(input.csv.replace(/^\uFEFF/, ''));
  if (rows.length < 2 || rows.length > 201) fail(400, '每次请导入 1 至 200 名成员');
  const headers = rows.shift().map((header) => header.trim());
  if (headers.includes('accountTargets'))
    fail(400, '一个成员只允许一个登录账号，请移除 accountTargets 列');
  const known = [
    'studentId',
    'name',
    'homeCampusId',
    'college',
    'major',
    'departmentId',
    'assignmentType',
    'effectiveFrom',
    'workProfiles',
    'roleCodes',
    'authorizedCampuses',
    'trainingConfirmed',
    'accountRole'
  ];
  if (new Set(headers).size !== headers.length || headers.some((header) => !known.includes(header)))
    fail(400, '导入表头包含重复或未知字段');
  for (const key of ['studentId', 'name'])
    if (!headers.includes(key)) fail(400, `缺少导入列：${key}`);
  const items = rows.map((cells, index) => {
    if (cells.length !== headers.length) fail(400, `第 ${index + 2} 行列数不正确`);
    try {
      return normalizeMember(
        Object.fromEntries(headers.map((header, column) => [header, cells[column].trim()])),
        input.defaults || {},
        businessDate
      );
    } catch (error) {
      if (error.status === 400) fail(400, `第 ${index + 2} 行：${error.message}`);
      throw error;
    }
  });
  if (new Set(items.map((item) => item.studentId)).size !== items.length)
    fail(400, '导入文件包含重复学号');
  return items;
}

export function memberImportDomain({ repository, contextFor, evaluate }) {
  async function prepare(actor, input, single = false) {
    const context = await contextFor(actor);
    if (!context.permissions['members.manage']) fail(403, '缺少权限：members.manage');
    if (input.accountCampusAction && !['preserve', 'replace'].includes(input.accountCampusAction))
      fail(400, '账号校区更新方式不正确');
    const items = single
      ? [normalizeMember(input, {}, context.businessDate)]
      : parseImport(input, context.businessDate);
    const [snapshot, roles, departments] = await Promise.all([
      repository.memberImportSnapshot(items.map((item) => item.studentId)),
      repository.listRoles(),
      repository.listDepartments()
    ]);
    const data = snapshot.data;
    const byStudent = new Map(data.members.map((member) => [member.student_id, member]));
    const byRole = new Map(roles.filter((role) => role.enabled).map((role) => [role.code, role]));
    const byDepartment = new Map(departments.map((department) => [department.id, department]));
    const plans = items.map((item) => {
      const existing = byStudent.get(item.studentId);
      if (item.departmentId && !byDepartment.has(item.departmentId))
        fail(400, '请选择启用的实际部门');
      if (item.roleCodes.some((code) => code === 'superadmin' || !byRole.has(code)))
        fail(400, '角色不存在、已停用或不能通过名单导入');
      const memberId = existing?.id || `member-${item.studentId}`;
      const accounts = data.accounts.filter((account) => account.member_id === memberId);
      if (accounts.length > 1) fail(409, '成员关联多个登录账号，导入已停止');
      const account = accounts[0] || null;
      const memberships = data.memberships.filter(
        (membership) => membership.member_id === memberId
      );
      const profiles = data.profiles.filter((profile) => profile.member_id === memberId);
      const bindings = data.bindings.filter((binding) => binding.member_id === memberId);
      const currentMemberships = memberships
        .filter((membership) =>
          activeAt(membership.effective_from, membership.effective_to, context.businessDate)
        )
        .map((membership) => ({ departmentId: membership.department_id }));
      const target = (member, departmentIds) => ({
        id: memberId,
        memberId,
        campusId: member.homeCampusId || member.home_campus_id,
        departmentIds
      });
      if (
        !evaluate(
          context,
          'members.manage',
          target(item, item.departmentId ? [item.departmentId] : [])
        ).allowed
      )
        fail(403, '导入包含管理范围外的成员');
      let targetState = { account, campuses: [item.homeCampusId] };
      if (existing) {
        if (
          !evaluate(
            context,
            'members.manage',
            target(
              existing,
              currentMemberships.map((membership) => membership.departmentId)
            )
          ).allowed
        )
          fail(403, '导入包含管理范围外的成员');
        targetState = editableMemberState(context, existing, account, currentMemberships, evaluate);
      }
      if (single && existing)
        fail(409, '学号已存在，请打开现有人员更新', 'MEMBER_EXISTS', {
          memberId: existing.id,
          name: existing.name
        });
      const plan = {
        ...item,
        memberId,
        account: account?.account || '',
        before: existing ? memberPublic(existing) : null,
        member: {
          name: item.name,
          homeCampusId: item.homeCampusId,
          college: item.college ?? existing?.college ?? '',
          major: item.major ?? existing?.major ?? ''
        },
        roleScope: {
          campusIds: sorted(
            item.authorizedCampuses.length ? item.authorizedCampuses : targetState.campuses
          )
        },
        changes: [],
        conflicts: [],
        membership: null,
        addProfiles: [],
        addRoles: [],
        invitation: false,
        updateAccountCampuses: false,
        accountTargets: [],
        authChanged: false,
        syncAccount: false
      };
      const change = (field, label, before, after) =>
        plan.changes.push({ field, label, before, after });
      for (const [field, label, oldField] of [
        ['name', '姓名', 'name'],
        ['homeCampusId', '所属校区', 'home_campus_id'],
        ['college', '学院', 'college'],
        ['major', '专业', 'major']
      ]) {
        if ((existing?.[oldField] || '') !== plan.member[field])
          change(field, label, existing?.[oldField] || '', plan.member[field]);
      }
      if (
        item.departmentId &&
        !memberships.some(
          (membership) =>
            membership.department_id === item.departmentId &&
            membership.assignment_type === item.assignmentType &&
            membership.is_primary === (item.assignmentType === 'primary' ? 1 : 0) &&
            membership.effective_from <= item.effectiveFrom &&
            !membership.effective_to
        )
      ) {
        if (
          item.assignmentType === 'primary' &&
          memberships.some(
            (membership) =>
              membership.is_primary &&
              (!membership.effective_to || item.effectiveFrom < membership.effective_to)
          )
        )
          plan.conflicts.push('主部门任职重叠，请在人员详情中结束原任职后再调岗');
        else {
          plan.membership = {
            departmentId: item.departmentId,
            assignmentType: item.assignmentType
          };
          change(
            'membership',
            '新增任职',
            '',
            `${byDepartment.get(item.departmentId).name} · ${{ primary: '主要任职', secondary: '兼任', exchange: '交流', temporary: '临时' }[item.assignmentType]} · ${item.effectiveFrom} 起`
          );
        }
      }
      for (const code of item.workProfiles) {
        const matches = profiles.filter((profile) => profile.profile_code === code);
        if (
          matches.some(
            (profile) => profile.effective_from <= item.effectiveFrom && !profile.effective_to
          )
        )
          continue;
        if (
          matches.some(
            (profile) => !profile.effective_to || item.effectiveFrom < profile.effective_to
          )
        ) {
          plan.conflicts.push('工作资格有效期重叠，请在人员详情中调整');
          continue;
        }
        delegationScope(
          context,
          'members.manage',
          { campusIds: targetState.campuses },
          { effectiveFrom: item.effectiveFrom }
        );
        plan.addProfiles.push(code);
        change(
          'workProfile',
          '新增工作资格',
          '',
          { repair: '普通维修', exchange: '交流人员', office: '办公人员' }[code]
        );
      }
      for (const code of item.roleCodes) {
        const role = byRole.get(code);
        const matches = bindings.filter(
          (binding) =>
            binding.role_id === role.id &&
            (!binding.effective_to || binding.effective_to > item.effectiveFrom)
        );
        if (
          matches.some(
            (binding) =>
              binding.effective_from <= item.effectiveFrom &&
              !binding.effective_to &&
              scopeKey(JSON.parse(binding.scope_bindings)) === scopeKey(plan.roleScope)
          )
        )
          continue;
        if (matches.length) {
          plan.conflicts.push(`“${role.name}”已有不同范围或有效期的授权，请在人员详情中调整`);
          continue;
        }
        delegableRole(
          context,
          role,
          { scope: plan.roleScope, effectiveFrom: item.effectiveFrom },
          targetState
        );
        plan.addRoles.push({ id: role.id, code: role.code });
        change(
          'role',
          '新增角色授权',
          '',
          `${role.name} · ${plan.roleScope.campusIds.map(campusName).join('、')} · ${item.effectiveFrom} 起`
        );
      }
      const campuses = item.authorizedCampuses.map(campusName).sort();
      // A blank CSV cell always preserves existing authorization. Replacing a
      // login scope requires a separate selection and a matching preview token.
      if (
        account &&
        campuses.length &&
        input.accountCampusAction === 'replace' &&
        stableJson(campuses) !== stableJson(JSON.parse(account.campuses).sort())
      ) {
        for (const id of sorted([...targetState.campuses, ...item.authorizedCampuses]))
          if (!evaluate(context, 'accounts.manage', { campusId: id }).allowed)
            fail(403, '缺少该校区的账号管理权限');
        plan.updateAccountCampuses = true;
        plan.accountTargets = [account.account];
        change(
          'accountCampuses',
          '替换登录授权校区',
          JSON.parse(account.campuses).sort().join('、'),
          campuses.join('、')
        );
      }
      if (!account && item.roleCodes.length && campuses.length) {
        const invitation = data.invitations.find(
          (invitation) => invitation.student_id === item.studentId
        );
        const binding = data.activationBindings.find(
          (binding) => binding.student_id === item.studentId
        );
        if (binding && binding.member_id !== memberId)
          plan.conflicts.push('激活资格已关联其他人员，请核对现有资料');
        if (invitation && invitation.status !== 'open')
          plan.conflicts.push('已有激活资格已关闭，请从激活与账号中处理');
        if (
          !invitation ||
          invitation.expected_name !== item.name ||
          invitation.expected_role !== (item.accountRole || 'technician') ||
          stableJson(JSON.parse(invitation.campuses).sort()) !== stableJson(campuses) ||
          !binding
        ) {
          for (const id of sorted([
            ...item.authorizedCampuses,
            ...JSON.parse(invitation?.campuses || '[]').map(campusId)
          ]))
            if (!evaluate(context, 'accounts.manage', { campusId: id }).allowed)
              fail(403, '缺少激活资格的账号管理权限');
          plan.invitation = true;
          change(
            'invitation',
            '激活资格',
            invitation
              ? `${invitation.expected_name} · ${JSON.parse(invitation.campuses).join('、')}`
              : '未设置',
            `${item.name} · ${campuses.join('、')}`
          );
        }
      }
      plan.authorizedCampuses = campuses;
      plan.syncAccount =
        !!account &&
        (account.name !== item.name || account.home_campus !== campusName(item.homeCampusId));
      if (plan.syncAccount && !plan.changes.length)
        change('accountProfile', '同步账号资料', account.name, item.name);
      plan.authChanged = !!(
        plan.membership ||
        plan.addProfiles.length ||
        plan.addRoles.length ||
        plan.updateAccountCampuses ||
        (existing && existing.home_campus_id !== item.homeCampusId)
      );
      plan.status = plan.conflicts.length
        ? 'conflict'
        : !existing
          ? 'created'
          : plan.changes.length
            ? 'updated'
            : 'skipped';
      return plan;
    });
    const versions = roles
      .filter((role) => items.some((item) => item.roleCodes.includes(role.code)))
      .map(({ id, revision, enabled }) => ({ id, revision, enabled }));
    const departmentVersions = departments
      .filter((department) => items.some((item) => item.departmentId === department.id))
      .map(({ id, revision }) => ({ id, revision }));
    const previewToken = await tokenDigest(
      stableJson({
        actor: context.actor.memberId,
        authVersion: context.authVersion,
        plans,
        snapshot: snapshot.guard.value,
        versions,
        departmentVersions
      })
    );
    return {
      context,
      plans,
      previewToken,
      auditRecord: {
        actorMemberId: context.actor.memberId,
        actorAccount: actor.account,
        authVersion: context.authVersion,
        roleVersions: versions,
        departmentVersions,
        importGuard: snapshot.guard,
        action: 'identity.members.imported',
        sourceRef: publicResourceRef('identity', 'import', input.requestId || crypto.randomUUID()),
        requestId: input.requestId
      }
    };
  }

  async function write(actor, prepared) {
    const { plans, auditRecord } = prepared;
    if (plans.some((plan) => plan.status === 'conflict'))
      fail(409, '名单存在冲突，请处理后重新预览');
    try {
      return await repository.importMembers(plans, actor.account, auditRecord);
    } catch (error) {
      if (
        /integer overflow|PRIMARY_MEMBERSHIP_OVERLAP|UNIQUE constraint/.test(String(error.message))
      )
        fail(409, '成员、任职或授权已变化，请重新预览后导入');
      throw error;
    }
  }

  async function importMembers(actor, input) {
    const prepared = await prepare(actor, input);
    const { plans, previewToken } = prepared;
    const items = plans.map((plan) => ({
      memberId: plan.memberId,
      studentId: plan.studentId,
      ...plan.member,
      departmentId: plan.departmentId,
      workProfiles: plan.workProfiles,
      roleCodes: plan.roleCodes,
      authorizedCampuses: plan.authorizedCampuses,
      accountRole: plan.accountRole,
      updateAccountCampuses: plan.updateAccountCampuses,
      accountTargets: plan.accountTargets,
      status: plan.status,
      changes: plan.changes,
      conflicts: plan.conflicts
    }));
    const summary = Object.fromEntries(
      ['created', 'updated', 'skipped', 'conflict'].map((status) => [
        status,
        plans.filter((plan) => plan.status === status).length
      ])
    );
    if (!input.confirm) return { mode: 'preview', items, summary, previewToken, warnings: [] };
    if (input.previewToken !== previewToken) fail(409, '名单或人员资料已变化，请重新预览后确认');
    await write(actor, prepared);
    return {
      mode: 'confirmed',
      items,
      summary,
      count: summary.created + summary.updated,
      requestId: input.requestId || ''
    };
  }

  async function createMember(actor, input) {
    const prepared = await prepare(actor, input, true);
    const [row] = await write(actor, prepared);
    return { member: memberPublic(row) };
  }
  return { importMembers, createMember };
}
