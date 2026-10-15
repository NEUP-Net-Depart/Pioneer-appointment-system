import { fail } from '../lib/http.js';
import { dateKey, eventWindow, instant, nowIso, weekRange, validDate } from '../platform/time.js';
import { requestId, stableJson, publicResourceRef, SCHEMA_VERSION } from '../platform/contracts.js';
import { memberPublic } from '../modules/identity/public.js';
import { generateRoster, validateRoster } from '../modules/rosters/solver.js';
import { attendanceMethod, policyFor } from '../modules/attendance/public.js';
import { validScope } from '../modules/authorization/scopes.js';
import { validGrantValidity } from '../modules/authorization/public.js';

function randomToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `att_${Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')}`;
}

function hashPayload(value) {
  let hash = 2166136261;
  const text = stableJson(value);
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

async function tokenDigest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), item => item.toString(16).padStart(2, '0')).join('');
}

function inputString(input, key, max, required = false) {
  const value = input?.[key];
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.trim().length === 0 && required || value.length > max) fail(400, `${key} 格式不正确`);
  return value.trim();
}

function validateGrantValidity(validity) {
  if (!validGrantValidity(validity)) fail(400, '权限有效期不正确');
}

function validateScope(scope) {
  if (!validScope(scope)) fail(400, '权限范围不正确');
}

function validateGrant(definition, grant, actor, authorizer) {
  if (!grant || typeof grant !== 'object' || Array.isArray(grant)) fail(400, '权限配置不正确');
  if (grant.conditions !== undefined && !Array.isArray(grant.conditions)) fail(400, '权限条件必须是数组');
  if (grant.scope !== undefined && (!grant.scope || typeof grant.scope !== 'object' || Array.isArray(grant.scope))) fail(400, '权限范围不正确');
  const scope = grant.scope || {};
  validateScope(scope);
  if (scope.all === true && actor.role !== 'superadmin') fail(403, '普通管理员不能授予全局权限');
  const allowed = new Set(definition.scopeKinds || []);
  if ((scope.campusIds !== undefined || scope.campuses !== undefined) && !allowed.has('campus')) fail(400, '该权限不支持校区范围');
  if ((scope.departmentIds !== undefined || scope.departments !== undefined) && !allowed.has('department')) fail(400, '该权限不支持部门范围');
  if (scope.self !== undefined && !allowed.has('self')) fail(400, '该权限不支持本人范围');
  const conditions = grant.conditions || [];
  if (conditions.some(condition => !authorizer.validCondition(condition))) fail(400, '权限条件、版本或参数不正确');
  for (const required of definition.conditionKinds || []) if (!conditions.some(item => item?.code === required)) fail(400, `权限缺少必要条件：${required}`);
  validateGrantValidity(grant.validity);
}

function publicLeave(row) { return row ? { id: row.id, assignmentId: row.assignment_id, memberId: row.member_id, reason: row.reason, status: row.status, reviewerMemberId: row.reviewer_member_id || '', reviewNote: row.review_note || '', revision: row.revision, createdAt: row.created_at, reviewedAt: row.reviewed_at || null } : null; }
function publicSwap(row) { return row ? { id: row.id, fromAssignmentId: row.from_assignment_id, toAssignmentId: row.to_assignment_id, fromMemberId: row.from_member_id, toMemberId: row.to_member_id, fromRevision: row.from_revision, toRevision: row.to_revision, status: row.status, note: row.note, revision: row.revision, createdAt: row.created_at, decidedAt: row.decided_at || null } : null; }

