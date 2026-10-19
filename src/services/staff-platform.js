import { fail } from '../lib/http.js';
import { dateKey, eventWindow, instant, nowIso, weekRange, validDate, addDays } from '../platform/time.js';
import { requestId, stableJson, publicResourceRef, SCHEMA_VERSION } from '../platform/contracts.js';
import { memberPublic } from '../modules/identity/public.js';
import { generateRoster, validateRoster } from '../modules/rosters/solver.js';
import { attendanceMethod, policyFor } from '../modules/attendance/public.js';
import { validScope, campusId as normalizeCampusId } from '../modules/authorization/scopes.js';
import { validGrantValidity } from '../modules/authorization/public.js';
import { workspacePermissions } from '../modules/authorization/workspace.js';
import { assignmentProtected, validateSwap } from '../modules/rosters/swap-validation.js';
import { csvLine } from '../lib/csv.js';
import { rosterScope, rosterTaskManaged, rosterDepartments, rosterMemberInScope, rosterMemberReadable } from '../modules/rosters/scope.js';
import { staffIdentities } from '../../shared/staff-identities.js';
import { repairRosterPool, rosterFactContext } from '../modules/rosters/qualification.js';
import {collectionState,rosterStage,sameAssignment} from '../modules/rosters/workflow.js';
import {generateOfficeRoster} from '../modules/rosters/office.ts';
import {collectionInstant,validateRecurrence,recurringPeriodWeek} from '../modules/rosters/recurrence.js';
import {rosterCollections} from '../../shared/roster-collections.js';
import {dutyEnd} from '../../shared/duty-window.js';

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

function rosterEligibilitySnapshot(source) {
  const ordered = values => [...values].sort((a,b) => stableJson(a).localeCompare(stableJson(b)));
  return {
    taskRevision: source.taskRevision, requireLead: !!source.requireLead, ruleVersion:source.ruleVersion || 'legacy',
    slots: ordered(source.slots),
    members: source.members.map(member => ({ memberId: member.memberId, pool:member.pool || '', available: ordered(member.available || []), manualSlots:ordered(member.manualSlots || []),leadSlots: ordered(member.leadSlots || []) }))
      .sort((a,b) => a.memberId.localeCompare(b.memberId))
  };
}

