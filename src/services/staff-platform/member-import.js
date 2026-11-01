import { fail } from '../../lib/http.js';
import { validDate } from '../../platform/time.js';
import { publicResourceRef, stableJson } from '../../platform/contracts.js';
import { memberPublic, activeAt, businessIdentityEligible } from '../../modules/identity/public.js';
import { campusId, intersectScopes } from '../../modules/authorization/scopes.js';
import { createAuthorizer } from '../../modules/authorization/public.js';
import {
  positionsFor,
  positionLabels,
  organizationRoles
} from '../../../shared/staff-organization.js';
import { csvRows, inputString, tokenDigest } from './shared.js';
import { editableMemberState, delegationScope } from './delegation.js';

const campusName = (id) => (id === 'campus-hunnan' ? '浑南' : '南湖');
const sorted = (items) => [...new Set(items)].sort();
const list = (value) => {
  if (value === undefined || value === '') return [];
  if (!Array.isArray(value) && typeof value !== 'string') fail(400, '名单配置不正确');
  const items = Array.isArray(value) ? value : value.split('|');
  if (items.some((item) => typeof item !== 'string')) fail(400, '名单配置不正确');
  return sorted(items.map((item) => item.trim()).filter(Boolean));
};
function normalizeMember(row, defaults, businessDate) {
  if (
    ['workProfiles', 'roleCodes', 'trainingConfirmed', 'accountRole', 'assignmentType'].some(
      (key) => row[key] !== undefined || defaults[key] !== undefined
    )
  )
    fail(400, '请使用正式部门、职位和交流参与字段');
  const value = (key) => (row[key] !== undefined && row[key] !== '' ? row[key] : defaults[key]);
  const boolean = (key) => {
    const raw = value(key);
    if (![undefined, '', true, false, 'true', 'false'].includes(raw))
      fail(400, '参与或激活选项不正确');
    return raw === true || raw === 'true';
  };
  const item = {
    studentId: inputString(row, 'studentId', 20, true),
    name: inputString(row, 'name', 80, true),
    homeCampusId: value('homeCampusId'),
    homeCampusProvided: !!row.homeCampusId,
    college: inputString(row, 'college', 100) || undefined,
    major: inputString(row, 'major', 100) || undefined,
    departmentId: value('departmentId') || '',
    positionCode: value('positionCode') || 'member',
    exchangeParticipation: boolean('exchangeParticipation'),
    configureActivation: boolean('configureActivation'),
    effectiveFrom: value('effectiveFrom') || businessDate,
    authorizedCampuses: sorted(list(value('authorizedCampuses')).map(campusId))
  };
  if (
    !/^\d{6,20}$/.test(item.studentId) ||
    (item.homeCampusId && !['campus-nanhu', 'campus-hunnan'].includes(item.homeCampusId))
  )
    fail(400, '学号或所属校区不正确');
  if (!validDate(item.effectiveFrom)) fail(400, '生效日期不正确');
  if (item.authorizedCampuses.some((id) => !['campus-nanhu', 'campus-hunnan'].includes(id)))
    fail(400, '授权校区不正确');
  if (item.configureActivation && !item.authorizedCampuses.length) fail(400, '请选择激活授权校区');
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
    'positionCode',
    'exchangeParticipation',
    'configureActivation',
    'effectiveFrom',
    'authorizedCampuses'
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
    if (input.homeCampusAction && !['preserve', 'replace'].includes(input.homeCampusAction))
      fail(400, '所属校区更新方式不正确');
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
    const byDepartment = new Map(departments.map((department) => [department.id, department]));
    const plans = items.map((item) => {
      const existing = byStudent.get(item.studentId);
      if (existing && !item.homeCampusProvided && input.homeCampusAction !== 'replace')
        item.homeCampusId = existing.home_campus_id;
      if (!['campus-nanhu', 'campus-hunnan'].includes(item.homeCampusId))
        fail(400, '请选择有效的所属校区');
      if (item.departmentId && !byDepartment.has(item.departmentId))
        fail(400, '请选择启用的实际部门');
      const unit = byDepartment.get(item.departmentId);
      if (unit && !positionsFor(unit).includes(item.positionCode)) fail(400, '职位与组织不匹配');
      if (
        item.exchangeParticipation &&
        (!unit || unit.code === 'hardware' || unit.kind !== 'department')
      )
        fail(400, '请选择非硬件部的正式所属部门');
      const memberId = existing?.id || `member-${item.studentId}`;
      const accounts = data.accounts.filter((account) => account.member_id === memberId);
      if (accounts.length > 1) fail(409, '成员关联多个登录账号，导入已停止');
      const account = accounts[0] || null;
      const memberships = data.memberships.filter(
        (membership) => membership.member_id === memberId
      );
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
        changes: [],
        conflicts: [],
        memberships: [],
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
      const requested = item.departmentId
        ? [
            {
              departmentId: item.departmentId,
              assignmentType: 'primary',
              positionCode: item.positionCode
            }
          ]
        : [];
      if (item.exchangeParticipation)
        requested.push({
          departmentId: departments.find((unit) => unit.code === 'hardware')?.id,
          assignmentType: 'exchange',
          positionCode: 'member'
        });
      for (const post of requested) {
        const matches = memberships.filter(
          (old) =>
            old.assignment_type === post.assignmentType &&
            (post.assignmentType === 'primary'
              ? old.is_primary === 1
              : old.department_id === post.departmentId)
        );
        const exact = matches.some(
          (old) =>
            old.department_id === post.departmentId &&
            old.position_code === post.positionCode &&
            !old.needs_review &&
            old.effective_from <= item.effectiveFrom &&
            !old.effective_to
        );
        if (exact) continue;
        if (matches.some((old) => !old.effective_to || item.effectiveFrom < old.effective_to)) {
          plan.conflicts.push('正式部门、职位或交流关系与现有记录冲突，请在人员详情中核对');
          continue;
        }
        delegationScope(
          context,
          'members.manage',
          { campusIds: targetState.campuses },
          { effectiveFrom: item.effectiveFrom }
        );
        plan.memberships.push(post);
        change(
          'membership',
          post.assignmentType === 'exchange' ? '交流维修' : '组织任职',
          '',
          `${byDepartment.get(post.departmentId)?.name} · ${positionLabels[post.positionCode]} · ${item.effectiveFrom} 起`
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
      const invitation = data.invitations.find(
        (invitation) => invitation.student_id === item.studentId
      );
      if (!account && campuses.length) {
        if (invitation?.expected_role === 'superadmin') fail(403, '不能管理系统管理员激活资格');
        plan.accountRole = invitation?.expected_role || 'technician';
        plan.invitationStatus = item.configureActivation ? 'open' : invitation?.status || 'revoked';
        const roleLabel = (role) => (role === 'admin' ? '管理员账号' : '普通账号');
        const binding = data.activationBindings.find(
          (binding) => binding.student_id === item.studentId
        );
        if (binding && binding.member_id !== memberId)
          plan.conflicts.push('激活资格已关联其他人员，请核对现有资料');
        if (invitation && invitation.status === 'activated')
          plan.conflicts.push('已有激活资格已关闭，请从激活与账号中处理');
        if (
          !invitation ||
          invitation.status !== plan.invitationStatus ||
          invitation.expected_name !== item.name ||
          invitation.expected_role !== plan.accountRole ||
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
          plan.syncInvitationName =
            invitation?.status === 'open' && invitation.expected_name !== item.name;
          change(
            'invitation',
            '激活资格',
            invitation
              ? `${invitation.expected_name} · ${roleLabel(invitation.expected_role)} · ${JSON.parse(invitation.campuses).join('、')}`
              : '未设置',
            `${item.name} · ${roleLabel(plan.accountRole)} · ${campuses.join('、')}`
          );
        }
      } else if (
        !account &&
        invitation?.status === 'open' &&
        invitation.expected_name !== item.name
      ) {
        const invitationCampuses = JSON.parse(invitation.campuses).map(campusId);
        if (
          !invitationCampuses.length ||
          invitationCampuses.some(
            (id) => !evaluate(context, 'accounts.manage', { campusId: id }).allowed
          )
        )
          plan.conflicts.push('同步待激活姓名需要激活资格所在校区的账号管理权限');
        plan.syncInvitationName = true;
        change('invitationName', '同步待激活姓名', invitation.expected_name, item.name);
      }
      plan.authorizedCampuses = campuses;
      plan.syncAccount =
        !!account &&
        (account.name !== item.name || account.home_campus !== campusName(item.homeCampusId));
      if (plan.syncAccount && !plan.changes.length)
        change('accountProfile', '同步账号资料', account.name, item.name);
      plan.authChanged = !!(
        plan.memberships.length ||
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
    for (const plan of plans.filter(
      (plan) => plan.configureActivation && !plan.account && !plan.conflicts.length
    )) {
      const memberships = [
        ...data.memberships
          .filter((post) => post.member_id === plan.memberId)
          .map((post) => ({
            departmentId: post.department_id,
            positionCode: post.position_code,
            assignmentType: post.assignment_type,
            isPrimary: !!post.is_primary,
            needsReview: !!post.needs_review,
            effectiveFrom: post.effective_from,
            effectiveTo: post.effective_to
          })),
        ...plan.memberships.map((post) => ({
          ...post,
          isPrimary: post.assignmentType === 'primary',
          effectiveFrom: plan.effectiveFrom
        }))
      ];
      const bindings = [
        ...data.bindings
          .filter((binding) => binding.member_id === plan.memberId)
          .map((binding) => ({
            roleId: binding.role_id,
            scope: JSON.parse(binding.scope_bindings),
            effectiveFrom: binding.effective_from,
            effectiveTo: binding.effective_to,
            participation:
              binding.participation_spec === null
                ? undefined
                : JSON.parse(binding.participation_spec)
          })),
        ...memberships.flatMap((post) =>
          organizationRoles(post, byDepartment.get(post.departmentId)).map((code) => ({
            roleId: roles.find((role) => role.code === code)?.id,
            scope: { campuses: 'bound' },
            effectiveFrom: post.effectiveFrom,
            effectiveTo: post.effectiveTo
          }))
        )
      ];
      const grants = bindings.flatMap((binding) => {
        const role = roles.find((role) => role.id === binding.roleId && role.enabled);
        return (role?.grants || []).map((grant) => ({
          ...grant,
          roleCode: role.code,
          binding,
          participation: binding.participation,
          scope: intersectScopes(grant.scope, binding.scope)
        }));
      });
      if (
        !businessIdentityEligible(createAuthorizer(), {
          memberId: plan.memberId,
          status: plan.before?.status || 'active',
          campuses: plan.authorizedCampuses,
          grants,
          memberships,
          authorizationDate: context.authorizationDate || context.businessDate
        })
      )
        fail(400, '配置激活资格需要当前有效任职、交流参与或特殊授权');
    }
    const versions = roles.map(({ id, revision, enabled }) => ({ id, revision, enabled }));
    const departmentVersions = departments
      .filter((department) =>
        items.some(
          (item) =>
            item.departmentId === department.id ||
            (item.exchangeParticipation && department.code === 'hardware')
        )
      )
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
      positionCode: plan.positionCode,
      exchangeParticipation: plan.exchangeParticipation,
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