function csvRows(value) {
  const rows = [], current = []; let cell = '', quoted = false, closed = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quoted) {
      if (char === '"') {
        if (value[index + 1] === '"') { cell += '"'; index += 1; } else { quoted = false; closed = true; }
      } else cell += char;
    } else if (char === '"') {
      if (cell || closed) fail(400, 'CSV 引号格式不正确');
      quoted = true;
    } else if (char === ',') { current.push(cell); cell = ''; closed = false; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && value[index + 1] === '\n') index += 1;
      current.push(cell); cell = ''; closed = false;
      if (current.some(item => item.trim())) rows.push(current.splice(0));
    } else {
      if (closed) fail(400, 'CSV 引号后的内容不正确');
      cell += char;
    }
  }
  if (quoted) fail(400, 'CSV 引号未闭合');
  current.push(cell); if (current.some(item => item.trim())) rows.push(current);
  return rows;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function staffPlatformService({ repository, platform, manifests }) {
  async function contextFor(actor, businessDate = dateKey()) {
    const context = await platform.authContext(actor, { businessDate });
    if (context.member?.status && context.member.status !== 'active') fail(401, '成员已停用，请联系管理员');
    return { ...context, businessDate, actor: { ...context.actor, role: actor.role, authorizedCampuses: actor.authorizedCampuses || [], homeCampus: actor.homeCampus },
      grants: context.grants || [] };
  }

  function evaluate(context, permissionCode, target) {
    return platform.authorizer.evaluate(context.actor, permissionCode, target, context, context.grants);
  }

  async function requirePermission(actor, permissionCode, target = {}, businessDate = dateKey()) {
    const context = await contextFor(actor, businessDate);
    const result = evaluate(context, permissionCode, target);
    if (!result.allowed) fail(403, `缺少权限：${permissionCode}`);
    return { context, result };
  }

  async function withReceipt(actor, action, input, operation) {
    const id = requestId(input?.requestId);
    if (!id) return operation();
    const memberId = (await contextFor(actor)).actor.memberId;
    const hash = hashPayload(input);
    const previous = await repository.receipt(memberId, action, id);
    if (previous) {
      if (previous.payloadHash !== hash) fail(409, '请求编号已用于其他内容', 'REQUEST_CONFLICT');
      if (previous.resultStatus === 'pending') fail(409, '请求正在处理中，请稍后重试', 'REQUEST_CONFLICT');
      return { ...previous.result, idempotent: true, receipt: previous };
    }
    if (!await repository.claimReceipt(memberId, action, id, hash)) {
      const current = await repository.receipt(memberId, action, id);
      if (current?.payloadHash !== hash) fail(409, '请求编号已用于其他内容', 'REQUEST_CONFLICT');
      if (current?.resultStatus === 'pending') fail(409, '请求正在处理中，请稍后重试', 'REQUEST_CONFLICT');
      return { ...current.result, idempotent: true, receipt: current };
    }
    try {
      const result = await operation();
      await repository.createReceipt(memberId, action, id, hash, result, result?.id ? publicResourceRef(action.split('.')[0], action, result.id) : {});
      return result;
    } catch (error) {
      await repository.releaseReceipt(memberId, action, id, hash);
      throw error;
    }
  }

  function memberTarget(member, memberships, overrides = {}) {
    const memberId = member.memberId || member.id;
    return { id: memberId, memberId, campusId: member.homeCampusId ?? member.home_campus_id,
      departmentIds: memberships.map(item => item.departmentId), ...overrides };
  }

  async function requireMemberPermission(actor, member, overrides = {}) {
    const context = await contextFor(actor);
    const memberships = await repository.memberships(member.memberId || member.id, context.businessDate);
    if (!evaluate(context, 'members.manage', memberTarget(member, memberships, overrides)).allowed) fail(403, '缺少权限：members.manage');
    return { context, memberships };
  }

  function memberCursor(member) { return encodeURIComponent(JSON.stringify([member.name, member.memberId])); }
  function parseMemberCursor(value) {
    if (!value) return undefined;
    try {
      if (typeof value !== 'string' || value.length > 2048) throw new Error();
      const parts = JSON.parse(decodeURIComponent(value));
      if (!Array.isArray(parts) || parts.length !== 2 || parts.some(part => typeof part !== 'string') || parts[0].length > 80 || !parts[1] || parts[1].length > 128) throw new Error();
      return { name: parts[0], memberId: parts[1] };
    } catch { fail(400, '成员分页游标不正确'); }
  }

  async function memberList(actor, filters = {}) {
    const context = await contextFor(actor);
    if (!platform.authorizer.eligibleGrants('members.manage', context, context.grants).length) fail(403, '缺少权限：members.manage');
    if (filters.status && !['active', 'inactive'].includes(filters.status)) fail(400, '成员状态不正确');
    const query = { q: inputString(filters, 'q', 120), status: filters.status,
      homeCampusId: inputString(filters, 'homeCampusId', 80), businessDate: context.businessDate };
    let after = parseMemberCursor(filters.cursor);
    const items = [];
    // Scan in bounded database pages, but fill a page with authorized members.
    // The public cursor references only the last returned (visible) member.
    for (;;) {
      const candidates = await repository.listMembers({ ...query, after });
      const membershipItems = await repository.membershipsForMembers(candidates.map(item => item.memberId), context.businessDate);
      const byMember = new Map();
      for (const membership of membershipItems) {
        if (!byMember.has(membership.memberId)) byMember.set(membership.memberId, []);
        byMember.get(membership.memberId).push(membership);
      }
      for (const item of candidates) {
        const memberships = byMember.get(item.memberId) || [];
        if (!evaluate(context, 'members.manage', memberTarget(item, memberships)).allowed) continue;
        items.push({ ...item, memberships });
        if (items.length === 101) return { items: items.slice(0, 100), nextCursor: memberCursor(items[99]), schemaVersion: SCHEMA_VERSION };
      }
      if (candidates.length < 101) return { items, nextCursor: null, schemaVersion: SCHEMA_VERSION };
      const last = candidates.at(-1);
      after = { name: last.name, memberId: last.memberId };
    }
  }

  async function memberDetail(actor, memberId, businessDate = dateKey()) {
    const target = await repository.memberRow(memberId);
    if (!target) fail(404, '成员不存在');
    await requireMemberPermission(actor, target);
    if (!validDate(businessDate)) fail(400, '业务日期不正确');
    const [memberMemberships, workProfiles, account] = await Promise.all([repository.listMemberships(memberId), repository.profiles(memberId, businessDate), repository.accountForMember(memberId)]);
    return { bindings: await repository.roleBindings(memberId), member: memberPublic(target, { memberships: memberMemberships, profiles: workProfiles }), account: account ? { account: account.account, status: account.status, protected: !!account.protected, role: account.role, authVersion: account.auth_version || 0 } : null };
  }

  async function updateMember(actor, memberId, input) {
    const before = await repository.memberRow(memberId);
    if (input.status === 'inactive' && (await repository.accountForMember(memberId))?.protected) fail(403, '受保护的负责人不能停用');
    if (!before) fail(404, '成员不存在');
    const { context } = await requireMemberPermission(actor, before);
    if (input.homeCampusId) await requireMemberPermission(actor, before, { campusId: input.homeCampusId });
    if (!Number.isInteger(input?.revision) || input.revision < 0) fail(400, '成员版本不正确');
    const patch = {};
    if (input.name !== undefined) patch.name = inputString(input, 'name', 80, true);
    if (input.studentId !== undefined) patch.studentId = input.studentId ? inputString(input, 'studentId', 40, true) : '';
    if (input.homeCampusId !== undefined) {
      patch.homeCampusId = inputString(input, 'homeCampusId', 80, true);
      if (!['campus-nanhu', 'campus-hunnan'].includes(patch.homeCampusId)) fail(400, '所属校区不正确');
    }
    if (input.status !== undefined) { if (!['active', 'inactive'].includes(input.status)) fail(400, '成员状态不正确'); patch.status = input.status; }
    const after = await repository.updateMember(memberId, patch, input.revision);
    if (!after) fail(409, '成员已被其他操作修改，请刷新');
    const account = await repository.accountForMember(memberId);
    await repository.audit({ actorMemberId: context.actor.memberId, actorAccount: actor.account, action: 'identity.member.updated', sourceRef: publicResourceRef('identity','member',memberId), before, after, requestId: input.requestId, reason: input.reason });
    return { member: memberPublic(after), revision: after.revision, affectedResources: [{ module: 'identity', type: 'member', id: memberId }], accountStatus: account?.status || '' };
  }

  async function addMembership(actor, memberId, input) {
    if (!Number.isInteger(input?.revision) || input.revision < 0) fail(400, '成员版本不正确');
    for (const key of ['departmentId', 'effectiveFrom']) inputString(input, key, 80, true);
    if (!validDate(input.effectiveFrom) || input.effectiveTo && !validDate(input.effectiveTo)) fail(400, '任职有效期不正确');
    if (!['primary','secondary','exchange','temporary'].includes(input.assignmentType || 'secondary')) fail(400, '任职类型不正确');
    if (input.effectiveTo && input.effectiveTo <= input.effectiveFrom) fail(400, '任职有效期不正确');
    const member = await repository.memberRow(memberId); if (!member) fail(404, '成员不存在');
    await requireMemberPermission(actor, member);
    await requireMemberPermission(actor, member, { departmentIds: [input.departmentId] });
    const result = await repository.addMembership(memberId, input, input.revision);
    if (!result) fail(409, '成员版本或任职范围已变化，请刷新');
    await repository.audit({ actorMemberId: (await contextFor(actor)).actor.memberId, actorAccount: actor.account, action: 'organization.membership.updated', sourceRef: publicResourceRef('organization','membership',result.id), after: result, requestId: input.requestId });
    return result;
  }

  async function endMembership(actor, memberId, membershipId, input) {
    if (!Number.isInteger(input?.revision) || input.revision < 0 || !validDate(input.effectiveTo)) fail(400, '任职版本或结束日期不正确');
    const existing = (await repository.listMemberships(memberId)).find(item => item.id === membershipId);
    if (!existing) fail(404, '任职关系不存在');
    const member = await repository.memberRow(memberId); if (!member) fail(404, '成员不存在');
    await requireMemberPermission(actor, member, { departmentIds: [existing.departmentId] });
    if (input.effectiveTo <= existing.effectiveFrom) fail(400, '任职结束日期必须晚于生效日期');
    const result = await repository.endMembership(memberId, membershipId, input.effectiveTo, input.revision);
    if (!result) fail(409, '任职已被其他操作修改，请刷新');
    const context = await contextFor(actor);
    await repository.audit({ actorMemberId: context.actor.memberId, actorAccount: actor.account, action: 'organization.membership.ended', sourceRef: publicResourceRef('organization','membership',membershipId), before: existing, after: result, requestId: input.requestId, reason: input.reason });
    return result;
  }

  async function permissions(actor) { await requirePermission(actor, 'roles.manage'); return { items: await repository.permissionDefinitions(), conditionProviders: platform.authorizer.conditionDefinitions(), contractVersion: 'staff-platform.v1' }; }
  async function roles(actor) { await requirePermission(actor, 'roles.manage'); return { items: await repository.listRoles() }; }
  async function createRole(actor, input) {
    await requirePermission(actor, 'roles.manage');
    if (actor.role !== 'superadmin') fail(403, '角色配置与分配由最高管理员管理');
    const code = inputString(input, 'code', 80, true); if (!/^[a-z][a-z0-9_.-]+$/.test(code)) fail(400, '角色 code 不正确');
    const name = inputString(input, 'name', 80, true); const level = Number.isSafeInteger(input.level) ? input.level : 1;
    if (level < 1 || level >= (actor.role === 'superadmin' ? 4 : 3)) fail(403, '角色等级超出可管理范围');
    const definitions = Object.fromEntries((await repository.permissionDefinitions()).map(item => [item.code, item]));
    if (input.grants !== undefined && !Array.isArray(input.grants)) fail(400, '权限集合必须是数组');
    if (new Set((input.grants || []).map(grant => grant?.permissionCode)).size !== (input.grants || []).length) fail(400, '角色不能重复绑定同一权限');
    for (const grant of input.grants || []) {
      if (!grant || typeof grant !== 'object') fail(400, '权限配置不正确');
      if (!definitions[grant.permissionCode]) fail(400, `未知权限：${grant.permissionCode || ''}`);
      validateGrant(definitions[grant.permissionCode], grant, actor, platform.authorizer);
    }
    const result = await repository.createRole({ ...input, code, name, level }, actor.account);
    const context = await contextFor(actor);
    await repository.audit({ actorMemberId: context.actor.memberId, actorAccount: actor.account, action: 'authorization.role.created', sourceRef: publicResourceRef('authorization','role',result.id), after: result, requestId: input.requestId });
    return result;
  }
  async function updateRole(actor, id, input) {
    await requirePermission(actor, 'roles.manage');
    if (actor.role !== 'superadmin') fail(403, '角色配置与分配由最高管理员管理');
    if (id === 'role-superadmin') fail(403, '最高管理员权限包受保护');
    if (!Number.isInteger(input.revision)) fail(400, '角色版本不正确');
    if (input.grants !== undefined) {
      if (!Array.isArray(input.grants)) fail(400, '权限集合必须是数组');
      const codes = input.grants.map(grant => grant?.permissionCode);
      if (new Set(codes).size !== codes.length) fail(400, '角色不能重复绑定同一权限');
      const definitions = Object.fromEntries((await repository.permissionDefinitions()).map(item => [item.code, item]));
      if (codes.some(code => !definitions[code])) fail(400, '角色包含未知权限');
      for (const grant of input.grants) validateGrant(definitions[grant.permissionCode], grant, actor, platform.authorizer);
    }
    const result = await repository.updateRole(id, input, input.revision); if (!result) fail(409, '角色已被其他操作修改，请刷新');
    const context = await contextFor(actor);
    await repository.audit({ actorMemberId: context.actor.memberId, actorAccount: actor.account, action: 'authorization.grant.updated', sourceRef: publicResourceRef('authorization','role',id), after: result, requestId: input.requestId });
    return { ...result, authVersionChanged: true };
  }
  async function previewRole(actor, input) {
    const targetMember = await repository.memberRow(input.memberId); if (!targetMember) fail(404, '成员不存在');
    await requirePermission(actor, 'roles.manage', memberTarget(targetMember, await repository.memberships(input.memberId)));
    const targetAccount = await repository.accountForMember(input.memberId);
    if (!targetAccount) fail(400, '该成员尚未关联账号');
    const context = await contextFor({ account: targetAccount.account, role: targetAccount.role, authorizedCampuses: input.campusIds || [] }, input.businessDate || dateKey());
    const grants = input.grants || context.grants;
    const actorView = { ...context.actor, authorizedCampuses: input.campusIds || context.actor.authorizedCampuses };
    return { actor: actorView, grants, results: grants.map(grant => platform.authorizer.evaluate(actorView, grant.permissionCode, input.target || {}, context, [grant])), testedAt: nowIso() };
  }
  async function bindMemberRoles(actor, memberId, input) {
    const member = await repository.memberRow(memberId); if (!member) fail(404, '成员不存在');
    await requirePermission(actor, 'roles.manage', memberTarget(member, await repository.memberships(memberId)));
    if (actor.role !== 'superadmin') fail(403, '角色配置与分配由最高管理员管理');
    if ((await repository.accountForMember(memberId))?.protected) fail(403, '受保护的负责人授权不能更改');
    if (!Number.isInteger(input.revision)) fail(400, '成员版本不正确');
    if (!Array.isArray(input.bindings)) fail(400, '角色绑定必须是数组');
    const roles = Object.fromEntries((await repository.listRoles()).map(role => [role.id, role]));
    if (input.bindings.some(binding => !binding || !roles[binding.roleId])) fail(400, '角色绑定不存在');
    for (const binding of input.bindings) {
      if (binding.scope !== undefined && (!binding.scope || typeof binding.scope !== 'object' || Array.isArray(binding.scope))) fail(400, '角色范围不正确');
      validateScope(binding.scope || {});
      for (const value of [binding.effectiveFrom, binding.effectiveTo]) if (value !== undefined && value !== null && (typeof value !== 'string' || !validDate(value))) fail(400, '角色有效期不正确');
      if (binding.effectiveFrom && binding.effectiveTo && binding.effectiveTo <= binding.effectiveFrom) fail(400, '角色有效期不正确');
    }
    const ok = await repository.bindRoles(memberId, input.bindings || [], input.revision); if (!ok) fail(409, '成员授权已被其他操作修改，请刷新');
    const context = await contextFor(actor); await repository.audit({ actorMemberId: context.actor.memberId, actorAccount: actor.account, action: 'authorization.member_roles.updated', sourceRef: publicResourceRef('authorization','member',memberId), after: input.bindings || [], requestId: input.requestId });
    return { memberId, bindings: input.bindings || [], authVersionInvalidated: true };
  }

  async function workbench(actor) {
    const context = await contextFor(actor);
    const current = await platform.repairs?.currentRepair?.(actor.account);
    return { actor: context.actor, todayDuties: context.todayDuties, presence: context.presence, currentRepair: current || null,
      resumeTasks: context.resumeTasks || [], navigation: context.navigation || [], actions: context.todayDuties?.length ? ['attendance.checkin','repair.start'] : ['attendance.checkin'], modules: context.modules || manifests };
  }

  async function organization(actor, kind, query = {}) {
    const context = await contextFor(actor);
    if (!['members.manage', 'roles.manage'].some(code => platform.authorizer.eligibleGrants(code, context, context.grants).length)) fail(403, '缺少组织字典读取权限');
    const includeDisabled = query.includeDisabled === '1' || query.includeDisabled === true;
    if (kind === 'campuses') return { items: await repository.listCampuses(includeDisabled) };
    if (kind === 'departments') return { items: await repository.listDepartments(includeDisabled) };
    if (kind === 'locations') return { items: await repository.listLocations(query.campusId || '', includeDisabled) };
    fail(404, '组织字典不存在');
  }

  async function importMembers(actor, input) {
    const context = await contextFor(actor);
    if (!platform.authorizer.eligibleGrants('members.manage', context, context.grants).length) fail(403, '缺少权限：members.manage');
    const rows = csvRows(String(input.csv || '').replace(/^\uFEFF/, ''));
    if (rows.length < 2) fail(400, '成员导入至少需要表头和一行数据');
    const headers = rows.shift().map(value => value.trim());
    const index = key => headers.indexOf(key);
    for (const key of ['studentId','name','homeCampusId']) if (index(key) < 0) fail(400, `缺少导入列：${key}`);
    const items = rows.map((cells, lineIndex) => {
      if (cells.length !== headers.length) fail(400, `CSV 第 ${lineIndex + 2} 行列数不正确`);
      cells = cells.map(value => value.trim());
      const item = { studentId: cells[index('studentId')], name: cells[index('name')], homeCampusId: cells[index('homeCampusId')],
        departmentId: index('departmentId') >= 0 ? cells[index('departmentId')] : '', assignmentType: index('assignmentType') >= 0 ? cells[index('assignmentType')] : 'primary',
        effectiveFrom: index('effectiveFrom') >= 0 ? cells[index('effectiveFrom')] : dateKey(),
        workProfiles: index('workProfiles') >= 0 ? cells[index('workProfiles')].split('|').map(value => value.trim()).filter(Boolean) : [],
        roleCodes: index('roleCodes') >= 0 ? cells[index('roleCodes')].split('|').map(value => value.trim()).filter(Boolean) : [],
        authorizedCampuses: index('authorizedCampuses') >= 0 ? cells[index('authorizedCampuses')].split('|').map(value => value.trim()).filter(Boolean) : [] };
      if (!/^\d{6,20}$/.test(item.studentId) || !item.name || !['campus-nanhu','campus-hunnan'].includes(item.homeCampusId)) fail(400, `第 ${lineIndex + 2} 行成员数据不正确`);
      if (item.workProfiles.some(value => !['repair','exchange','office','repair_lead','office_lead'].includes(value))) fail(400, `第 ${lineIndex + 2} 行工作属性不正确`);
      if (item.authorizedCampuses.some(value => !['campus-nanhu','campus-hunnan','南湖','浑南'].includes(value))) fail(400, `第 ${lineIndex + 2} 行授权校区不正确`);
      return item;
    });
    if (new Set(items.map(item => item.studentId)).size !== items.length) fail(400, '导入文件包含重复学号');
    for (const item of items) {
      if (!evaluate(context, 'members.manage', { campusId: item.homeCampusId, departmentIds: item.departmentId ? [item.departmentId] : [] }).allowed) fail(403, '导入包含管理范围外的成员');
      if (actor.role !== 'superadmin' && (item.roleCodes.length || item.workProfiles.length || item.authorizedCampuses.length)) fail(403, '角色、工作资格和账号校区授权由最高管理员配置');
      const existing = (await repository.listMembers({ studentId: item.studentId }))[0];
      if (existing) await requireMemberPermission(actor, existing);
    }
    if (!input.confirm) return { mode: 'preview', items: items.map(item => ({ ...item, memberId: `member-${item.studentId}` })), warnings: items.flatMap(item => item.roleCodes.length || item.workProfiles.length ? [] : [{ studentId: item.studentId, message: '未设置工作属性或角色，导入后仅建立成员资料' }]), requestId: input.requestId || '' };
    const memberRows = await repository.importMembers(items);
    const byStudentId = Object.fromEntries(memberRows.map(row => [row.student_id, row]));
    const result = items.map(item => ({ memberId: byStudentId[item.studentId]?.id || `member-${item.studentId}`, studentId: item.studentId, name: item.name, status: 'updated' }));
    await repository.audit({ actorMemberId: context.actor.memberId, actorAccount: actor.account, action: 'identity.members.imported', sourceRef: publicResourceRef('identity','import',input.requestId || crypto.randomUUID()), after: { count: result.length }, requestId: input.requestId });
    return { mode: 'confirmed', items: result, count: result.length, requestId: input.requestId || '' };
  }

  async function deskSummary(actor, query = {}) {
    const businessDate = query.businessDate || dateKey();
    await requirePermission(actor, 'repair.summary.read', { campusId: query.campusId }, businessDate);
    const campuses = actor.authorizedCampuses || [];
    const campusName = { 'campus-nanhu': '南湖', 'campus-hunnan': '浑南' }[query.campusId] || query.campusId;
    const scopedCampuses = campusName ? campuses.filter(item => item === campusName) : campuses;
    const appointmentView = await platform.repairs.list({ date: businessDate, campus: campusName, status: 'all' }, { campuses: scopedCampuses, technician: '' });
    const campusIds = { '南湖': 'campus-nanhu', '浑南': 'campus-hunnan' };
    const presence = query.campusId
      ? await repository.listPresence(businessDate, query.campusId)
      : (await Promise.all((actor.authorizedCampuses || []).map(campus => repository.listPresence(businessDate, campusIds[campus] || campus)))).flat();
    return { businessDate, campusId: query.campusId || null, appointments: appointmentView.items.map(item => ({ id: item.id, campus: item.campus, date: item.date, timeSlot: item.timeSlot, status: item.status, deviceType: item.deviceType, assignedTo: item.assignedTo || '' })), counts: appointmentView.counts, staffPresence: presence };
  }

  async function createAttendanceEvent(actor, input) {
    await requirePermission(actor, 'attendance.session.manage', { campusId: input.campusId }, input.businessDate || dateKey());
    const type = ['duty','meeting'].includes(input.type) ? input.type : 'duty';
    const businessDate = input.businessDate || dateKey();
    const startsAt = instant(input.startsAt || `${businessDate}T18:30:00+08:00`); const endsAt = instant(input.endsAt || `${businessDate}T21:30:00+08:00`);
    if (endsAt <= startsAt) fail(400, '签到窗口不正确');
    const context = await contextFor(actor, businessDate);
    return withReceipt(actor, 'attendance.event.create', input, async () => {
      const created = await repository.createEvent({ type, policyCode: input.policyCode || `${type}.v1`, policyVersion: input.policyVersion || '1.0.0', ruleSnapshot: input.ruleSnapshot || { timezone: 'Asia/Shanghai' }, campusId: input.campusId || null, businessDate, startsAt, endsAt, sourceRef: input.sourceRef || {} }, context.actor.memberId);
      await repository.audit({ actorMemberId: context.actor.memberId, actorAccount: actor.account, action: 'attendance.event.created', sourceRef: publicResourceRef('attendance','event',created.id), after: created, requestId: input.requestId });
      return created;
    });
  }
  async function issueAttendanceToken(actor, eventId, input = {}) {
    const context = await contextFor(actor); const event = await repository.attendanceEvent?.(eventId);
    if (!event) fail(404, '签到场次不存在');
    await requirePermission(actor, 'attendance.session.manage', { campusId: event?.campusId }, event?.businessDate || dateKey());
    const token = randomToken(); const expiresAt = instant(input.expiresAt || event.endsAt);
    if (Date.parse(expiresAt) <= Date.now() || Date.parse(expiresAt) > Date.parse(event.endsAt)) fail(400, '签到凭证到期时间不正确');
    const result = await repository.issueToken(eventId, await tokenDigest(token), expiresAt, context.actor.memberId, input.revision ?? event.revision);
    if (!result) fail(409, '签到场次已被更新，请刷新');
    return { eventId, token: `pioneer:attendance:v1:${token}`, version: result.version, expiresAt: result.expires_at, tokenId: result.id };
  }
  async function checkIn(actor, input) {
    const rawToken = input.token?.startsWith('pioneer:attendance:v1:') ? input.token.slice('pioneer:attendance:v1:'.length) : input.token;
    if (!rawToken) fail(400, '签到凭证不正确');
    const found = await repository.findEventByToken(await tokenDigest(rawToken)); if (!found) fail(404, '签到凭证已失效');
    const { event } = found;
    const authorization = await requirePermission(actor, 'attendance.self', { campusId: event.campusId }, event.businessDate);
    const context = authorization.context;
    const campusNames = { 'campus-nanhu': '南湖', 'campus-hunnan': '浑南' };
    if (event.campusId && !(actor.authorizedCampuses || []).some(value => value === event.campusId || value === campusNames[event.campusId])) fail(403, '没有该校区的签到权限');
    const policy = policyFor(event); if (!policy) fail(400, '签到策略不存在');
    const now = nowIso(); if (!eventWindow(event.startsAt, event.endsAt, now)) fail(409, '当前不在签到时间窗口');
    const eligible = policy.checkEligibility({ event, context: { ...context, attendanceEligible: authorization.result.allowed } }); if (!eligible) fail(403, '当前成员没有该场次的签到资格');
    const dedupeKey = policy.getDedupeScope({ memberId: context.actor.memberId, event });
    const existing = await repository.findAttendanceByDedupe(dedupeKey); if (existing) return { ...existing, isExisting: true, result: policy.describeResult(existing) };
    const method = attendanceMethod(input.method);
    if (method === 'nfc' && input.nfcEvidence?.verified !== true && input.verifiedEvidence?.method !== 'nfc') fail(403, 'NFC 凭证未通过服务端核验');
    const occurredAt = now;
    if (!eventWindow(event.startsAt, event.endsAt, occurredAt)) fail(400, '签到发生时间不在场次窗口内');
    const record = await withReceipt(actor, 'attendance.checkin', input, async () => {
      const created = await repository.insertAttendance({ id: crypto.randomUUID(), memberId: context.actor.memberId, eventId: event.id, dedupeKey, occurredAt, recordedAt: now, method, sourceRef: event.sourceRef, campusId: event.campusId, businessDate: event.businessDate, departmentId: context.memberships.find(item => item.isPrimary)?.departmentId, departmentName: context.memberships.find(item => item.isPrimary)?.departmentName, identitySnapshot: { name: context.actor.name, memberId: context.actor.memberId }, nonScheduled: context.todayDuties.length === 0, actorAccount: actor.account,
        checkInAudit: true, tokenId: found.token.id, authVersion: context.authVersion, requestId: requestId(input.requestId), payloadHash: hashPayload(input), type: event.type }, event.type === 'duty');
      if (!created) {
        const concurrent = await repository.findAttendanceByDedupe(dedupeKey);
        if (concurrent) return { ...concurrent, isExisting: true, result: policy.describeResult(concurrent) };
        fail(409, '签到记录已被其他请求创建');
      }
      return { ...created, isExisting: false, result: policy.describeResult(created) };
    });
    return record;
  }
  async function previewAttendance(actor, input) {
    if (typeof input.token !== 'string' || input.token.length > 256) fail(400, '签到凭证不正确');
    const raw = input.token.replace(/^pioneer:attendance:v1:/, '');
    const found = await repository.findEventByToken(await tokenDigest(raw));
    if (!found) fail(404, '签到凭证已失效');
    const event = found.event;
    await requirePermission(actor, 'attendance.self', { campusId: event.campusId }, event.businessDate);
    const campusName = { 'campus-nanhu':'南湖', 'campus-hunnan':'浑南' }[event.campusId];
    if (!actor.authorizedCampuses.includes(campusName)) fail(403, '没有该校区的签到权限');
    return { campusName, businessDate:event.businessDate, startsAt:event.startsAt, endsAt:event.endsAt, type:event.type };
  }
  async function attendanceList(actor, query) {
    const context = await contextFor(actor, query?.businessDate || dateKey());
    let filters = { ...query };
    const all = query?.all === true || query?.all === '1' || query?.all === 'true';
    if (all) {
      await requirePermission(actor, 'attendance.correct', { campusId: query.campusId }, query.businessDate || dateKey());
      if (!query.campusId && actor.authorizedCampuses?.length) {
        const ids = { '南湖': 'campus-nanhu', '浑南': 'campus-hunnan' };
        filters.campusIds = actor.authorizedCampuses.map(item => ids[item] || item);
      }
      delete filters.memberId;
    } else {
      if (query?.memberId && query.memberId !== context.actor.memberId) await requirePermission(actor, 'attendance.correct', { campusId: query.campusId }, query.businessDate || dateKey());
      filters.memberId = query?.memberId || context.actor.memberId;
    }
    const records = await repository.listAttendance(filters);
    return { items: records, definition: { unit: 'attendance_record', timezone: 'Asia/Shanghai', version: '1.0.0' } };
  }
  async function attendanceExport(actor, query = {}) {
    const month = query.month === undefined ? dateKey().slice(0, 7) : query.month;
    if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) fail(400, '月份不正确');
    const [year, monthNumber] = month.split('-').map(Number);
    if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) fail(400, '月份不正确');
    const next = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
    await requirePermission(actor, 'attendance.export', { campusId: query.campusId }, dateKey());
    const names = { '南湖': 'campus-nanhu', '浑南': 'campus-hunnan' };
    const requestedCampus = query.campusId || '';
    if (requestedCampus && !['campus-nanhu','campus-hunnan'].includes(requestedCampus)) fail(400, '校区不正确');
    const allowed = actor.authorizedCampuses || [];
    const campusIds = (requestedCampus ? [requestedCampus] : allowed.map(item => names[item] || item)).filter(Boolean);
    const rows = await repository.attendanceExport({ month, nextMonth: next, campusIds, memberId: query.memberId, departmentId: query.departmentId });
    const header = ['校区','人员','学号','签到次数','部门'];
    const body = rows.map(row => [row.campus,row.memberName,row.studentId,row.attendanceCount,row.department].map(csvCell).join(','));
    return { month, rows, csv: `\uFEFF${[header.join(','), ...body].join('\r\n')}\r\n` };
  }
  async function correctAttendance(actor, input) {
    await requirePermission(actor, 'attendance.correct', { campusId: input.campusId }, input.businessDate || dateKey());
    if (!input.memberId || !input.eventId || !input.occurredAt || !input.reason) fail(400, '补录签到字段不完整');
    const context = await contextFor(actor, input.businessDate || dateKey());
    const event = await repository.attendanceEvent?.(input.eventId); if (!event) fail(404, '签到场次不存在');
    const policy = policyFor(event); const dedupeKey = policy.getDedupeScope({ memberId: input.memberId, event });
    if (await repository.findAttendanceByDedupe(dedupeKey)) fail(409, '该成员已存在签到事实');
    const target = await repository.memberRow(input.memberId); if (!target) fail(404, '成员不存在');
    const primary = (await repository.memberships(input.memberId, event.businessDate)).find(item => item.isPrimary) || null;
    const created = await repository.insertAttendance({ id: crypto.randomUUID(), memberId: input.memberId, eventId: input.eventId, dedupeKey, occurredAt: instant(input.occurredAt), recordedAt: nowIso(), method: 'manual', sourceRef: event.sourceRef, campusId: event.campusId, businessDate: event.businessDate, departmentId: primary?.departmentId || null, departmentName: primary?.departmentName || 'unknown', identitySnapshot: { name: target.name, studentId: target.student_id || '', memberId: target.id }, nonScheduled: false }, false);
    if (!created) fail(409, '签到记录已被其他操作修改');
    await repository.audit({ actorMemberId: context.actor.memberId, actorAccount: actor.account, action: 'attendance.corrected', sourceRef: publicResourceRef('attendance','record',created.id), after: created, reason: input.reason, requestId: input.requestId });
    return created;
  }
  async function presence(actor, input) {
    if (input.businessDate && input.businessDate !== dateKey()) fail(400, '只能修改今天的在岗状态');
    const context = await contextFor(actor, input.businessDate || dateKey());
    await requirePermission(actor, 'attendance.self', { campusId: input.campusId }, input.businessDate || dateKey());
    if (!['available','away','off_duty'].includes(input.state)) fail(400, '在岗状态不正确');
    if (!context.presence) fail(409, '请先完成到岗签到');
    if (input.campusId && input.campusId !== context.presence.campusId) fail(409, '在岗校区以签到记录为准');
    if (input.state !== 'available' && await repository.activeRepair(context.actor.memberId)) fail(409, '当前仍有进行中的维修，不能离岗', 'PRESENCE_CHANGED');
    const result = await repository.setPresence(context.actor.memberId, { ...input, businessDate: input.businessDate || dateKey() }, input.revision ?? 0, context.actor);
    if (!result) fail(409, '在岗状态已被其他操作修改，请刷新');
    await repository.audit({ actorMemberId: context.actor.memberId, actorAccount: actor.account, action: 'duty.presence.changed', sourceRef: publicResourceRef('duty','presence',`${context.actor.memberId}:${result.businessDate}`), after: result, requestId: input.requestId });
    return result;
  }

  async function rosterTasks(actor) {
    const context = await contextFor(actor);
    await requirePermission(actor, 'roster.read', { memberId: context.actor.memberId });
    const tasks = await repository.listRosterTasks();
    return { items: tasks.filter(task => !task.memberIds?.length || task.memberIds.includes(context.actor.memberId) ||
      evaluate(context, 'roster.repair.manage', { campusIds: task.campusScope?.campusIds }).allowed ||
      evaluate(context, 'roster.office.manage', { campusIds: task.campusScope?.campusIds }).allowed) };
  }
  async function taskAvailability(actor, taskId) {
    const context = await contextFor(actor);
    await requirePermission(actor, 'roster.read', { memberId: context.actor.memberId });
    const rows = await repository.availability(taskId);
    return { items: rows.filter(item => item.memberId === context.actor.memberId ||
      evaluate(context, 'roster.repair.manage', { campusId: item.campusId }).allowed ||
      evaluate(context, 'roster.office.manage', { campusId: item.campusId }).allowed) };
  }
  async function createRosterTask(actor, input) {
    await requirePermission(actor, 'roster.repair.manage', { campusId: input.campusId }, input.weekStart || dateKey());
    if (!input.weekStart || !input.slotStart || !input.slotEnd || !input.deadline) fail(400, '排班任务字段不完整');
    const context = await contextFor(actor); const result = await repository.createRosterTask({ ...input, campusScope: { campusIds: [input.campusId] } }, context.actor.memberId);
    await repository.audit({ actorMemberId: context.actor.memberId, actorAccount: actor.account, action: 'rosters.task.created', sourceRef: publicResourceRef('rosters','task',result.id), after: result, requestId: input.requestId });
    return result;
  }
  async function saveAvailability(actor, taskId, input) {
    if (!input.businessDate || !input.startAt || !input.endAt || input.endAt <= input.startAt) fail(400, '可用时间范围不正确');
    const context = await contextFor(actor, input.businessDate);
    return repository.saveAvailability(taskId, context.actor.memberId, input, input.revision);
  }
  async function generate(actor, input) {
    await requirePermission(actor, 'roster.repair.manage', { campusId: input.campusId }, input.weekStart || dateKey());
    const context = await contextFor(actor); const result = generateRoster(input); const validation = validateRoster(result, input);
    const version = await repository.createRosterVersion({ taskId: input.taskId, assignments: result.assignments, inputSnapshotRef: result.inputSnapshotRef, ruleVersion: result.ruleVersion, algorithmVersion: result.algorithmVersion, solverStatus: result.solverStatus, validation }, context.actor.memberId);
    await repository.audit({ actorMemberId: context.actor.memberId, actorAccount: actor.account, action: 'rosters.generated', sourceRef: publicResourceRef('rosters','version',version.id), after: { version, validation }, requestId: input.requestId });
    return { ...result, validation, version };
  }
  async function updateRoster(actor, id, input) {
    await requirePermission(actor, 'roster.repair.manage', { campusId: input.campusId }, input.businessDate || dateKey());
    if (!Number.isInteger(input.version) || !Array.isArray(input.assignments)) fail(400, '排班草稿字段不完整');
    const result = await repository.updateRosterDraft(id, input, input.version);
    if (!result) fail(409, '排班版本已变化，请刷新');
    await repository.audit({ actorMemberId: (await contextFor(actor)).actor.memberId, actorAccount: actor.account, action: 'rosters.updated', sourceRef: publicResourceRef('rosters','version',id), after: result, requestId: input.requestId });
    return { ...result, assignments: input.assignments, revision: result.version };
  }
  async function publish(actor, id, input) { await requirePermission(actor, 'roster.repair.manage', { campusId: input.campusId }, input.businessDate || dateKey()); const result = await repository.publishRoster(id, input.version); if (!result) fail(409, '排班版本已变化，请刷新'); const context = await contextFor(actor); await repository.audit({ actorMemberId: context.actor.memberId, actorAccount: actor.account, action: 'rosters.published', sourceRef: publicResourceRef('rosters','version',id), after: result, requestId: input.requestId }); return result; }
  async function rosterMine(actor, query = {}) { const context = await contextFor(actor); return { items: await repository.listAssignments(context.actor.memberId, query.weekStart || weekRange(dateKey()).start), weekStart: query.weekStart || weekRange(dateKey()).start }; }
  async function leave(actor, input) {
    const context = await contextFor(actor);
    await requirePermission(actor, 'roster.read', { memberId: context.actor.memberId }, input.businessDate || dateKey());
    if (!input.assignmentId || !input.reason) fail(400, '请假字段不完整');
    const assignment = await repository.assignmentById(input.assignmentId);
    if (!assignment || assignment.memberId !== context.actor.memberId) fail(403, '只能为本人班次申请请假');
    if (String(input.reason).trim().length < 2 || String(input.reason).length > 500) fail(400, '请假原因不正确');
    return withReceipt(actor, 'leave.create', input, async () => {
      const result = publicLeave(await repository.createLeave(input, context.actor.memberId));
      await repository.audit({ actorMemberId: context.actor.memberId, actorAccount: actor.account, action: 'rosters.leave.created', sourceRef: publicResourceRef('rosters','leave',result.id), after: result, requestId: input.requestId });
      return result;
    });
  }
  async function leaves(actor, query = {}) {
    const context = await contextFor(actor);
    const all = query.all === true || query.all === '1' || query.all === 'true';
    const rows = await repository.listLeaves({ ...query, memberId: all ? undefined : context.actor.memberId });
    const items = [];
    for (const row of rows) {
      const assignment = await repository.assignmentById(row.assignment_id);
      const scope = { campusId: assignment?.campusId, memberId: row.member_id };
      const datedContext = assignment ? await contextFor(actor, assignment.businessDate) : context;
      const canReview = !!assignment && evaluate(datedContext, 'leave.review', scope).allowed;
      if (all && !canReview) continue;
      if (query.campusId && assignment?.campusId !== query.campusId) continue;
      items.push({ ...publicLeave(row), assignment, actions: {
        review: canReview && row.status === 'pending',
        withdraw: row.member_id === context.actor.memberId && row.status === 'pending'
      } });
    }
    return { items };
  }

  async function leaveDecision(actor, id, input) {
    if (!['approve','reject'].includes(input.decision)) fail(400, '审批动作不正确');
    const request = await repository.leaveById(id); if (!request) fail(404, '请假申请不存在');
    const assignment = await repository.assignmentById(request.assignment_id);
    await requirePermission(actor, 'leave.review', { campusId: assignment?.campusId }, assignment?.businessDate || dateKey());
    const context = await contextFor(actor); const result = await repository.updateLeave(id,input.decision === 'approve' ? 'approved' : 'rejected',context.actor.memberId,input.revision,input.note || ''); if (!result) fail(409, '请假申请已变化，请刷新'); const value = publicLeave(result); await repository.audit({ actorMemberId: context.actor.memberId, actorAccount: actor.account, action: 'rosters.leave.reviewed', sourceRef: publicResourceRef('rosters','leave',id), after: value, requestId: input.requestId }); return value;
  }
  async function leaveWithdraw(actor, id, input) {
    const context = await contextFor(actor); const request = await repository.leaveById(id);
    if (!request || request.member_id !== context.actor.memberId) fail(403, '只能撤回本人的请假申请');
    await requirePermission(actor, 'roster.read', { memberId: context.actor.memberId }, input.businessDate || dateKey());
    const result = await repository.updateLeave(id,'withdrawn',context.actor.memberId,input.revision,'本人撤回'); if (!result) fail(409, '请假申请已变化，请刷新'); const value = publicLeave(result); await repository.audit({ actorMemberId: context.actor.memberId, actorAccount: actor.account, action: 'rosters.leave.withdrawn', sourceRef: publicResourceRef('rosters','leave',id), after: value, requestId: input.requestId }); return value;
  }
  async function swapCandidates(actor, query = {}) {
    const context = await contextFor(actor);
    await requirePermission(actor, 'roster.read', { memberId: context.actor.memberId });
    const source = await repository.assignmentById(query.assignmentId);
    if (!source || source.memberId !== context.actor.memberId) fail(403, '请先选择本人的班次');
    const weekStart = weekRange(source.businessDate).start;
    const own = await repository.listAssignments(context.actor.memberId, weekStart);
    if (!own.some(item => item.id === source.id)) fail(409, '该班次已失效，请刷新班表');
    return { items: await repository.swapCandidates({ ...source, weekStart }) };
  }
  async function swap(actor, input) {
    const context = await contextFor(actor);
    await requirePermission(actor, 'roster.read', { memberId: context.actor.memberId }, input.businessDate || dateKey());
    const from = await repository.assignmentById(input.fromAssignmentId); const to = await repository.assignmentById(input.toAssignmentId);
    if (!from || !to || from.memberId !== context.actor.memberId || to.memberId === context.actor.memberId || input.toMemberId !== to.memberId) fail(400, '换班班次或目标成员不正确');
    if (from.id === to.id || !Number.isInteger(input.fromRevision) || !Number.isInteger(input.toRevision)) fail(400, '换班版本不正确');
    if (from.revision !== input.fromRevision || to.revision !== input.toRevision) fail(409, '班次已变化，请重新选择');
    if (weekRange(from.businessDate).start !== weekRange(to.businessDate).start) fail(400, '只能选择同一周的班次换班');
    if (from.dutyType !== to.dutyType) fail(400, '只能交换相同岗位类型的班次');
    return withReceipt(actor, 'swap.create', input, async () => {
      const result = publicSwap(await repository.createSwap({ ...input, fromRevision: input.fromRevision, toRevision: input.toRevision }, context.actor.memberId));
      await repository.audit({ actorMemberId: context.actor.memberId, actorAccount: actor.account, action: 'rosters.swap.created', sourceRef: publicResourceRef('rosters','swap',result.id), after: result, requestId: input.requestId });
      return result;
    });
  }
  async function swaps(actor, query = {}) {
    const context = await contextFor(actor);
    const all = query.all === true || query.all === '1' || query.all === 'true';
    const rows = await repository.listSwaps({ ...query, memberId: all ? undefined : context.actor.memberId });
    const items = [];
    for (const row of rows) {
      const from = await repository.assignmentById(row.from_assignment_id);
      const to = await repository.assignmentById(row.to_assignment_id);
      if (all) {
        if (!from || !to) continue;
        const allowed = await Promise.all([from, to].map(async assignment => {
          const datedContext = await contextFor(actor, assignment.businessDate);
          return evaluate(datedContext, assignment.dutyType === 'office' ? 'roster.office.manage' : 'roster.repair.manage', { campusId: assignment.campusId }).allowed;
        }));
        if (allowed.some(value => !value)) continue;
      }
      if (query.campusId && from?.campusId !== query.campusId && to?.campusId !== query.campusId) continue;
      items.push({ ...publicSwap(row), fromAssignment: from, toAssignment: to,
        actions: { respond: row.to_member_id === context.actor.memberId && row.status === 'pending' } });
    }
    return { items };
  }
  async function swapDecision(actor, id, input) {
    if (!['accept','decline'].includes(input.decision)) fail(400, '换班审批动作不正确');
    const context = await contextFor(actor);
    const request = await repository.swapById(id);
    if (!request) fail(404, '换班申请不存在');
    if (request.to_member_id !== context.actor.memberId) fail(403, '只有被邀请的成员可以确认或拒绝换班');
    await requirePermission(actor, 'roster.read', { memberId: context.actor.memberId });
    const result = await repository.updateSwap(id,input.decision === 'accept' ? 'accepted' : 'declined',context.actor.memberId,input.revision);
    if (!result) fail(409, '换班申请已变化，请刷新');
    const value = publicSwap(result);
    await repository.audit({ actorMemberId: context.actor.memberId, actorAccount: actor.account, action: 'rosters.swap.decided', sourceRef: publicResourceRef('rosters','swap',id), after: value, requestId: input.requestId });
    return value;
  }
  async function audit(actor, query) { await requirePermission(actor, 'audit.read'); return { items: await repository.listAudit(query || {}) }; }

  return { contextFor, requirePermission, memberList, memberDetail, updateMember, addMembership, endMembership, permissions, roles, createRole, updateRole, previewRole, bindMemberRoles,
    organization, importMembers, deskSummary, workbench, createAttendanceEvent, issueAttendanceToken, checkIn, previewAttendance, attendanceList, correctAttendance, presence, rosterTasks, taskAvailability, createRosterTask, saveAvailability, generate, updateRoster, publish, rosterMine,
    leave, leaves, leaveDecision, leaveWithdraw, swapCandidates, swap, swaps, swapDecision, attendanceExport, audit,
    recordAudit: input => repository.audit(input) };
}