function rosterAssignmentSnapshot(assignments) {
  return assignments.map(item => ({ memberId:item.memberId, businessDate:item.businessDate, campusId:item.campusId,
    startAt:item.startAt,endAt:item.endAt,roleKind:item.roleKind || '',leaveStatus:item.leaveStatus || '' }))
    .sort((a,b) => stableJson(a).localeCompare(stableJson(b)));
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
function publicSwap(row) { return row ? { id: row.id, fromAssignmentId: row.from_assignment_id, toAssignmentId: row.to_assignment_id, fromMemberId: row.from_member_id, toMemberId: row.to_member_id, fromRevision: row.from_revision, toRevision: row.to_revision, status: row.status, note: row.note, revision: row.revision, createdAt: row.created_at, decidedAt: row.decided_at || null,
  appliedFromAssignmentId: row.applied_from_assignment_id || '', appliedToAssignmentId: row.applied_to_assignment_id || '',
  affectedResources: ['rosters.mine','rosters.requests','workbench.tasks'] } : null; }

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

export function staffPlatformService({ repository, platform, manifests, calendarClock=()=>new Date() }) {
  const collectionStatus=task=>collectionState(task,calendarClock().getTime());
  async function contextFor(actor, businessDate = dateKey()) {
    const context = await platform.authContext(actor, { businessDate });
    if (context.member?.status && context.member.status !== 'active') fail(401, '成员已停用，请联系管理员');
    const effective = { ...context, businessDate, actor: { ...context.actor, role: actor.role, authorizedCampuses: actor.authorizedCampuses || [], homeCampus: actor.homeCampus }, grants: context.grants || [] };
    return { ...effective, identities: staffIdentities(effective, platform.authorizer), permissions: workspacePermissions(effective.actor, effective, platform.authorizer) };
  }

  async function scopedActor(actor, permissionCode) {
    const context = await contextFor(actor);
    const authorizedCampuses = (actor.authorizedCampuses || []).filter(campusId =>
      evaluate(context, permissionCode, { campusId }).allowed);
    if (!authorizedCampuses.length) fail(403, '没有执行此操作的权限');
    return { ...actor, authorizedCampuses };
  }

  function evaluate(context, permissionCode, target) {
    return platform.authorizer.evaluate(context.actor, permissionCode, target, context, context.grants);
  }

  async function requirePermission(actor, permissionCode, target = {}, businessDate = dateKey()) {
    if (permissionCode === 'roles.manage' && actor.role !== 'superadmin') fail(403, '角色配置与分配由最高管理员管理');
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
    if (!context.permissions['members.manage']) fail(403, '缺少权限：members.manage');
    if (filters.status && !['active', 'inactive'].includes(filters.status)) fail(400, '成员状态不正确');
    const query = { q: inputString(filters, 'q', 120), status: filters.status,
      homeCampusId: inputString(filters, 'homeCampusId', 80), businessDate: context.businessDate };
    let after = parseMemberCursor(filters.cursor);
    const items = [];
    const withIdentities=async items=>{
      const contexts=await repository.fieldContexts(items.map(item=>item.memberId),context.businessDate);
      return items.map(item=>({...item,identities:staffIdentities(contexts.get(item.memberId),platform.authorizer)}));
    };
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
        if (items.length === 101) return { items: await withIdentities(items.slice(0, 100)), nextCursor: memberCursor(items[99]), schemaVersion: SCHEMA_VERSION };
      }
      if (candidates.length < 101) return { items:await withIdentities(items), nextCursor: null, schemaVersion: SCHEMA_VERSION };
      const last = candidates.at(-1);
      after = { name: last.name, memberId: last.memberId };
    }
  }

  async function memberDetail(actor, memberId, businessDate = dateKey()) {
    const target = await repository.memberRow(memberId);
    if (!target) fail(404, '成员不存在');
    await requireMemberPermission(actor, target);
    if (!validDate(businessDate)) fail(400, '业务日期不正确');
    const [memberMemberships, workProfiles, account, contexts] = await Promise.all([repository.listMemberships(memberId), repository.profileHistory(memberId), repository.accountForMember(memberId), repository.fieldContexts([memberId],businessDate)]);
    return { bindings: await repository.roleBindings(memberId), member: {...memberPublic(target, { memberships: memberMemberships, profiles: workProfiles }),identities:staffIdentities(contexts.get(memberId),platform.authorizer)}, account: account ? { account: account.account, status: account.status, protected: !!account.protected, role: account.role, authVersion: account.auth_version || 0 } : null };
  }

  async function saveWorkProfile(actor, memberId, input) {
    const member = await repository.memberRow(memberId);
    if (!member) fail(404,'成员不存在');
    const {context} = await requireMemberPermission(actor,member);
    if (actor.role !== 'superadmin') fail(403,'工作资格和交流培训结果由最高管理员确认');
    if (!Number.isInteger(input.revision) || input.revision<0) fail(400,'成员版本不正确');
    let before = null;
    const reason = inputString(input,'reason',300), receipt = input.requestId;
    if (input.id) {
      before = (await repository.profileHistory(memberId)).find(item=>item.id===input.id);
      if (!before) fail(404,'工作资格不存在');
      if (!Number.isInteger(input.profileRevision) || input.profileRevision<0 || !validDate(input.effectiveTo) || input.effectiveTo<before.effectiveFrom) fail(400,'资格结束日期或版本不正确');
      if (before.effectiveTo && input.effectiveTo>before.effectiveTo) fail(400,'已结束资格不能延长，请新增审核记录');
      input = {id:before.id,effectiveTo:input.effectiveTo,profileRevision:input.profileRevision,revision:input.revision};
    } else {
      if (!['repair','exchange','office'].includes(input.profileCode) || !validDate(input.effectiveFrom) || input.effectiveTo && (!validDate(input.effectiveTo) || input.effectiveTo<=input.effectiveFrom)) fail(400,'工作资格或有效期不正确');
      if (input.profileCode==='exchange' && input.trainingConfirmed!==true) fail(400,'请先确认交流人员已通过维修培训');
    }
    const result = await repository.saveWorkProfile(memberId,input,input.revision,{actorMemberId:context.actor.memberId,actorAccount:actor.account,authVersion:context.authVersion,
      action:before ? 'identity.qualification.ended' : 'identity.qualification.granted',before,after:input,reason,requestId:receipt});
    if (!result) fail(409,'成员或资格已变化，或有效期与已有资格重叠，请刷新后重试');
    return {items:result,authVersionChanged:true};
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
    const after = await repository.updateMember(memberId, patch, input.revision, { actorMemberId: context.actor.memberId, actorAccount: actor.account, authVersion:context.authVersion, action: 'identity.member.updated', sourceRef: publicResourceRef('identity','member',memberId), before, after:patch, requestId: input.requestId, reason: input.reason });
    if (!after) fail(409, '成员已被其他操作修改，请刷新');
    const account = await repository.accountForMember(memberId);
    return { member: memberPublic(after), revision: after.revision, affectedResources: [{ module: 'identity', type: 'member', id: memberId }], accountStatus: account?.status || '' };
  }

  async function addMembership(actor, memberId, input) {
    if (!Number.isInteger(input?.revision) || input.revision < 0) fail(400, '成员版本不正确');
    for (const key of ['departmentId', 'effectiveFrom']) inputString(input, key, 80, true);
    if (!validDate(input.effectiveFrom) || input.effectiveTo && !validDate(input.effectiveTo)) fail(400, '任职有效期不正确');
    if (!['primary','secondary','exchange','temporary'].includes(input.assignmentType || 'secondary')) fail(400, '任职类型不正确');
    if (input.effectiveTo && input.effectiveTo <= input.effectiveFrom) fail(400, '任职有效期不正确');
    const member = await repository.memberRow(memberId); if (!member) fail(404, '成员不存在');
    const { context } = await requireMemberPermission(actor, member);
    await requireMemberPermission(actor, member, { departmentIds: [input.departmentId] });
    if (!(await repository.listDepartments()).some(item=>item.id===input.departmentId)) fail(400, '请选择有效部门');
    const result = await repository.addMembership(memberId, input, input.revision, { actorMemberId: context.actor.memberId, actorAccount: actor.account, authVersion:context.authVersion, action: 'organization.membership.updated', after: input, requestId: input.requestId });
    if (!result) fail(409, '成员版本或任职范围已变化，请刷新');
    return result;
  }

  async function endMembership(actor, memberId, membershipId, input) {
    if (!Number.isInteger(input?.revision) || input.revision < 0 || !validDate(input.effectiveTo)) fail(400, '任职版本或结束日期不正确');
    const existing = (await repository.listMemberships(memberId)).find(item => item.id === membershipId);
    if (!existing) fail(404, '任职关系不存在');
    const member = await repository.memberRow(memberId); if (!member) fail(404, '成员不存在');
    const { context } = await requireMemberPermission(actor, member, { departmentIds: [existing.departmentId] });
    if (input.effectiveTo <= existing.effectiveFrom) fail(400, '任职结束日期必须晚于生效日期');
    const result = await repository.endMembership(memberId, membershipId, input.effectiveTo, input.revision, { actorMemberId: context.actor.memberId, actorAccount: actor.account, authVersion:context.authVersion, action: 'organization.membership.ended', sourceRef: publicResourceRef('organization','membership',membershipId), before: existing, after:{...existing,effectiveTo:input.effectiveTo}, requestId: input.requestId, reason: input.reason });
    if (!result) fail(409, '任职已被其他操作修改，请刷新');
    return result;
  }

  async function permissions(actor) { await requirePermission(actor, 'roles.manage'); return { items: await repository.permissionDefinitions(), conditionProviders: platform.authorizer.conditionDefinitions(), contractVersion: 'staff-platform.v1' }; }
  async function roles(actor) { await requirePermission(actor, 'roles.manage'); return { items: await repository.listRoles() }; }
  async function createRole(actor, input) {
    const {context} = await requirePermission(actor, 'roles.manage');
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
    const result = await repository.createRole({ ...input, code, name, level }, { actorMemberId: context.actor.memberId, actorAccount: actor.account, authVersion:context.authVersion, action: 'authorization.role.created', after: {code,name,level,grants:input.grants || []}, requestId: input.requestId });
    if (!result) fail(409, '权限已变化，请重新登录后重试');
    return result;
  }
  async function updateRole(actor, id, input) {
    const {context} = await requirePermission(actor, 'roles.manage');
    if (actor.role !== 'superadmin') fail(403, '角色配置与分配由最高管理员管理');
    if (id === 'role-superadmin') fail(403, '最高管理员权限包受保护');
    if (!Number.isInteger(input.revision)) fail(400, '角色版本不正确');
    if (input.level !== undefined && (!Number.isInteger(input.level) || input.level<1 || input.level>=4)) fail(400, '角色等级应为 1–3');
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean') fail(400, '角色启用状态不正确');
    if (input.name !== undefined) inputString(input,'name',80,true);
    if (input.description !== undefined) inputString(input,'description',500);
    if (input.grants !== undefined) {
      if (!Array.isArray(input.grants)) fail(400, '权限集合必须是数组');
      const codes = input.grants.map(grant => grant?.permissionCode);
      if (new Set(codes).size !== codes.length) fail(400, '角色不能重复绑定同一权限');
      const definitions = Object.fromEntries((await repository.permissionDefinitions()).map(item => [item.code, item]));
      if (codes.some(code => !definitions[code])) fail(400, '角色包含未知权限');
      for (const grant of input.grants) validateGrant(definitions[grant.permissionCode], grant, actor, platform.authorizer);
    }
    const result = await repository.updateRole(id, input, input.revision, { actorMemberId: context.actor.memberId, actorAccount: actor.account, authVersion:context.authVersion, action: 'authorization.grant.updated', sourceRef: publicResourceRef('authorization','role',id), after: input, requestId: input.requestId }); if (!result) fail(409, '角色或权限已被其他操作修改，请刷新');
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
    const {context} = await requirePermission(actor, 'roles.manage', memberTarget(member, await repository.memberships(memberId)));
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
    const ok = await repository.bindRoles(memberId, input.bindings || [], input.revision, { actorMemberId: context.actor.memberId, actorAccount: actor.account, authVersion:context.authVersion, action: 'authorization.member_roles.updated', sourceRef: publicResourceRef('authorization','member',memberId), after: input.bindings || [], requestId: input.requestId }); if (!ok) fail(409, '成员授权已被其他操作修改，请刷新');
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
    if (!['members.manage', 'roles.manage'].some(code => context.permissions[code])) fail(403, '缺少组织字典读取权限');
    const includeDisabled = query.includeDisabled === '1' || query.includeDisabled === true;
    if (kind === 'campuses') return { items: await repository.listCampuses(includeDisabled) };
    if (kind === 'departments') return { items: await repository.listDepartments(includeDisabled) };
    if (kind === 'locations') return { items: await repository.listLocations(query.campusId || '', includeDisabled) };
    fail(404, '组织字典不存在');
  }

  async function importMembers(actor, input) {
    const context = await contextFor(actor);
    if (!context.permissions['members.manage']) fail(403, '缺少权限：members.manage');
    const rows = csvRows(String(input.csv || '').replace(/^\uFEFF/, ''));
    if (rows.length < 2) fail(400, '成员导入至少需要表头和一行数据');
    const headers = rows.shift().map(value => value.trim());
    if (rows.length>200) fail(400,'每次最多导入 200 名成员，请分批导入');
    const roleCodes = new Set((await repository.listRoles()).filter(role=>role.enabled).map(role=>role.code));
    const departments = new Set((await repository.listDepartments()).map(item=>item.id));
    const index = key => headers.indexOf(key);
    for (const key of ['studentId','name','homeCampusId']) if (index(key) < 0) fail(400, `缺少导入列：${key}`);
    const items = rows.map((cells, lineIndex) => {
      if (cells.length !== headers.length) fail(400, `CSV 第 ${lineIndex + 2} 行列数不正确`);
      cells = cells.map(value => value.trim());
      const item = { studentId: cells[index('studentId')], name: cells[index('name')], homeCampusId: cells[index('homeCampusId')],
        departmentId: index('departmentId') >= 0 ? cells[index('departmentId')] : '', assignmentType: index('assignmentType') >= 0 ? cells[index('assignmentType')] : 'primary',
        effectiveFrom: index('effectiveFrom') >= 0 ? cells[index('effectiveFrom')] : dateKey(),
        trainingConfirmed:index('trainingConfirmed')>=0 && cells[index('trainingConfirmed')]==='true',
        workProfiles: index('workProfiles') >= 0 ? cells[index('workProfiles')].split('|').map(value => value.trim()).filter(Boolean) : [],
        roleCodes: index('roleCodes') >= 0 ? cells[index('roleCodes')].split('|').map(value => value.trim()).filter(Boolean) : [],
        authorizedCampuses: index('authorizedCampuses') >= 0 ? cells[index('authorizedCampuses')].split('|').map(value => value.trim()).filter(Boolean) : [] };
      if (!/^\d{6,20}$/.test(item.studentId) || !item.name || !['campus-nanhu','campus-hunnan'].includes(item.homeCampusId)) fail(400, `第 ${lineIndex + 2} 行成员数据不正确`);
      if (item.workProfiles.some(value => !['repair','exchange','office','repair_lead','office_lead'].includes(value))) fail(400, `第 ${lineIndex + 2} 行工作属性不正确`);
      if (item.authorizedCampuses.some(value => !['campus-nanhu','campus-hunnan','南湖','浑南'].includes(value))) fail(400, `第 ${lineIndex + 2} 行授权校区不正确`);
      if (!validDate(item.effectiveFrom) || item.departmentId && !departments.has(item.departmentId) || !['primary','secondary','exchange','temporary'].includes(item.assignmentType)) fail(400,`第 ${lineIndex+2} 行任职或生效日期不正确`);
      if (actor.role !== 'superadmin' && (item.roleCodes.length || item.workProfiles.length || item.authorizedCampuses.length)) fail(403, '角色、工作资格和账号校区授权由最高管理员配置');
      if (item.workProfiles.includes('exchange') && (!item.trainingConfirmed || item.workProfiles.includes('repair'))) fail(400,`第 ${lineIndex+2} 行须确认交流培训通过，且不能同时导入普通维修资格`);
      // Older exchange CSVs used the technician package. Keep accepting them,
      // but bind the distinct exchange role without changing actual membership.
      if (item.workProfiles.includes('exchange')) item.roleCodes=[...new Set(item.roleCodes.map(code=>code==='technician'?'exchange':code))];
      if (item.roleCodes.some(code=>!roleCodes.has(code) || code==='superadmin')) fail(400,`第 ${lineIndex+2} 行角色不存在、已停用或不能通过名单导入`);
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
    const memberRows = await repository.importMembers(items,actor.account,{ actorMemberId: context.actor.memberId, actorAccount: actor.account, action: 'identity.members.imported', sourceRef: publicResourceRef('identity','import',input.requestId || crypto.randomUUID()), after: { count: items.length }, requestId: input.requestId });
    const byStudentId = Object.fromEntries(memberRows.map(row => [row.student_id, row]));
    const result = items.map(item => ({ memberId: byStudentId[item.studentId]?.id || `member-${item.studentId}`, studentId: item.studentId, name: item.name, status: 'updated' }));
    return { mode: 'confirmed', items: result, count: result.length, requestId: input.requestId || '' };
  }

  async function deskSummary(actor, query = {}) {
    if (!this.field?.enabled) fail(404, '现场工作台尚未启用');
    if (query.businessDate && query.businessDate !== dateKey()) fail(400, '接待现场仅展示今天，请通过记录页面查询历史');
    // Keep the compatibility URL behind the same role, scope and field projection
    // as the current desk; a summary-read grant alone does not open the staff board.
    const board = await this.field.board(actor, { ...query, campusId: query.campusId ? normalizeCampusId(query.campusId) : undefined });
    const counts = Object.fromEntries(['booked','in_progress','completed','cancelled','expired'].map(status => [status, board.appointments.filter(item => item.status === status).length]));
    return { ...board, counts };
  }

  async function createAttendanceEvent(actor, input) {
    await requirePermission(actor, 'attendance.session.manage', { campusId: input.campusId });
    const type = ['duty','meeting'].includes(input.type) ? input.type : 'duty';
    const businessDate = input.businessDate || dateKey();
    const startsAt = instant(input.startsAt || `${businessDate}T18:30:00+08:00`); const endsAt = instant(input.endsAt || `${businessDate}T21:30:00+08:00`);
    if (endsAt <= startsAt) fail(400, '签到窗口不正确');
    if (!validDate(businessDate)) fail(400, '签到日期不正确');
    const context = await contextFor(actor);
    return withReceipt(actor, 'attendance.event.create', input, async () => {
      const created = await repository.createEvent({ type, policyCode: input.policyCode || `${type}.v1`, policyVersion: input.policyVersion || '1.0.0', ruleSnapshot: input.ruleSnapshot || { timezone: 'Asia/Shanghai' }, campusId: input.campusId || null, businessDate, startsAt, endsAt, sourceRef: input.sourceRef || {} }, context.actor.memberId,
        { actorMemberId: context.actor.memberId, actorAccount: actor.account, authVersion:context.authVersion, action: 'attendance.event.created', after:{type,businessDate,campusId:input.campusId,startsAt,endsAt}, requestId: input.requestId });
      if(!created)fail(409,'权限已变化，请重新登录后重试');
      return created;
    });
  }
  async function issueAttendanceToken(actor, eventId, input = {}) {
    const context = await contextFor(actor); const event = await repository.attendanceEvent?.(eventId);
    if (!event) fail(404, '签到场次不存在');
    await requirePermission(actor, 'attendance.session.manage', { campusId: event.campusId });
    const token = randomToken(); const expiresAt = instant(input.expiresAt || event.endsAt);
    if (Date.parse(expiresAt) <= Date.now() || Date.parse(expiresAt) > Date.parse(event.endsAt)) fail(400, '签到凭证到期时间不正确');
    const result = await repository.issueToken(eventId, await tokenDigest(token), expiresAt, context.actor.memberId, input.revision ?? event.revision);
    if (!result) fail(409, '签到场次已被更新，请刷新');
    return { eventId, token: `pioneer:attendance:v1:${token}`, version: result.version, expiresAt: result.expires_at, tokenId: result.id };
  }
  async function attendanceCredential(actor, input) {
    if (typeof input.token !== 'string' || !input.token.trim() || input.token.length > 256) fail(400, '签到凭证不正确');
    const rawToken = input.token?.startsWith('pioneer:attendance:v1:') ? input.token.slice('pioneer:attendance:v1:'.length) : input.token;
    if (!rawToken) fail(400, '签到凭证不正确');
    const found = await repository.findEventByToken(await tokenDigest(rawToken)); if (!found) fail(404, '签到凭证已失效');
    const { event } = found;
    const authorization = await requirePermission(actor, 'attendance.self', { campusId: event.campusId });
    const context = authorization.context;
    const campusNames = { 'campus-nanhu': '南湖', 'campus-hunnan': '浑南' };
    if (event.campusId && !(actor.authorizedCampuses || []).some(value => value === event.campusId || value === campusNames[event.campusId])) fail(403, '没有该校区的签到权限');
    const policy = policyFor(event); if (!policy) fail(400, '签到策略不存在');
    const now = nowIso(); if (!eventWindow(event.startsAt, event.endsAt, now)) fail(409, '当前不在签到时间窗口');
    const eligible = policy.checkEligibility({ event, context: { ...context, attendanceEligible: authorization.result.allowed } }); if (!eligible) fail(403, '当前成员没有该场次的签到资格');
    return { found, event, context, policy, now };
  }
  async function checkIn(actor, input) {
    // Public requests prove QR possession only. Hardware evidence must come from a
    // trusted server adapter; body flags cannot attest NFC or manual attendance.
    if (input.method !== undefined && input.method !== 'qr') fail(403, '此入口仅支持扫码签到，补录请使用考勤修正');
    const { found, event, context, policy, now } = await attendanceCredential(actor, input);
    const dedupeKey = policy.getDedupeScope({ memberId: context.actor.memberId, event });
    const existing = await repository.findAttendanceByDedupe(dedupeKey); if (existing) return { ...existing, isExisting: true, result: policy.describeResult(existing) };
    const method = attendanceMethod(input.method);
    const occurredAt = now;
    if (!eventWindow(event.startsAt, event.endsAt, occurredAt)) fail(400, '签到发生时间不在场次窗口内');
    const record = await withReceipt(actor, 'attendance.checkin', input, async () => {
      const created = await repository.insertAttendance({ id: crypto.randomUUID(), memberId: context.actor.memberId, eventId: event.id, dedupeKey, occurredAt, recordedAt: now, method, sourceRef: event.sourceRef, campusId: event.campusId, businessDate: event.businessDate, departmentId: context.memberships.find(item => item.isPrimary)?.departmentId, departmentName: context.memberships.find(item => item.isPrimary)?.departmentName, identitySnapshot: { name: context.actor.name, memberId: context.actor.memberId, identities:context.identities }, nonScheduled: !context.todayDuties.some(duty=>duty.campusId===event.campusId), actorAccount: actor.account,
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
    const { event } = await attendanceCredential(actor, input);
    const campusName = { 'campus-nanhu':'南湖', 'campus-hunnan':'浑南' }[event.campusId];
    return { campusName, businessDate:event.businessDate, startsAt:event.startsAt, endsAt:event.endsAt, type:event.type };
  }
  async function attendanceList(actor, query) {
    const context = await contextFor(actor);
    const filters = { memberId:query?.memberId,businessDate:query?.businessDate,month:query?.month,departmentId:query?.departmentId,type:inputString(query || {},'type',80),campusId:query?.campusId ? normalizeCampusId(query.campusId) : undefined };
    if (query?.businessDate && !validDate(query.businessDate)) fail(400, '签到日期不正确');
    if(query?.month && !validDate(`${query.month}-01`)) fail(400,'月份不正确');
    const all = query?.all === true || query?.all === '1' || query?.all === 'true';
    const otherMember = query?.memberId && query.memberId !== context.actor.memberId;
    const managing = all || otherMember;
    // A requested historical/future date selects records, never the actor's
    // grant version. Check every record with one complete current grant.
    if (managing && !context.permissions['attendance.correct']) fail(403, '没有查看其他成员签到记录的权限');
    if (all) {
      filters.memberId=query?.memberId || undefined;
    } else {
      if (!otherMember) await requirePermission(actor, 'attendance.self', { memberId: context.actor.memberId });
      filters.memberId = query?.memberId || context.actor.memberId;
    }
    let after;
    if (query?.cursor) {
      try {
        if (typeof query.cursor !== 'string' || query.cursor.length > 2048) throw new Error();
        const parts = JSON.parse(decodeURIComponent(query.cursor));
        if (!Array.isArray(parts) || parts.length !== 2 || typeof parts[0] !== 'string' || !Number.isFinite(Date.parse(parts[0])) || typeof parts[1] !== 'string' || !parts[1] || parts[1].length > 128) throw new Error();
        after = {occurredAt:parts[0],id:parts[1]};
      } catch { fail(400, '签到分页游标不正确'); }
    }
    const items = [], definition = {unit:'attendance_record',timezone:'Asia/Shanghai',version:'1.0.0'};
    for (;;) {
      const records = await repository.listAttendance({...filters,after});
      for (const record of records) {
        if (managing && !evaluate(context, 'attendance.correct', {
          id:record.id,memberId:record.memberId,campusId:record.campusId,departmentId:record.primaryDepartmentIdSnapshot
        }).allowed) continue;
        items.push(record);
        if (items.length === 101) return {items:items.slice(0,100),nextCursor:encodeURIComponent(JSON.stringify([items[99].occurredAt,items[99].id])),definition};
      }
      if (records.length < 101) return {items,nextCursor:null,definition};
      const last = records.at(-1); after = {occurredAt:last.occurredAt,id:last.id};
    }
  }
  async function attendanceOptions(actor,query={}) {
    const context=await contextFor(actor);
    if(!context.permissions['attendance.correct']) fail(403,'没有考勤修正权限');
    const businessDate=query.businessDate || dateKey(),campusId=normalizeCampusId(query.campusId);
    if(!validDate(businessDate) || !campusId) fail(400,'请选择有效日期和校区');
    const result=await repository.attendanceOptions({businessDate,campusId,q:inputString(query,'q',80)});
    const events=result.events.filter(item=>(context.grants || []).some(grant=>(grant.scope?.departmentIds || grant.scope?.departments || [undefined]).some(departmentId=>
      platform.authorizer.evaluate(context.actor,'attendance.correct',{id:item.id,campusId:item.campusId,departmentId},context,[grant]).allowed)));
    const members=result.members.filter(member=>events.some(item=>evaluate(context,'attendance.correct',{id:item.id,memberId:member.memberId,campusId:item.campusId,departmentId:member.departmentId}).allowed));
    const identities=await repository.fieldContexts(members.map(item=>item.memberId),businessDate);
    return {events,members:members.map(member=>({...member,identities:identities.has(member.memberId)?staffIdentities(identities.get(member.memberId),platform.authorizer,{campusId}):[]}))};
  }
  async function attendanceExport(actor, query = {}) {
    const month = query.month === undefined ? dateKey().slice(0, 7) : query.month;
    if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) fail(400, '月份不正确');
    const [year, monthNumber] = month.split('-').map(Number);
    if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) fail(400, '月份不正确');
    const next = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
    const context = await contextFor(actor);
    if (!context.permissions['attendance.export']) fail(403, '没有导出考勤的权限');
    const names = { '南湖': 'campus-nanhu', '浑南': 'campus-hunnan' };
    const requestedCampus = query.campusId || '';
    if (requestedCampus && !['campus-nanhu','campus-hunnan'].includes(requestedCampus)) fail(400, '校区不正确');
    const allowed = actor.authorizedCampuses || [];
    const campusIds = (requestedCampus ? [requestedCampus] : allowed.map(item => names[item] || item)).filter(Boolean);
    if (!campusIds.length) fail(403, '没有可导出的校区');
    const candidates = await repository.attendanceExport({ month, nextMonth: next, campusIds, memberId: query.memberId, departmentId: query.departmentId });
    const rows = candidates.filter(row => evaluate(context, 'attendance.export', {
      campusId: row.campusId, memberId: row.memberId, departmentId: row.departmentId
    }).allowed);
    const header = ['校区','人员','学号','签到次数','部门'];
    const body = rows.map(row => csvLine([row.campus,row.memberName,row.studentId ? `'${row.studentId}` : '',row.attendanceCount,row.department]));
    return { month, rows, csv: `\uFEFF${header.join(',')}\r\n${body.join('')}` };
  }
  async function correctAttendance(actor, input) {
    if (typeof input.memberId !== 'string' || !input.memberId || input.memberId.length > 128 ||
      typeof input.eventId !== 'string' || !input.eventId || input.eventId.length > 128 ||
      typeof input.occurredAt !== 'string' || !input.occurredAt || input.occurredAt.length > 80 || !input.reason) fail(400, '补录签到字段不完整');
    const reason = inputString(input, 'reason', 500, true);
    if (input.requestId !== undefined && !requestId(input.requestId)) fail(400, '请求编号不正确');
    if (!Number.isFinite(Date.parse(input.occurredAt))) fail(400, '补录时间不正确');
    const context = await contextFor(actor);
    const previousRecord=input.recordId ? await repository.attendanceById(input.recordId) : null;
    if(input.recordId && (!previousRecord || previousRecord.memberId!==input.memberId || previousRecord.eventId!==input.eventId)) fail(404,'签到记录不存在');
    const occurredAt = instant(input.occurredAt);
    const fingerprint = await repository.attendanceCorrectionFingerprint(input.memberId,input.eventId,context.actor.memberId,context.businessDate,occurredAt);
    const event = await repository.attendanceEvent?.(input.eventId); if (!event) fail(404, '签到场次不存在');
    if (input.campusId && normalizeCampusId(input.campusId) !== event.campusId || input.businessDate && input.businessDate !== event.businessDate) fail(400, '补录范围与签到场次不一致');
    if (!eventWindow(event.startsAt, event.endsAt, occurredAt) || Date.parse(occurredAt) > Date.now()) fail(400, '补录时间必须位于场次窗口内且不能晚于现在');
    const primary = previousRecord ? {departmentId:previousRecord.primaryDepartmentIdSnapshot,departmentName:previousRecord.primaryDepartmentNameSnapshot} : (await repository.memberships(input.memberId, dateKey(new Date(occurredAt)))).find(item => item.isPrimary) || null;
    if (!evaluate(context, 'attendance.correct', { id:event.id, memberId:input.memberId, campusId:event.campusId, departmentId:primary?.departmentId }).allowed) fail(403, '没有修正该校区与部门考勤的权限');
    const policy = policyFor(event); if (!policy) fail(400, '签到策略不存在');
    if (!policy.checkEligibility({event,context:{actor:{memberId:input.memberId},attendanceEligible:true}})) fail(403, '该成员不在此场次的可参加范围内');
    const dedupeKey = policy.getDedupeScope({ memberId: input.memberId, event });
    const target = await repository.memberRow(input.memberId); if (!target) fail(404, '成员不存在');
    const receipt = { action:'attendance.correct',id:requestId(input.requestId) || crypto.randomUUID(),hash:await tokenDigest(stableJson(input)) };
    const replay = async () => {
      const previous = await repository.receipt(context.actor.memberId,receipt.action,receipt.id);
      if (!previous) return null;
      if (previous.payloadHash !== receipt.hash) fail(409, '请求编号已用于其他内容', 'REQUEST_CONFLICT');
      if (previous.resultStatus !== 'success') fail(409, '补录正在处理中，请稍后重试', 'REQUEST_CONFLICT');
      return {...previous.result,idempotent:true};
    };
    const previous = await replay(); if (previous) return previous;
    if(previousRecord && (!Number.isInteger(input.revision) || input.revision!==previousRecord.revision)) fail(409,'签到已被其他人修正，请刷新后核对');
    const duties = await repository.todayDuties(input.memberId,event.businessDate);
    if (fingerprint !== await repository.attendanceCorrectionFingerprint(input.memberId,input.eventId,context.actor.memberId,context.businessDate,occurredAt)) fail(409, '成员资料、当日岗位或签到场次已变化，请重新核对');
    const created = await repository.correctAttendance({ id:previousRecord?.id || crypto.randomUUID(),previous:previousRecord,memberId:input.memberId,eventId:input.eventId,dedupeKey,occurredAt,recordedAt:nowIso(),
      sourceRef:event.sourceRef,departmentId:primary?.departmentId,departmentName:primary?.departmentName || 'unknown',
      identitySnapshot:{name:target.name,studentId:target.student_id || '',memberId:target.id},nonScheduled:!duties.length },
    {actorMemberId:context.actor.memberId,actorAccount:actor.account,authVersion:context.authVersion,businessDate:context.businessDate,action:'attendance.corrected',reason,requestId:receipt.id},receipt,fingerprint);
    if (created) return created;
    const concurrent = await replay(); if (concurrent) return concurrent;
    fail(409, '签到已存在，或成员资料、授权、场次已变化，请刷新后核对');
  }
  async function presence(actor, input) {
    if (input.businessDate && input.businessDate !== dateKey()) fail(400, '只能修改今天的在岗状态');
    const context = await contextFor(actor, input.businessDate || dateKey());
    if (!['available','away','off_duty'].includes(input.state)) fail(400, '在岗状态不正确');
    if (!context.presence) fail(409, '请先完成到岗签到');
    await requirePermission(actor, 'attendance.self', { campusId: context.presence.campusId });
    if (input.campusId && input.campusId !== context.presence.campusId) fail(409, '在岗校区以签到记录为准');
    if (input.state !== 'available' && await repository.activeRepair(context.actor.memberId)) fail(409, '当前仍有进行中的维修，不能离岗', 'PRESENCE_CHANGED');
    const result = await repository.setPresence(context.actor.memberId, { ...input, businessDate: input.businessDate || dateKey() }, input.revision ?? 0, context.actor,
      {actorMemberId:context.actor.memberId,actorAccount:actor.account,authVersion:context.authVersion,action:'duty.presence.changed',sourceRef:publicResourceRef('duty','presence',`${context.actor.memberId}:${context.businessDate}`),before:context.presence,after:{state:input.state,campusId:context.presence.campusId},requestId:input.requestId});
    if (!result) fail(409, '在岗状态已被其他操作修改，请刷新');
    return result;
  }

  async function rosterOwnFact(context, task) {
    return (await repository.rosterMemberFacts([context.actor.memberId],task.weekStart)).find(item => item.memberId === context.actor.memberId);
  }
  function rosterParticipant(context, task, fact) {
    if (task.dutyType === 'office' && task.workflowVersion!==1 || !validDate(task.weekStart) || task.memberIds?.length && !task.memberIds.includes(context.actor.memberId) || !fact?.active) return false;
    return Array.from({length:4},(_,offset) => addDays(task.weekStart,offset)).some(day =>
      (task.dutyType==='office' ? fact.profiles.some(item=>item.profileCode==='office'&&item.effectiveFrom<=day&&(!item.effectiveTo||day<item.effectiveTo)) : !!repairRosterPool(fact,platform.authorizer,day,{id:task.id,campusIds:rosterScope(task).campusIds})) &&
      rosterScope(task).campusIds.some(campusId => rosterMemberReadable(context,platform.authorizer,fact,task,day,campusId)));
  }
  async function rosterOptions(actor, query = {}) {
    const dutyType = query.dutyType || 'repair';
    if (!['repair','office'].includes(dutyType)) fail(400,'岗位类型不正确');
    const context = await contextFor(actor), code = dutyType === 'office' ? 'roster.office.manage' : 'roster.repair.manage';
    if (!context.permissions[code]) fail(403,'没有创建此类排班任务的权限');
    const [campuses,departments] = await Promise.all([repository.listCampuses(),repository.listDepartments()]);
    return {items:campuses.map(campus => {
      const task = departmentIds => ({dutyType,campusScope:{campusIds:[campus.id],...(departmentIds.length ? {departmentIds} : {})}});
      return {campusId:campus.id,name:campus.name,allDepartments:rosterTaskManaged(context,platform.authorizer,task([])),
        departments:departments.filter(department => rosterTaskManaged(context,platform.authorizer,task([department.id])))};
    }).filter(campus => campus.allDepartments || campus.departments.length)};
  }
  async function rosterCandidates(actor,input) {
    const task=input.campusScope ? input : {...input,dutyType:input.dutyType || 'repair',campusScope:{campusIds:input.campusIds || [],departmentIds:input.departmentIds || []}};
    if(!validDate(task.weekStart) || !rosterScope(task).valid) fail(400,'请先选择工作周和校区');
    const context=await contextFor(actor);
    if(!rosterTaskManaged(context,platform.authorizer,task)) fail(403,'没有管理此范围排班的权限');
    const facts=await repository.rosterMemberFacts(await repository.rosterAudience(),task.weekStart);
    const items=facts.filter(fact=>fact.active && Array.from({length:4},(_,i)=>addDays(task.weekStart,i)).some(day=>rosterScope(task).campusIds.some(campusId=>rosterMemberInScope(fact,task,day,campusId) && (task.dutyType==='office' ? fact.profiles.some(item=>item.profileCode==='office'&&item.effectiveFrom<=day&&(!item.effectiveTo||day<item.effectiveTo)) : (rosterDepartments(fact,day,task).length ? rosterDepartments(fact,day,task) : [{}]).some(item=>repairRosterPool(fact,platform.authorizer,day,{campusId,departmentId:item.departmentId}))))));
    return {items:items.map(fact=>({memberId:fact.memberId,name:fact.name,identities:staffIdentities(rosterFactContext(fact,task.weekStart),platform.authorizer)}))};
  }
  const commandRecord=(actor,context,input)=>({actorMemberId:context.actor.memberId,actorAccount:actor.account,authVersion:context.authVersion,requestId:requestId(input.requestId) || crypto.randomUUID()});
  const configurableCampuses=(context,task)=>rosterScope(task).campusIds.filter(campusId=>rosterTaskManaged(context,platform.authorizer,{...task,campusScope:{...task.campusScope,campusIds:[campusId]}},task.dutyType==='office'?'roster.office.manage':'roster.repair.configure'));
  async function collectionCommand(actor,taskId,input) {
    const task=await repository.rosterTaskById(taskId),context=await contextFor(actor);
    if(!task) fail(404,'收集任务不存在');
    if(!rosterTaskManaged(context,platform.authorizer,task)) fail(403,'没有结束或重新开放收集的权限');
    const record=commandRecord(actor,context,input);
    const replay=await repository.rosterCommandReceipt(record.actorMemberId,'collection',record.requestId);
    if(replay) {
      if(replay.resourceId!==taskId || replay.payload!==JSON.stringify(input)) fail(409,'请求编号已用于其他操作');
      return repository.rosterTaskById(taskId);
    }
    if(!['close','reopen'].includes(input.action) || input.revision!==task.revision) fail(409,'任务状态已更新，请刷新核对');
    if(input.action==='reopen' && (!Number.isFinite(Date.parse(input.deadline)) || Date.parse(input.deadline)<=Date.now())) fail(400,'请选择未来的截止时间');
    try {await repository.changeCollection(task,input,record);} catch(error) {if(String(error.message).includes('constraint')) fail(409,'任务或权限已变化，请刷新核对');throw error;}
    if(input.action==='close'&&task.seriesId) await currentCollectionPeriods(actor,context,await repository.listRosterTasks());
    return repository.rosterTaskById(taskId);
  }
  async function addParticipants(actor,taskId,input) {
    const task=await repository.rosterTaskById(taskId),context=await contextFor(actor);
    if(!task)fail(404,'收集任务不存在');
    if(!rosterTaskManaged(context,platform.authorizer,task))fail(403,'没有增补参与人员的权限');
    const record=commandRecord(actor,context,input),replay=await repository.rosterCommandReceipt(record.actorMemberId,'participants',record.requestId);
    if(replay){if(replay.resourceId!==taskId||replay.payload!==JSON.stringify(input))fail(409,'请求编号已被使用');return repository.rosterTaskById(taskId);}
    if(input.revision!==task.revision||!Array.isArray(input.memberIds)||!input.memberIds.length||new Set([...task.memberIds,...input.memberIds]).size>300)fail(400,'请核对任务版本与增补名单');
    const candidates=await rosterCandidates(actor,task);
    if(input.memberIds.some(id=>!candidates.items.some(member=>member.memberId===id)))fail(403,'增补人员必须具有本任务范围的有效排班资格');
    try{await repository.addRosterParticipants(task,input,record);}catch(error){if(String(error.message).includes('constraint'))fail(409,'任务或权限已变化，请刷新核对');throw error;}
    return repository.rosterTaskById(taskId);
  }
  async function submitAvailability(actor,taskId,input,{carried=false,preferenceRevision,continuationAt}={}) {
    const task=await repository.rosterTaskById(taskId),context=await contextFor(actor);
    if(!task) fail(404,'收集任务不存在');
    const fact=await rosterOwnFact(context,task);
    if(!rosterParticipant(context,task,fact)) fail(403,'你不在本次收集范围内');
    const record=commandRecord(actor,context,input),replay=await repository.rosterCommandReceipt(record.actorMemberId,'availability',record.requestId);
    if(replay) {
      if(replay.resourceId!==taskId || replay.payload!==JSON.stringify({...input,carried})) fail(409,'请求编号已用于其他填报');
      return taskAvailability(actor,taskId);
    }
    const state=collectionStatus(task),continuationClosed=carried&&state==='closed'&&continuationAt===continuationCutoff(task);
    if(state!=='open'&&!continuationClosed) fail(409,'收集已结束，请联系负责人重新开放');
    if(!Array.isArray(input.windows) || input.windows.length>64 || !input.windows.length && input.unavailable!==true || input.windows.length && input.unavailable) fail(400,'请填写可用时间，或选择整周无法参加');
    for(const window of input.windows) {
      if(window.startAt!==task.slotStart||window.endAt!==task.slotEnd) fail(400,'请选择完整值班日期和校区，不能只参加部分班次');
      if(!validDate(window.businessDate) || window.businessDate<task.weekStart || window.businessDate>addDays(task.weekStart,3) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.startAt) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.endAt) || window.endAt<=window.startAt) fail(400,'请填写本周工作日的有效时间');
      if(!rosterMemberReadable(context,platform.authorizer,fact,task,window.businessDate,window.campusId) || !(task.dutyType==='office' ? fact.profiles.some(item=>item.profileCode==='office'&&item.effectiveFrom<=window.businessDate&&(!item.effectiveTo||window.businessDate<item.effectiveTo)) : (rosterDepartments(fact,window.businessDate,task).length ? rosterDepartments(fact,window.businessDate,task) : [{}]).some(item=>repairRosterPool(fact,platform.authorizer,window.businessDate,{campusId:window.campusId,departmentId:item.departmentId})))) fail(403,'填报日期或校区不在有效资格和授权范围内');
    }
    const payload={...input,carried};
    try {await repository.replaceRosterAvailability(task,context.actor.memberId,payload,{...record,preferenceRevision,continuationAt,continuationClosed});} catch(error) {if(String(error.message).toLowerCase().includes('constraint')) fail(409,'填报、收集状态或权限已变化，输入已保留，请重新核对');throw error;}
    return taskAvailability(actor,taskId);
  }
  async function collectionMember(memberId) {
    const row=await repository.accountForMember(memberId);
    if(!row||row.status!=='enabled')fail(403,'收集任务负责人账号已停用，请联系管理员接管');
    return {account:row.account,memberId,role:row.role,homeCampus:row.home_campus,authorizedCampuses:await repository.memberCampuses(memberId),authVersion:row.auth_version};
  }
  async function currentCollectionPeriods(actor,context,tasks) {
    const ids=[...new Set(tasks.map(task=>task.seriesId).filter(Boolean))];
    for(const id of ids){
      const series=await repository.rosterSeries(id);
      if(!series?.enabled)continue;
      const template=await repository.rosterTaskById(series.template_task_id);
      if(!template)continue;
      const own=await rosterOwnFact(context,template);
      if(!rosterTaskManaged(context,platform.authorizer,template)&&!rosterParticipant(context,template,own)&&!configurableCampuses(context,template).length)continue;
      const first=tasks.filter(task=>task.seriesId===id).sort((a,b)=>a.weekStart.localeCompare(b.weekStart))[0];
      const week=recurringPeriodWeek(series,first.weekStart,calendarClock());
      if(tasks.some(task=>task.seriesId===id&&task.weekStart===week))continue;
      // Only opening the ordinary collection resolves the current period. There
      // is no cron, timer, catch-up queue or future task publication.
      try{
        const owner=await collectionMember(series.owner_member_id);
        const candidates=await rosterCandidates(owner,{...template,weekStart:week});
        const memberIds=template.memberIds.filter(id=>candidates.items.some(item=>item.memberId===id));
        if(!memberIds.length){for(const task of tasks.filter(task=>task.seriesId===id))task.collectionIssue='当前参与名单已无符合条件的人员，请负责人更新收集设置。';continue;}
        const period=await createRosterTask(owner,{weekStart:week,campusIds:template.campusScope.campusIds,departmentIds:template.campusScope.departmentIds||[],dutyType:template.dutyType,
          slotStart:template.slotStart,slotEnd:template.slotEnd,collectionOpensAt:new Date(Math.min(calendarClock().getTime(),Date.parse(collectionInstant(addDays(week,-7),series.deadline_weekday,series.deadline_time)))).toISOString(),deadline:collectionInstant(week,series.deadline_weekday,series.deadline_time),description:template.description,memberIds,workflowVersion:1,seriesId:id,
          requirements:template.requirements.map(row=>({...row,businessDate:addDays(week,Math.round((Date.parse(row.businessDate)-Date.parse(template.weekStart))/86400000))})),requestId:`period:${id}:${week}`},{period:true,allowClosedPeriod:true});
        tasks.push(period);
      }catch(error){
        if(error.status===403){for(const task of tasks.filter(task=>task.seriesId===id))task.collectionIssue='收集负责人的账号或授权已变化，请有管理权限的负责人保存收集设置后继续。';continue;}
        if(error.status!==409)throw error;
        const concurrent=(await repository.listRosterTasks()).find(task=>task.seriesId===id&&task.weekStart===week);
        if(concurrent)tasks.push(concurrent);else for(const task of tasks.filter(task=>task.seriesId===id))task.collectionIssue='当前工作周已有重叠任务，请负责人核对范围后继续。';
      }
    }
    return tasks.sort((a,b)=>b.weekStart.localeCompare(a.weekStart));
  }
  function continuationCutoff(task) {
    return new Date(Math.min(calendarClock().getTime(),Date.parse(task.deadline),task.collectionClosedAt?Date.parse(task.collectionClosedAt):Infinity)).toISOString();
  }
  async function applyAvailabilityContinuation(task,memberId) {
    if(collectionStatus(task)==='scheduled'||!repository.pendingRosterPreferences)return;
    const continuationAt=continuationCutoff(task);
    for(const preference of await repository.pendingRosterPreferences(task.id,continuationAt)){
      if(memberId&&preference.member_id!==memberId)continue;
      try{
        const actor=await collectionMember(preference.member_id);
        const origin=await repository.rosterTaskById(preference.source_task_id);
        const windows=JSON.parse(preference.windows).filter(window=>task.campusScope.campusIds.includes(window.campusId)&&origin&&window.startAt<=origin.slotStart&&window.endAt>=origin.slotEnd).map(({weekday,...window})=>({...window,startAt:task.slotStart,endAt:task.slotEnd,businessDate:addDays(task.weekStart,weekday-1)}));
        if(!preference.unavailable&&!windows.length)continue;
        await submitAvailability(actor,task.id,{windows,unavailable:!!preference.unavailable,revision:-1,requestId:`carry:${task.id}:${preference.member_id}:${preference.revision}`},{carried:true,preferenceRevision:preference.revision,continuationAt});
      }catch(error){if(![403,409].includes(error.status))throw error;}
    }
  }
  async function seriesCommand(actor,id,input) {
    const series=await repository.rosterSeries(id),context=await contextFor(actor);
    if(!series)fail(404,'循环收集不存在');
    const task=await repository.rosterTaskById(series.template_task_id);
    if(!rosterTaskManaged(context,platform.authorizer,task))fail(403,'没有管理此循环任务的权限');
    const record=commandRecord(actor,context,input),signature=stableJson({id,input});
    const replay=await repository.rosterCommandReceipt(record.actorMemberId,'series',record.requestId);
    if(replay){if(JSON.parse(replay.payload).signature!==signature)fail(409,'请求编号已用于其他循环设置');return repository.rosterSeries(id);}
    if(input.revision!==series.revision||typeof input.enabled!=='boolean')fail(409,'循环配置已变化，请重新读取');
    if(input.name!==undefined&&(typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>80))fail(400,'收集名称须为 1–80 个字符');
    if(input.recurrence&&!validateRecurrence(input.recurrence))fail(400,'请设置每周截止星期和时间（值班前一周）');
    const template=input.templateTaskId?await repository.rosterTaskById(input.templateTaskId):task;
    if(!template||template.seriesId!==id||!rosterTaskManaged(context,platform.authorizer,template))fail(403,'不能使用此周次作为后续收集设置');
    if(input.templateTaskId&&input.templateRevision!==template.revision)fail(409,'本周设置已变化，请重新读取后再应用到后续周期');
    await rosterWrite(()=>repository.updateRosterSeries(series,{...input,name:input.name?.trim()??series.name,templateTaskId:template.id,templateRevision:template.revision,
      recurrence:input.recurrence||{publishWeekday:series.publish_weekday,publishTime:series.publish_time,deadlineWeekday:series.deadline_weekday,deadlineTime:series.deadline_time},signature},record));
    return repository.rosterSeries(id);
  }
  async function availabilityPreferences(actor,input) {
    const context=await contextFor(actor);
    if(input){if(!['repair','office'].includes(input.dutyType)||input.enabled!==false)fail(400,'请选择需要关闭的自动延续');await repository.disableRosterPreference(context.actor.memberId,input.dutyType);}
    return {items:await repository.rosterPreferences(context.actor.memberId)};
  }
  async function rosterTasks(actor) {
    const context = await contextFor(actor);
    if (!['roster.read','roster.repair.manage','roster.office.manage','roster.repair.configure'].some(code => context.permissions[code])) fail(403, '没有查看排班任务的权限');
    const [storedTasks,departments,campuses] = await Promise.all([repository.listRosterTasks(),repository.listDepartments(true),repository.listCampuses(true)]);
    const tasks=await currentCollectionPeriods(actor,context,storedTasks);
    const ownFacts = new Map(), items = [];
    for (const task of tasks) {
      const manage = rosterTaskManaged(context,platform.authorizer,task);
      const writableCampuses=configurableCampuses(context,task);
      const configure = writableCampuses.length>0;
      if (context.permissions['roster.read'] && !ownFacts.has(task.weekStart)) ownFacts.set(task.weekStart,await rosterOwnFact(context,task));
      const fill = rosterParticipant(context,task,ownFacts.get(task.weekStart));
      if (!manage && !fill && !configure) continue;
      const scope = rosterScope(task);
      const label = [...scope.campusIds.map(id => campuses.find(item => item.id === id)?.name || id),
        ...scope.departmentIds.map(id => departments.find(item => item.id === id)?.name || id)];
      const {memberIds,createdByMemberId,...summary} = task;
      items.push({...summary,...(!manage&&!fill ? {campusScope:{...task.campusScope,campusIds:writableCampuses},requirements:summary.requirements.filter(item=>writableCampuses.includes(item.campusId))}:{}),collectionState:collectionStatus(task),...(manage ? {memberIds,createdByMemberId} : {}),scopeLabel:!manage&&!fill ? writableCampuses.map(id=>campuses.find(item=>item.id===id)?.name||id).join(' · ') : label.join(' · '),actions:{manage,readOwn:fill,fill:fill && collectionStatus(task)==='open',configure}});
    }
    return {items,collections:rosterCollections(items)};
  }
  async function taskAvailability(actor, taskId) {
    const context = await contextFor(actor);
    const task = await repository.rosterTaskById(taskId);
    if (!task) fail(404,'排班任务不存在');
    const manage = rosterTaskManaged(context,platform.authorizer,task), own = await rosterOwnFact(context,task);
    if (!manage && !rosterParticipant(context,task,own)) fail(403,'没有查看该任务填报信息的权限');
    await applyAvailabilityContinuation(task,context.actor.memberId);
    const rows = await repository.availability(taskId);
    const facts = new Map((await repository.rosterMemberFacts([...new Set(rows.map(row => row.memberId))],task.weekStart)).map(item => [item.memberId,item]));
    const submission=repository.rosterSubmissions ? (await repository.rosterSubmissions(taskId)).find(item=>item.memberId===context.actor.memberId) : null;
    const preference=repository.rosterPreferences ? (await repository.rosterPreferences(context.actor.memberId)).find(item=>item.duty_type===task.dutyType) : null;
    const selectableSlots=Array.from({length:4},(_,i)=>addDays(task.weekStart,i)).flatMap(businessDate=>rosterScope(task).campusIds.filter(campusId=>own?.active&&rosterMemberReadable(context,platform.authorizer,own,task,businessDate,campusId)&&
      (task.dutyType==='office'?own.profiles.some(profile=>profile.profileCode==='office'&&profile.effectiveFrom<=businessDate&&(!profile.effectiveTo||businessDate<profile.effectiveTo)):!!repairRosterPool(own,platform.authorizer,businessDate,{id:task.id,campusId}))).map(campusId=>({businessDate,campusId})));
    return {submission,selectableSlots,autoContinue:!!preference?.enabled,items:rows.filter(item => rosterMemberInScope(facts.get(item.memberId),task,item.businessDate,item.campusId) &&
      (manage || item.memberId === context.actor.memberId && rosterMemberReadable(context,platform.authorizer,own,task,item.businessDate,item.campusId)))};
  }
  async function createRosterTask(actor, input, {period=false,allowClosedPeriod=false}={}) {
    const dutyType = input.dutyType || 'repair';
    if (!['repair','office'].includes(dutyType)) fail(400, '岗位类型不正确');
    if(input.collectionName!==undefined&&(typeof input.collectionName!=='string'||input.collectionName.trim().length>80))fail(400,'收集名称最多 80 个字符');
    if (!validDate(input.weekStart) || weekRange(input.weekStart).start !== input.weekStart || !(input.campusId || input.campusIds?.length) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.slotStart) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.slotEnd) || input.slotEnd <= input.slotStart ||
      !Number.isFinite(Date.parse(input.deadline))) fail(400, '请选择周一、有效校区、完整班次时间和填报截止时间');
    if(!period&&input.workflowVersion===1&&dutyEnd(input.slotStart)!==input.slotEnd) fail(400,'每次值班须为完整两小时，请调整开始时间');
    if (input.departmentIds !== undefined && (!Array.isArray(input.departmentIds) || input.departmentIds.length > 100 || input.departmentIds.some(id => typeof id !== 'string' || !id.trim()))) fail(400,'部门范围不正确');
    if (input.memberIds !== undefined && (!Array.isArray(input.memberIds) || input.memberIds.length > 300 || input.memberIds.some(id => typeof id !== 'string' || !id.trim()))) fail(400,'邀请名单不正确');
    const departmentIds = [...new Set(input.departmentIds || [])].sort();
    if(input.campusIds!==undefined && (!Array.isArray(input.campusIds) || !input.campusIds.length || input.campusIds.some(id=>typeof id!=='string'))) fail(400,'请选择有效校区');
    const selectedCampuses=[...new Set((input.campusIds || [input.campusId]).map(normalizeCampusId))].sort();
    const task = {...input,id:crypto.randomUUID(),dutyType,memberIds:[...new Set(input.memberIds || [])].sort(),campusScope:{campusIds:selectedCampuses,...(departmentIds.length ? {departmentIds} : {})}};
    if(!period){delete task.seriesId;delete task.collectionOpensAt;}
    if(input.recurrence?.enabled) {
      if(input.workflowVersion!==1||!validateRecurrence(input.recurrence))fail(400,'请设置每周截止星期和时间（值班前一周）');
      task.recurrence={publishWeekday:1,publishTime:'00:00',...input.recurrence};
    }
    if(dutyType==='repair'||input.workflowVersion===1) task.requirements=normalizedRequirements(task,input.requirements);
    const context = await contextFor(actor);
    if (!rosterTaskManaged(context,platform.authorizer,task)) fail(403,'没有管理所选校区与部门排班的权限');
    if(input.workflowVersion===1) {
      const record=commandRecord(actor,context,input),signature=stableJson(input);
      const replay=await repository.rosterCommandReceipt(record.actorMemberId,'create-task',record.requestId);
      if(replay){if(JSON.parse(replay.payload).signature!==signature)fail(409,'请求编号已用于其他任务');return repository.rosterTaskById(replay.resourceId);}
      task.commandRecord=record;task.commandSignature=signature;
    }
    const [campuses,departments] = await Promise.all([repository.listCampuses(),repository.listDepartments()]);
    if (selectedCampuses.some(id=>!campuses.some(item => item.id === id)) || departmentIds.some(id => !departments.some(item => item.id === id))) fail(400,'请选择有效校区和部门');
    if(input.workflowVersion===1) {
      if(!allowClosedPeriod&&Date.parse(input.deadline)<=Date.now()) fail(400,'收集截止时间应晚于现在');
      const candidates=await rosterCandidates(actor,task);
      if(!input.memberIds?.length) task.memberIds=candidates.items.map(item=>item.memberId);
      else if(input.memberIds.some(id=>!candidates.items.some(item=>item.memberId===id))) fail(403,'名单中存在无有效排班资格的成员');
      if(!task.memberIds.length || task.memberIds.length>300) fail(400,'请选择 1–300 名参与人员');
      if((await repository.listRosterTasks()).some(other=>other.dutyType===dutyType && other.weekStart===task.weekStart && other.slotStart<task.slotEnd && task.slotStart<other.slotEnd && rosterScope(other).campusIds.some(id=>selectedCampuses.includes(id)) && (!departmentIds.length || !rosterScope(other).departmentIds.length || departmentIds.some(id=>rosterScope(other).departmentIds.includes(id))))) fail(409,'所选范围已有收集任务，请打开现有任务继续处理');
    }
    const invited = await repository.rosterMemberFacts(task.memberIds,task.weekStart);
    if (invited.length !== task.memberIds.length || invited.some(fact => !Array.from({length:4},(_,offset) => addDays(task.weekStart,offset)).some(day => selectedCampuses.some(campusId=>rosterMemberInScope(fact,task,day,campusId))))) fail(403,'邀请名单包含排班范围外的成员');
    let result;
    try { result = await rosterWrite(()=>repository.createRosterTask(task,context.actor.memberId)); }
    catch (error) { if (String(error.message).includes('UNIQUE constraint failed: roster_tasks.') || String(error.message).includes('ROSTER_TASK_SCOPE_OVERLAP')) fail(409,'本周此校区、部门和时段已有同类任务，请打开现有任务'); throw error; }
    if(!task.commandRecord || !repository.rosterAudit) await repository.audit({ actorMemberId: context.actor.memberId, actorAccount: actor.account, action: 'rosters.task.created', sourceRef: publicResourceRef('rosters','task',result.id), after: result, requestId: input.requestId });
    return result;
  }
  function normalizedRequirements(task,values) {
    const slots=Array.from({length:4},(_,offset)=>rosterScope(task).campusIds.map(campusId=>({businessDate:addDays(task.weekStart,offset),campusId}))).flat();
    if(values===undefined) return slots.map(slot=>({...slot,ordinaryMinimum:1}));
    if(!Array.isArray(values) || values.length!==slots.length || slots.some(slot=>values.filter(item=>item?.businessDate===slot.businessDate && item.campusId===slot.campusId).length!==1) ||
      values.some(item=>!Number.isInteger(item.ordinaryMinimum) || item.ordinaryMinimum<0 || item.ordinaryMinimum>300)) fail(400,'请为周一至周四的每个校区填写 0–300 名普通维修人员最低需求');
    return slots.map(slot=>({...slot,ordinaryMinimum:values.find(item=>item.businessDate===slot.businessDate && item.campusId===slot.campusId).ordinaryMinimum}));
  }
  async function rosterRequirements(actor,taskId,input) {
    const context=await contextFor(actor),task=await repository.rosterTaskById(taskId);
    if(!task) fail(404,'排班任务不存在');
    const writableCampuses=configurableCampuses(context,task);
    if(!writableCampuses.length) fail(403,'没有配置此范围人员需求的权限');
    const visibleTask={...task,memberIds:undefined,campusScope:{...task.campusScope,campusIds:writableCampuses},requirements:task.requirements.filter(item=>writableCampuses.includes(item.campusId))};
    if(!input) return {task:visibleTask,requirements:visibleTask.requirements?.length ? visibleTask.requirements : normalizedRequirements(visibleTask),requiresRuleConfirmation:task.dutyType!=='office'&&task.ruleVersion!=='repair-minimum-v2'};
    if(!Number.isInteger(input.revision) || input.revision!==task.revision) fail(409,'需求已被其他人更新，请刷新后核对；当前输入尚未清除');
    const edited=normalizedRequirements(visibleTask,input.requirements);
    const requirements=normalizedRequirements(task).map(row=>edited.find(item=>item.businessDate===row.businessDate&&item.campusId===row.campusId) || task.requirements.find(item=>item.businessDate===row.businessDate&&item.campusId===row.campusId) || row);
    const result=await repository.saveRosterRequirements(task,{revision:input.revision,requirements},{actorMemberId:context.actor.memberId,actorAccount:actor.account,authVersion:context.authVersion,
      action:'rosters.requirements.updated',sourceRef:publicResourceRef('rosters','task',taskId),before:{requirements:task.requirements,ruleVersion:task.ruleVersion},after:{requirements,ruleVersion:'repair-minimum-v2'},requestId:input.requestId});
    if(!result) fail(409,'需求或权限已变化，请刷新后核对');
    return {task:{...visibleTask,revision:result.revision,ruleVersion:result.ruleVersion},requirements:result.requirements.filter(item=>writableCampuses.includes(item.campusId)),requiresRuleConfirmation:false};
  }
  async function saveAvailability(actor, taskId, input) {
    if (!validDate(input.businessDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.startAt) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.endAt) || input.endAt <= input.startAt) fail(400, '可用时间范围不正确');
    const context = await contextFor(actor);
    await requirePermission(actor, 'roster.read', { memberId: context.actor.memberId });
    const task = await repository.rosterTaskById(taskId);
    if (!task) fail(404, '排班任务不存在');
    if (task.workflowVersion === 1) fail(409, '请使用整周填报提交，避免覆盖已提交的收集结果');
    if (task.dutyType === 'office'&&task.workflowVersion!==1) fail(400, '旧办公班表无需填报');
    if (task.memberIds?.length && !task.memberIds.includes(context.actor.memberId)) fail(403, '该任务未邀请你填报');
    if (collectionStatus(task)!=='open') fail(409, '该任务已结束收集，请联系负责人重新开放');
    if (weekRange(input.businessDate).start !== task.weekStart) fail(400, '请选择任务所在周的日期');
    if (input.businessDate > addDays(task.weekStart,3)) fail(400,'请选择周一至周四的服务日期');
    const campusIds = task.campusScope?.campusIds || [];
    const allowed = (await repository.memberCampuses(context.actor.memberId)).map(normalizeCampusId);
    if (!campusIds.includes(input.campusId) || !allowed.includes(input.campusId)) fail(403, '该校区不在本次任务或你的授权范围内');
    const fact = await rosterOwnFact(context,task);
    const qualified = fact && !!repairRosterPool(fact,platform.authorizer,input.businessDate,{id:task.id,campusId:input.campusId});
    if (!qualified || !rosterParticipant(context,task,fact) || !rosterMemberReadable(context,platform.authorizer,fact,task,input.businessDate,input.campusId)) fail(403,'该日期的校区、部门或填报资格不在你的授权范围内');
    return repository.saveAvailability(taskId, context.actor.memberId, input, input.revision);
  }
  async function rosterInput(actor, taskId) {
    const task = await repository.rosterTaskById(taskId);
    if (!task) fail(404, '排班任务不存在');
    const campusIds = task.campusScope?.campusIds;
    if (!validDate(task.weekStart) || weekRange(task.weekStart).start !== task.weekStart || !campusIds?.length)
      fail(409, '该任务缺少有效的周起始日期或校区，请重新创建收集任务');
    const office = task.dutyType === 'office';
    const context = await contextFor(actor);
    if (!rosterTaskManaged(context,platform.authorizer,task)) fail(403,'没有管理该任务全部校区与部门的权限');
    const slots = Array.from({ length: 4 }, (_, offset) => campusIds.map(campusId => ({
      businessDate: addDays(task.weekStart, offset), campusId, startAt: task.slotStart, endAt: task.slotEnd, dutyType: office ? 'office' : 'repair', requireLead: !office,
      ...((!office && task.ruleVersion==='repair-minimum-v2'||office&&task.workflowVersion===1) ? {ordinaryMinimum:task.requirements?.find(item=>item.businessDate===addDays(task.weekStart,offset) && item.campusId===campusId)?.ordinaryMinimum ?? 1} : {})
    }))).flat();
    const windows = await repository.availability(taskId);
    const memberIds = [...new Set(task.memberIds?.length ? task.memberIds : office ? await repository.officeRosterMemberIds(task.weekStart, campusIds) : windows.map(item => item.memberId))];
    if (memberIds.length > 300) fail(400, '单个排班任务最多支持 300 名成员');
    const members = [];
    const facts = await repository.rosterMemberFacts(memberIds, task.weekStart);
    for (const fact of facts) {
      if (!fact.active) continue;
      if (!slots.some(slot => rosterMemberInScope(fact,task,slot.businessDate,slot.campusId))) continue;
      const memberId = fact.memberId;
      const campusAccess = fact.campuses.map(normalizeCampusId);
      const other = fact.assignments.filter(item => item.taskId !== taskId);
      const available = [], manualSlots = [], leadSlots = [];
      let ordinaryEligible=false;
      for (const slot of slots) {
        if (!campusAccess.includes(slot.campusId) || !rosterMemberInScope(fact,task,slot.businessDate,slot.campusId)) continue;
        const profiles = fact.profiles.filter(profile => profile.effectiveFrom <= slot.businessDate && (!profile.effectiveTo || slot.businessDate < profile.effectiveTo));
        const departments = rosterDepartments(fact,slot.businessDate,task);
        const pools = office ? [] : (departments.length ? departments : [{departmentId:undefined}]).map(item=>repairRosterPool(fact,platform.authorizer,slot.businessDate,{id:taskId,campusId:slot.campusId,departmentId:item.departmentId}));
        const pool = pools.includes('lead') ? 'lead' : pools.includes('ordinary') ? 'ordinary' : '';
        if (office ? !profiles.some(item => item.profileCode==='office') : !pool) continue;
        if (pool==='lead') leadSlots.push(slot);
        if (pool==='ordinary') ordinaryEligible=true;
        if (other.some(item => (!office && item.dutyType === 'repair') || item.businessDate === slot.businessDate &&
          ((office && item.dutyType === 'office') || item.startAt < slot.endAt && slot.startAt < item.endAt))) continue;
        manualSlots.push(slot);
        if ((!office || task.workflowVersion===1) && !windows.some(item => item.memberId === memberId && item.businessDate === slot.businessDate &&
          (!item.campusId || item.campusId === slot.campusId) && item.startAt <= slot.startAt && item.endAt >= slot.endAt)) continue;
        available.push(slot);
      }
      if (office && !manualSlots.length) continue;
      if (!office && !leadSlots.length && !ordinaryEligible) continue;
      const departmentNames = [...new Set(slots.flatMap(slot => rosterDepartments(fact,slot.businessDate,task).map(item => item.departmentName)).filter(Boolean))];
      const pool = !office && leadSlots.length ? 'lead' : 'ordinary';
      members.push({ memberId, name: fact.name, available:!office && pool==='lead' ? available.filter(slot=>leadSlots.includes(slot)) : available, manualSlots, reportedWindows:windows.filter(item=>item.memberId===memberId),existingAssignments:other, leadSlots, pool,
        identities:staffIdentities(rosterFactContext(fact,task.weekStart),platform.authorizer), departmentNames });
    }
    return { taskId, task, dutyType: task.dutyType || 'repair', taskRevision: task.revision, ruleVersion:task.ruleVersion || 'legacy', weekStart: task.weekStart, members, slots, requireLead: !office,
      preservedAssignments:repository.protectedRosterAssignments ? await repository.protectedRosterAssignments(taskId) : [] };
  }
  async function rosterTaskState(actor, taskId) {
    const initial=await rosterInput(actor,taskId);
    await applyAvailabilityContinuation(initial.task);
    const source = await rosterInput(actor, taskId);
    const versions = await repository.rosterVersionsForTask(taskId);
    const latest = versions.find(item => ['draft','published'].includes(item.status));
    const published = versions.find(item => item.status === 'published');
    const assignments = latest ? await repository.versionAssignments(latest.id) : [];
    const savedEligibility = latest?.inputSnapshotRef?.eligibility;
    const savedAssignments = latest?.inputSnapshotRef?.optimization && latest.inputSnapshotRef.generatedAssignments;
    const sourceChanged = !!savedEligibility && stableJson(savedEligibility) !== stableJson(rosterEligibilitySnapshot(source)) ||
      !!savedAssignments && stableJson(savedAssignments) !== stableJson(rosterAssignmentSnapshot(assignments));
    const submissions=repository.rosterSubmissions ? await repository.rosterSubmissions(taskId) : [];
    const audience=source.task.memberIds || [];
    const facts=audience.length ? await repository.rosterMemberFacts(audience,source.weekStart) : [];
    const progress={total:audience.length,submitted:submissions.filter(item=>audience.includes(item.memberId)).length,
      people:facts.map(item=>({memberId:item.memberId,name:item.name,active:item.active,submission:submissions.find(row=>row.memberId===item.memberId) || null})),
      coverage:source.slots.map(slot=>({...slot,ordinary:source.members.filter(member=>member.pool==='ordinary' && member.available.some(item=>sameAssignment({...item,memberId:''},{...slot,memberId:''}))).length,
        leads:source.members.filter(member=>member.pool==='lead' && member.available.some(item=>item.businessDate===slot.businessDate && item.campusId===slot.campusId)).length}))};
    return { taskId,task:source.task,series:source.task.seriesId&&repository.rosterSeries ? await repository.rosterSeries(source.task.seriesId) : null,collectionState:collectionStatus(source.task),stage:rosterStage(source.task,versions,calendarClock().getTime()),progress,
      protectedAssignments:repository.protectedRosterAssignments ? await repository.protectedRosterAssignments(taskId) : [],publishedVersion:published || null,
      dutyType: source.dutyType, ruleVersion:source.ruleVersion, requiresRuleConfirmation:source.dutyType!=='office' && source.ruleVersion!=='repair-minimum-v2', members: source.members, slots: source.slots,
      draft: latest ? { ...latest, assignments, sourceChanged, validation: validateRoster({ assignments }, source) } : null,
      publishedAssignments: published ? await repository.versionAssignments(published.id) : [] };
  }
  async function rosterWrite(write) {
    try { return await write(); }
    catch(error) {
      if(/CHECK constraint failed|UNIQUE constraint failed: roster_command_receipts/.test(String(error.message))) fail(409,'任务、权限或班表已变化，请重新读取并核对；你的修改可以保留后重试');
      throw error;
    }
  }
  async function generate(actor, input) {
    const task=await repository.rosterTaskById(input.taskId);
    if(task){const context=await contextFor(actor);if(rosterTaskManaged(context,platform.authorizer,task))await applyAvailabilityContinuation(task);}
    const source = await rosterInput(actor, input.taskId);
    if(source.task.workflowVersion===1 && collectionStatus(source.task)!=='closed') fail(409,'请先结束收集，再生成自动排班');
    const context = await contextFor(actor),record=commandRecord(actor,context,input);
    record.command='generate';
    if(repository.rosterCommandReceipt) {
      const replay=await repository.rosterCommandReceipt(record.actorMemberId,record.command,record.requestId);
      if(replay) {if(JSON.parse(replay.payload).taskId!==input.taskId) fail(409,'请求编号已用于其他任务');return {version:await repository.rosterVersionById(replay.resourceId),idempotent:true};}
    }
    if(source.dutyType!=='office' && source.ruleVersion!=='repair-minimum-v2') fail(409,'旧任务需先确认每日最低人员需求，再生成新规则草稿');
    const previous = (await repository.rosterVersionsForTask(source.taskId)).find(item => ['draft','published'].includes(item.status));
    source.locked = previous ? (await repository.versionAssignments(previous.id)).filter(item => item.locked || source.preservedAssignments.some(row=>sameAssignment(row,item))) : [];
    const result = source.dutyType === 'office' ? source.task.workflowVersion===1 ? generateOfficeRoster(source) : { assignments: previous ? await repository.versionAssignments(previous.id) : [], ruleVersion: 'office-daily-v1', algorithmVersion: 'manual-office-v1', solverStatus: 'needs_review', inputSnapshotRef: { dutyType: 'office' } } : generateRoster(source);
    const beforeLeaves = result.assignments.map(item => item.leaveStatus || '');
    result.assignments = await inheritAssignmentLeaves(source.taskId, result.assignments);
    if (result.inputSnapshotRef.optimization && result.assignments.some((item,index) => (item.leaveStatus || '') !== beforeLeaves[index])) {
      result.inputSnapshotRef.optimization = { ...result.inputSnapshotRef.optimization, complete: false, reason: 'attendance_changed', objective: null };
      result.solverStatus = 'feasible';
    }
    const validation = validateRoster(result, source);
    result.solverStatus = validation.valid ? (result.solverStatus === 'optimal' ? 'optimal' : 'feasible') : 'needs_review';
    const version = await rosterWrite(async()=>repository.createRosterVersion({ taskId: source.taskId, assignments: result.assignments.map(item => ({ ...item, id: undefined })),
      commandRecord:record,requireClosed:source.task.workflowVersion===1,inputSnapshotRef: { ...result.inputSnapshotRef,publicationBase:(await repository.rosterVersionsForTask(source.taskId)).find(item=>item.status==='published')?.id || '',manualOverrides:result.assignments.filter(item=>item.manualOverride),eligibility: rosterEligibilitySnapshot(source), generatedAssignments: rosterAssignmentSnapshot(result.assignments), lockedAssignments: source.locked, taskRevision: source.taskRevision, lockedMemberIds: source.locked.map(item => item.memberId) }, ruleVersion: result.ruleVersion,
      algorithmVersion: result.algorithmVersion, solverStatus: result.solverStatus, validation }));
    if(!repository.rosterAudit) await repository.audit({ actorMemberId: context.actor.memberId, actorAccount: actor.account, action: 'rosters.generated', sourceRef: publicResourceRef('rosters','version',version.id), after: { version, validation }, requestId: input.requestId });
    const names = new Map(source.members.map(item => [item.memberId, item.name]));
    return { ...result, assignments: result.assignments.map(item => ({ ...item, memberName: names.get(item.memberId) })), validation, version };
  }
  async function reviseRoster(actor,taskId,input) {
    const source=await rosterInput(actor,taskId),versions=await repository.rosterVersionsForTask(taskId);
    const published=versions.find(item=>item.status==='published');
    if(!published || published.id!==input.publishedVersionId) fail(409,'当前发布班表已变化，请重新打开');
    const context=await contextFor(actor),record={...commandRecord(actor,context,input),command:'revise'};
    const replay=await repository.rosterCommandReceipt(record.actorMemberId,record.command,record.requestId);
    if(replay) {if(JSON.parse(replay.payload).taskId!==taskId) fail(409,'请求编号已用于其他任务');return repository.rosterVersionById(replay.resourceId);}
    if(versions.some(item=>item.status==='draft')) fail(409,'已有未发布修订，请继续编辑现有草稿');
    const assignments=await repository.versionAssignments(published.id);
    return rosterWrite(()=>repository.createRosterVersion({taskId,assignments:assignments.map(item=>({...item,id:undefined})),commandRecord:record,
      ruleVersion:source.ruleVersion,algorithmVersion:'published-copy-v1',validation:validateRoster({assignments},source),
      inputSnapshotRef:{basePublishedVersionId:published.id,publicationBase:published.id,eligibility:rosterEligibilitySnapshot(source),manualOverrides:assignments.filter(item=>item.manualOverride),lockedAssignments:assignments.filter(item=>item.locked),lockedMemberIds:assignments.filter(item=>item.locked).map(item=>item.memberId)}}));
  }
  async function checkProtected(taskId,assignments) {
    if(!repository.protectedRosterAssignments) return;
    const protectedRows=await repository.protectedRosterAssignments(taskId);
    if(protectedRows.some(row=>!assignments.some(item=>sameAssignment(row,item)))) fail(409,'已签到或过去日期的原班次不能变更，请保留原安排，通过现场协调或考勤修正处理');
    if(assignments.some(row=>row.businessDate<dateKey()&&!protectedRows.some(item=>sameAssignment(row,item))))fail(409,'过去日期不能新增或更改排班，请通过考勤修正处理');
  }
  async function updateRoster(actor, id, input) {
    if (!Number.isInteger(input.version) || !Array.isArray(input.assignments) || input.assignments.length > 300 ||
      input.assignments.some(item => !item || typeof item.memberId !== 'string' || !validDate(item.businessDate) ||
        typeof item.campusId !== 'string' || typeof item.startAt !== 'string' || typeof item.endAt !== 'string')) fail(400, '排班草稿字段不完整');
    const version = await repository.rosterVersionById(id);
    if (!version) fail(404, '排班草稿不存在');
    const context=await contextFor(actor),record={...commandRecord(actor,context,input),command:'save'};
    if(repository.rosterCommandReceipt){const replay=await repository.rosterCommandReceipt(record.actorMemberId,'save',record.requestId);if(replay){if(replay.resourceId!==id||JSON.parse(replay.payload).signature!==stableJson(input))fail(409,'请求编号已用于其他调整');await rosterInput(actor,version.taskId);return {...await repository.rosterVersionById(id),idempotent:true};}}
    const fingerprint=repository.rosterFingerprint ? await repository.rosterFingerprint(version.taskId) : undefined;
    const source = await rosterInput(actor, version.taskId);
    const assignments = await inheritAssignmentLeaves(source.taskId, input.assignments);
    await checkProtected(source.taskId,assignments);
    for(const item of assignments) {
      const member=source.members.find(person=>person.memberId===item.memberId);
      item.manualOverride=!!member && !member.available.some(slot=>slot.businessDate===item.businessDate && slot.campusId===item.campusId && slot.startAt<=item.startAt && slot.endAt>=item.endAt);
    }
    const validation = validateRoster({ assignments }, source);
    if(source.dutyType!=='office' && source.ruleVersion!=='repair-minimum-v2') fail(409,'请先确认每日最低人员需求');
    const result = await rosterWrite(()=>repository.updateRosterDraft(id, { assignments, validation,ruleVersion:source.ruleVersion,eligibility:rosterEligibilitySnapshot(source),commandRecord:record,signature:stableJson(input),fingerprint,taskId:source.taskId }, input.version));
    if (!result) fail(409, '排班版本已变化，请刷新');
    if(!repository.rosterAudit) await repository.audit({ actorMemberId: (await contextFor(actor)).actor.memberId, actorAccount: actor.account, action: 'rosters.updated', sourceRef: publicResourceRef('rosters','version',id), after: result, requestId: input.requestId });
    return { ...result, assignments, revision: result.version };
  }
  async function inheritAssignmentLeaves(taskId, assignments) {
    const published = (await repository.rosterVersionsForTask(taskId)).find(item => item.status === 'published');
    const previous = published ? await repository.versionAssignments(published.id) : [];
    const key = item => `${item.memberId}:${item.businessDate}:${item.campusId}:${item.startAt}:${item.endAt}:${item.dutyType || 'repair'}`;
    const statuses = new Map(previous.map(item => [key(item), item.leaveStatus || '']));
    return assignments.map(item => ({ ...item, leaveStatus: statuses.get(key(item)) || '' }));
  }
  async function publish(actor, id, input) {
    if (!Number.isInteger(input.version) || input.version < 1) fail(400, '请选择有效的班表版本');
    const version = await repository.rosterVersionById(id);
    if (!version) fail(404, '排班草稿不存在');
    const fingerprint=repository.rosterFingerprint ? await repository.rosterFingerprint(version.taskId) : undefined;
    const source = await rosterInput(actor, version.taskId);
    if (version.status === 'published' && version.version === input.version) return version;
    if(source.dutyType!=='office' && (source.ruleVersion!=='repair-minimum-v2' || version.ruleVersion!==source.ruleVersion)) fail(409,'请先确认需求，并重新生成或保存校验草稿');
    if(version.inputSnapshotRef?.eligibility?.taskRevision!==undefined && version.inputSnapshotRef.eligibility.taskRevision!==source.taskRevision) fail(409,'最低人员需求已变更，请重新生成或保存校验草稿');
    const assignments = await repository.versionAssignments(id);
    await checkProtected(source.taskId,assignments);
    const validation = validateRoster({ assignments }, source);
    if (!validation.valid) fail(409, '当前人员资格或班次覆盖不满足发布条件，请重新生成或调整草稿');
    const context = await contextFor(actor);
    let result;
    try { result = await repository.publishRoster(id, input.version, { actorMemberId: context.actor.memberId, actorAccount: actor.account, authVersion:context.authVersion, action: 'rosters.published', sourceRef: publicResourceRef('rosters','version',id), before: version, after: { ...version, status: 'published' }, requestId: input.requestId },fingerprint); }
    catch (error) {
      if(String(error.message).includes('ROSTER_ATTENDED_ASSIGNMENT_CHANGED')) fail(409,'人员已签到，原班次不能更改，请重新核对');
      if(String(error.message).includes('ROSTER_PUBLICATION_BASE_CHANGED'))fail(409,'已有新的班表发布，请基于最新班表核对修订');
      if (String(error.message).includes('ROSTER_SCHEDULE_CONFLICT')) fail(409, '人员已在其他班表被安排，请刷新并重新核对');
      if (String(error.message).includes('ROSTER_CAMPUS_LEADER_CONFLICT')) fail(409,'该校区当天已有其他班表发布的负责人，请先协调现有班表');
      if (String(error.message).includes('ROSTER_REPAIR_MINIMUM_MISSING')) fail(409,'负责人或普通人员覆盖已变化，请重新校验');
      throw error;
    }
    if (!result) fail(409, '班表、人员资格、可用时间或需求已变化，请刷新并重新校验');
    return result;
  }
  async function rosterMine(actor, query = {}) { const context = await contextFor(actor); await requirePermission(actor, 'roster.read', { memberId: context.actor.memberId }); return { items: await repository.listAssignments(context.actor.memberId, query.weekStart || weekRange(dateKey()).start), weekStart: query.weekStart || weekRange(dateKey()).start }; }
  async function leave(actor, input) {
    const context = await contextFor(actor);
    await requirePermission(actor, 'roster.read', { memberId: context.actor.memberId });
    if (typeof input.assignmentId !== 'string' || !input.assignmentId || typeof input.reason !== 'string' || input.reason.trim().length < 2 || input.reason.length > 500) fail(400, '请假班次或原因不正确');
    const id = requestId(input.requestId), hash = hashPayload(input);
    const receipt = id ? { memberId: context.actor.memberId, action: 'leave.create', id, hash } : null;
    const replay = async () => {
      const previous = receipt && await repository.receipt(receipt.memberId,receipt.action,receipt.id);
      if (!previous) return null;
      if (previous.payloadHash !== hash) fail(409, '请求编号已用于其他内容', 'REQUEST_CONFLICT');
      if (previous.resultStatus !== 'success') fail(409, '请求正在处理中，请稍后重试', 'REQUEST_CONFLICT');
      return { ...previous.result, idempotent: true };
    };
    const previous = await replay();
    if (previous) return previous;
    const assignment = await repository.assignmentById(input.assignmentId);
    if (!assignment || assignment.memberId !== context.actor.memberId) fail(403, '只能为本人班次申请请假');
    if (assignment.versionStatus && assignment.versionStatus !== 'published') fail(409, '该班次已被新版班表替换，请选择当前班次');
    const result = publicLeave(await repository.createLeave({ assignmentId: assignment.originAssignmentId || assignment.id, activeAssignmentId: assignment.id, reason: input.reason.trim() }, context.actor.memberId,
      { actorMemberId: context.actor.memberId, actorAccount: actor.account, authVersion: context.authVersion, action: 'rosters.leave.created', requestId: id }, receipt));
    if (result) return result;
    const concurrent = await replay();
    if (concurrent) return concurrent;
    fail(409, '该班次已变化，或已有待审批、已批准的请假申请，请刷新后查看');
  }
  async function leaveAccess(context, request, assignment, memberships) {
    const departments = memberships || (assignment && repository.memberships ? await repository.memberships(request.member_id, assignment.businessDate) : []);
    const targets = departments.length ? departments.map(item => item.departmentId) : [undefined];
    return { departments, allowed: !!assignment && targets.some(departmentId => evaluate(context, 'leave.review', {
      campusId: assignment.campusId, memberId: request.member_id, departmentId, id: request.id
    }).allowed) };
  }
  async function currentLeaveAssignment(row) {
    return repository.effectiveLeaveAssignment ? repository.effectiveLeaveAssignment(row.assignment_id, row.member_id) : row.assignment || repository.assignmentById(row.assignment_id);
  }
  function leaveActions(request, assignment, context, canReview) {
    const current = !!assignment && (!assignment.versionStatus || assignment.versionStatus === 'published') && assignment.memberId === request.member_id;
    return { review: canReview && request.status === 'pending', approve: canReview && request.status === 'pending' && current,
      reason: current ? '' : '原班次已被调整，可退回申请并请成员重新选择班次',
      withdraw: request.member_id === context.actor.memberId && request.status === 'pending' };
  }
  async function leaveDetail(actor, id) {
    const context = await contextFor(actor), row = await repository.leaveById(id);
    if (!row) fail(404, '请假申请不存在');
    const assignment = await currentLeaveAssignment(row);
    const access = await leaveAccess(context, row, assignment);
    if (!access.allowed && row.member_id !== context.actor.memberId) fail(403, '没有查看该请假申请的权限');
    if (!access.allowed) await requirePermission(actor, 'roster.read', { memberId: context.actor.memberId });
    const member = await repository.memberRow(row.member_id);
    const identityContext=repository.fieldContexts ? (await repository.fieldContexts([row.member_id],context.businessDate)).get(row.member_id) : null;
    return { ...publicLeave(row), memberName: member?.name || '成员', assignment,
      identities:identityContext ? staffIdentities(identityContext,platform.authorizer) : [],
      departments: access.departments.map(item => item.departmentName), actions: leaveActions(row, assignment, context, access.allowed),
      impact: access.allowed && assignment ? await repository.leaveImpact(assignment) : null };
  }
  async function leaves(actor, query = {}) {
    const context = await contextFor(actor);
    const all = query.all === true || query.all === '1' || query.all === 'true';
    if (!all) await requirePermission(actor, 'roster.read', { memberId: context.actor.memberId });
    if (query.status && !['pending','approved','rejected','withdrawn'].includes(query.status)) fail(400, '请假状态不正确');
    const rows = await repository.listLeaves({ status: query.status, memberId: all ? undefined : context.actor.memberId });
    const identities=repository.fieldContexts ? await repository.fieldContexts([...new Set(rows.map(row=>row.member_id))],context.businessDate) : new Map();
    const assignments = new Map(await Promise.all(rows.map(async row => [row.id, row.assignment?.versionStatus === 'published' ? row.assignment : await currentLeaveAssignment(row)])));
    const memberships = new Map();
    if (repository.membershipsForMembers) for (const day of new Set([...assignments.values()].filter(Boolean).map(item => item.businessDate))) {
      const ids = [...new Set(rows.filter(row => assignments.get(row.id)?.businessDate === day).map(row => row.member_id))];
      memberships.set(day, await repository.membershipsForMembers(ids, day));
    }
    const items = [];
    for (const row of rows) {
      const assignment = assignments.get(row.id);
      const access = await leaveAccess(context, row, assignment, memberships.get(assignment?.businessDate)?.filter(item => item.memberId === row.member_id));
      const canReview = access.allowed;
      if (all && !canReview) continue;
      if (query.campusId && assignment?.campusId !== query.campusId) continue;
      items.push({ ...publicLeave(row), assignment, memberName: row.member_name || '', departments: access.departments.map(item => item.departmentName),
        identities:identities.has(row.member_id) ? staffIdentities(identities.get(row.member_id),platform.authorizer) : [],
        actions: leaveActions(row, assignment, context, canReview) });
    }
    return { items };
  }

  async function leaveDecision(actor, id, input) {
    if (!['approve','reject'].includes(input.decision)) fail(400, '审批动作不正确');
    if (!Number.isInteger(input.revision) || input.revision < 0) fail(400, '请假申请版本不正确');
    const note = inputString(input, 'note', 500);
    const request = await repository.leaveById(id); if (!request) fail(404, '请假申请不存在');
    const assignment = await currentLeaveAssignment(request);
    const context = await contextFor(actor);
    const access = await leaveAccess(context, request, assignment);
    if (!access.allowed) fail(403, '没有审批该校区与部门申请的权限');
    const status = input.decision === 'approve' ? 'approved' : 'rejected';
    if (request.status === status && request.revision === input.revision + 1) return publicLeave(request);
    if (status === 'approved' && !leaveActions(request, assignment, context, true).approve) fail(409, '班次或申请已变化，请刷新后处理');
    const result = await repository.updateLeave(id,status,context.actor.memberId,input.revision,note, {
      actorMemberId: context.actor.memberId, actorAccount: actor.account, authVersion: context.authVersion, action: 'rosters.leave.reviewed', sourceRef: publicResourceRef('rosters','leave',id),
      before: publicLeave(request), after: { ...publicLeave(request), status, reviewNote: note, reviewerMemberId: context.actor.memberId }, requestId: input.requestId
    });
    if (!result) fail(409, '请假申请或班次已变化，请刷新');
    return publicLeave(result);
  }
  async function leaveWithdraw(actor, id, input) {
    if (!Number.isInteger(input.revision) || input.revision < 0) fail(400, '请假申请版本不正确');
    const context = await contextFor(actor); await requirePermission(actor, 'roster.read', { memberId: context.actor.memberId }); const request = await repository.leaveById(id);
    if (!request || request.member_id !== context.actor.memberId) fail(403, '只能撤回本人的请假申请');
    if (request.status === 'withdrawn' && request.revision === input.revision + 1) return publicLeave(request);
    const result = await repository.updateLeave(id,'withdrawn',context.actor.memberId,input.revision,'本人撤回', { actorMemberId: context.actor.memberId, actorAccount: actor.account, authVersion: context.authVersion, action: 'rosters.leave.withdrawn', sourceRef: publicResourceRef('rosters','leave',id), before: publicLeave(request), after: { ...publicLeave(request), status: 'withdrawn' }, requestId: input.requestId });
    if (!result) fail(409, '请假申请已变化，请刷新'); return publicLeave(result);
  }
  async function swapSnapshot(fromId, toId, owners) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const fingerprint = await repository.swapFingerprint(fromId,toId);
      const original = await Promise.all([repository.assignmentById(fromId),repository.assignmentById(toId)]);
      if (original.some(row => !row)) fail(404, '换班班次不存在');
      const current = owners ? await Promise.all(original.map((row,index) => repository.effectiveAssignment(row.id,owners[index]))) : original;
      const [from,to] = current;
      const weekStart = weekRange(from.businessDate).start;
      const [facts,coverage,protectedAssignments] = await Promise.all([repository.rosterMemberFacts([from.memberId,to.memberId],weekStart),repository.swapCoverage(weekStart),repository.protectedRosterAssignments(undefined,weekStart)]);
      if (fingerprint !== await repository.swapFingerprint(fromId,toId)) continue;
      const validation = validateSwap({ from,to,facts,coverage,protectedAssignments,today:dateKey(),authorizer:platform.authorizer });
      if (owners && current.some((row,index) => row.memberId !== owners[index])) validation.errors.push('班次人员已变化，请重新发起换班');
      validation.allowed = !validation.errors.length;
      const named = row => ({ ...row,memberName:facts.find(item => item.memberId === row.memberId)?.name || '成员' });
      return { ...validation,from:named(from),to:named(to),fingerprint };
    }
    fail(409, '班表正在更新，请稍后重新查看换班结果');
  }
  function swapProjection(snapshot) {
    return { allowed:snapshot.allowed,errors:snapshot.errors,fromAssignment:snapshot.from,toAssignment:snapshot.to,
      after:snapshot.after,coverage:snapshot.coverage || [] };
  }
  async function swapCandidates(actor, query = {}) {
    const context = await contextFor(actor);
    await requirePermission(actor, 'roster.read', { memberId: context.actor.memberId });
    const source = await repository.assignmentById(query.assignmentId);
    if (!source || source.memberId !== context.actor.memberId) fail(403, '请先选择本人的班次');
    if (source.versionStatus !== 'published' || source.leaveStatus) fail(409, '该班次已调整或已请假，请刷新班表');
    const protectedAssignments=await repository.protectedRosterAssignments(undefined,weekRange(source.businessDate).start);
    if(assignmentProtected(source,protectedAssignments,dateKey())) fail(409,'已签到或已结束的班次不能换班，请联系负责人处理');
    const candidates=await repository.swapCandidates({ ...source,weekStart:weekRange(source.businessDate).start });
    const facts=new Map((await repository.rosterMemberFacts([...new Set([source.memberId,...candidates.map(item=>item.memberId)])],weekRange(source.businessDate).start)).map(item=>[item.memberId,item]));
    const eligible=(fact,slot)=>slot.dutyType==='office' ? fact?.active && fact.profiles.some(item=>item.profileCode==='office' && item.effectiveFrom<=slot.businessDate && (!item.effectiveTo || slot.businessDate<item.effectiveTo)) : fact && !!repairRosterPool(fact,platform.authorizer,slot.businessDate,{id:slot.taskId,campusId:slot.campusId});
    if(!eligible(facts.get(source.memberId),source)) fail(403,'当前工作资格不支持该班次换班，请联系负责人处理');
    return {items:candidates.filter(item=>!assignmentProtected(item,protectedAssignments,dateKey()) && eligible(facts.get(item.memberId),source) && eligible(facts.get(source.memberId),item)).map(item=>({...item,
      identities:staffIdentities(rosterFactContext(facts.get(item.memberId),item.businessDate),platform.authorizer)}))};
  }
  async function swapPreview(actor, input) {
    const context = await contextFor(actor);
    await requirePermission(actor, 'roster.read', { memberId: context.actor.memberId });
    const source = await repository.assignmentById(input.fromAssignmentId);
    if (!source || source.memberId !== context.actor.memberId) fail(403, '只能从本人班次发起换班');
    const target = await repository.assignmentById(input.toAssignmentId);
    if (!target) fail(404, '目标班次不存在');
    if (!(context.actor.authorizedCampuses || []).some(value => normalizeCampusId(value) === target.campusId)) fail(403, '没有目标校区的班次访问权限');
    const snapshot = await swapSnapshot(input.fromAssignmentId,input.toAssignmentId);
    return swapProjection(snapshot);
  }
  async function swapReceipt(context, action, input) {
    if (input.requestId !== undefined && !requestId(input.requestId)) fail(400, '请求编号不正确');
    const receipt = { memberId:context.actor.memberId,action,id:requestId(input.requestId) || crypto.randomUUID(),hash:await tokenDigest(stableJson(input)) };
    const replay = async () => {
      const previous = await repository.receipt(receipt.memberId,receipt.action,receipt.id);
      if (!previous) return null;
      if (previous.payloadHash !== receipt.hash) fail(409, '请求编号已用于其他内容', 'REQUEST_CONFLICT');
      if (previous.resultStatus !== 'success') fail(409, '请求正在处理中，请稍后重试', 'REQUEST_CONFLICT');
      return { ...publicSwap(previous.result),idempotent:true };
    };
    return { receipt,replay,previous:await replay() };
  }
  async function swap(actor, input) {
    const context = await contextFor(actor);
    await requirePermission(actor, 'roster.read', { memberId: context.actor.memberId });
    if (!input.fromAssignmentId || !input.toAssignmentId || !input.toMemberId || !Number.isInteger(input.fromRevision) || !Number.isInteger(input.toRevision)) fail(400, '换班班次或版本不正确');
    const note = inputString(input,'note',500);
    const command = await swapReceipt(context,'swap.create',input);
    if (command.previous) return command.previous;
    const snapshot = await swapSnapshot(input.fromAssignmentId,input.toAssignmentId);
    const { from,to } = snapshot;
    if (from.memberId !== context.actor.memberId || to.memberId === context.actor.memberId || input.toMemberId !== to.memberId) fail(400, '换班班次或目标成员不正确');
    if (from.revision !== input.fromRevision || to.revision !== input.toRevision) fail(409, '班次已变化，请重新选择');
    if (weekRange(from.businessDate).start !== weekRange(to.businessDate).start || from.dutyType !== to.dutyType) fail(400, '只能交换同一周、相同岗位类型的班次');
    if (!snapshot.allowed) fail(409,snapshot.errors.join('；'));
    const result = await repository.createSwap({ ...input,note },
      { actorMemberId:context.actor.memberId,actorAccount:actor.account,authVersion:context.authVersion,action:'rosters.swap.created',requestId:command.receipt.id },command.receipt,snapshot);
    if (result) return publicSwap(result);
    const concurrent = await command.replay();
    if (concurrent) return concurrent;
    fail(409, '班次或人员资格已变化，或已有双方待确认的换班邀请，请刷新后查看');
  }
  async function canManageSwap(context, from, to) {
    if (!from || !to) return false;
    const allowed = await Promise.all([from,to].map(async assignment => {
      const departments = await repository.memberships(assignment.memberId,assignment.businessDate);
      return (departments.length ? departments.map(item => item.departmentId) : [undefined]).some(departmentId =>
        evaluate(context,assignment.dutyType === 'office' ? 'roster.office.manage' : 'roster.repair.manage',
          { campusId:assignment.campusId,departmentId,memberId:assignment.memberId,id:assignment.id }).allowed);
    }));
    return allowed.every(Boolean);
  }
  async function swaps(actor, query = {}) {
    const context = await contextFor(actor);
    const all = query.all === true || query.all === '1' || query.all === 'true';
    if (!all) await requirePermission(actor, 'roster.read', { memberId: context.actor.memberId });
    if (query.status && !['pending','accepted','declined','cancelled'].includes(query.status)) fail(400, '换班状态不正确');
    const rows = await repository.listSwaps({ status:query.status,memberId:all ? undefined : context.actor.memberId });
    const items = [], names = new Map();
    async function named(row, memberId = row?.memberId) {
      if (!row) return null;
      if (!names.has(memberId)) names.set(memberId,(await repository.memberRow(memberId))?.name || '成员');
      return { ...row,memberId,memberName:names.get(memberId) };
    }
    for (const row of rows) {
      const from = await repository.assignmentById(row.from_assignment_id), to = await repository.assignmentById(row.to_assignment_id);
      if (all && !await canManageSwap(context,from,to)) continue;
      if (query.campusId && from?.campusId !== query.campusId && to?.campusId !== query.campusId) continue;
      items.push({ ...publicSwap(row),fromAssignment:await named(from,row.from_member_id),toAssignment:await named(to,row.to_member_id),
        actions:{ respond:row.to_member_id === context.actor.memberId && row.status === 'pending' } });
    }
    return { items };
  }
  async function swapDetail(actor, id) {
    const context = await contextFor(actor), row = await repository.swapById(id);
    if (!row) fail(404, '换班申请不存在');
    const participant = [row.from_member_id,row.to_member_id].includes(context.actor.memberId);
    if (participant) await requirePermission(actor, 'roster.read', { memberId:context.actor.memberId });
    else if (!await canManageSwap(context,await repository.assignmentById(row.from_assignment_id),await repository.assignmentById(row.to_assignment_id))) fail(403, '没有查看此换班申请的权限');
    if (row.status !== 'pending') {
      const [from,to] = await Promise.all([repository.assignmentById(row.from_assignment_id),repository.assignmentById(row.to_assignment_id)]);
      const [sender,invitee] = await Promise.all([repository.memberRow(row.from_member_id),repository.memberRow(row.to_member_id)]);
      return { ...publicSwap(row),allowed:false,errors:[],after:[],coverage:[],actions:{ respond:false },
        fromAssignment:{ ...from,memberId:row.from_member_id,memberName:sender?.name || '成员' },toAssignment:{ ...to,memberId:row.to_member_id,memberName:invitee?.name || '成员' },
        applied:row.applied_from_assignment_id ? await Promise.all([repository.assignmentById(row.applied_from_assignment_id),repository.assignmentById(row.applied_to_assignment_id)]) : [] };
    }
    const snapshot = await swapSnapshot(row.from_assignment_id,row.to_assignment_id,[row.from_member_id,row.to_member_id]);
    if (snapshot.from.revision !== row.from_revision || snapshot.to.revision !== row.to_revision) { snapshot.allowed = false; snapshot.errors.push('原班次已更新，请从最新班次重新发起'); }
    return { ...publicSwap(row),...swapProjection(snapshot),actions:{ respond:row.to_member_id === context.actor.memberId && row.status === 'pending' },
      applied:row.applied_from_assignment_id ? await Promise.all([repository.assignmentById(row.applied_from_assignment_id),repository.assignmentById(row.applied_to_assignment_id)]) : [] };
  }
  async function swapDecision(actor, id, input) {
    if (!['accept','decline'].includes(input.decision) || !Number.isInteger(input.revision) || input.revision < 0) fail(400, '换班确认动作或版本不正确');
    const context = await contextFor(actor), row = await repository.swapById(id);
    if (!row) fail(404, '换班申请不存在');
    if (row.to_member_id !== context.actor.memberId) fail(403, '只有被邀请的成员可以确认或拒绝换班');
    await requirePermission(actor, 'roster.read', { memberId:context.actor.memberId });
    const command = await swapReceipt(context,'swap.decide', { ...input,swapId:id });
    if (command.previous) return command.previous;
    if (row.status !== 'pending' || row.revision !== input.revision) fail(409, '换班申请已变化，请刷新');
    let snapshot;
    if (input.decision === 'accept') {
      snapshot = await swapSnapshot(row.from_assignment_id,row.to_assignment_id,[row.from_member_id,row.to_member_id]);
      if (snapshot.from.revision !== row.from_revision || snapshot.to.revision !== row.to_revision) fail(409, '班次已变化，请从最新班次重新发起');
      if (!snapshot.allowed) fail(409,snapshot.errors.join('；'));
    }
    let result;
    try {
      result = await repository.updateSwap(row,input.decision === 'accept' ? 'accepted' : 'declined',input.revision,
        { actorMemberId:context.actor.memberId,actorAccount:actor.account,authVersion:context.authVersion,action:'rosters.swap.decided',before:publicSwap(row),requestId:command.receipt.id },command.receipt,snapshot);
    } catch (error) {
      if (/ROSTER_ATTENDED_ASSIGNMENT_CHANGED/.test(String(error.message))) fail(409,'人员已签到或班次已结束，不能换班，请重新核对');
      if (/SWAP_REVISION_CONFLICT|ROSTER_SCHEDULE_CONFLICT|ROSTER_PUBLICATION_BASE_CHANGED/.test(String(error.message))) fail(409, '班次已变化或出现时间冲突，请刷新后重新发起');
      throw error;
    }
    if (result) return publicSwap(result);
    const concurrent = await command.replay();
    if (concurrent) return concurrent;
    fail(409, '换班申请、班次或人员资格已变化，请刷新');
  }
  async function audit(actor, query) {
    const context=await contextFor(actor);
    // Historical records do not yet carry a consistent campus/department scope.
    // Never turn one scoped grant into access to the complete audit journal.
    const globalGrants=context.grants.filter(grant=>!Object.keys(grant.scope || {}).some(key=>key!=='all'));
    if(!platform.authorizer.evaluate(context.actor,'audit.read',{},context,globalGrants).allowed) fail(403,'当前授权不能查看全局审计记录');
    return {items:await repository.listAudit(query || {})};
  }

  return { contextFor, requirePermission, scopedActor, evaluate, memberList, memberDetail, updateMember, addMembership, endMembership, permissions, roles, createRole, updateRole, previewRole, bindMemberRoles,
    organization, importMembers, saveWorkProfile, deskSummary, workbench, createAttendanceEvent, issueAttendanceToken, checkIn, previewAttendance, attendanceList, attendanceOptions, correctAttendance, presence, rosterOptions, rosterTasks, rosterCandidates,collectionCommand,addParticipants,submitAvailability,reviseRoster,taskAvailability, createRosterTask, rosterRequirements, saveAvailability, rosterTaskState, generate, updateRoster, publish, rosterMine,seriesCommand,availabilityPreferences,
    leave, leaves, leaveDetail, leaveDecision, leaveWithdraw, swapCandidates, swapPreview, swapDetail, swap, swaps, swapDecision, attendanceExport, audit,
    recordAudit: input => repository.audit(input) };
}
