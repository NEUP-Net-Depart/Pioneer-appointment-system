import { fail } from '../../lib/http.js';
import { dateKey } from '../../platform/time.js';
import { stableJson } from '../../platform/contracts.js';
import { validScope } from '../../modules/authorization/scopes.js';
import { validGrantValidity } from '../../modules/authorization/public.js';

function assertDutyAttendanceDate(event, status = 400) {
  if (
    event.type === 'duty' &&
    [event.startsAt, event.endsAt].some((value) => dateKey(new Date(value)) !== event.businessDate)
  )
    fail(status, '值班签到窗口必须与业务日期一致');
}

function randomToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `att_${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function hashPayload(value) {
  let hash = 2166136261;
  const text = stableJson(value);
  for (let index = 0; index < text.length; index += 1)
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

async function tokenDigest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (item) => item.toString(16).padStart(2, '0')).join('');
}

function inputString(input, key, max, required = false) {
  const value = input?.[key];
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || (value.trim().length === 0 && required) || value.length > max)
    fail(400, `${key} 格式不正确`);
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
  if (grant.conditions !== undefined && !Array.isArray(grant.conditions))
    fail(400, '权限条件必须是数组');
  if (
    grant.scope !== undefined &&
    (!grant.scope || typeof grant.scope !== 'object' || Array.isArray(grant.scope))
  )
    fail(400, '权限范围不正确');
  const scope = grant.scope || {};
  validateScope(scope);
  if (scope.all === true && actor.role !== 'superadmin') fail(403, '普通管理员不能授予全局权限');
  const allowed = new Set(definition.scopeKinds || []);
  if ((scope.campusIds !== undefined || scope.campuses !== undefined) && !allowed.has('campus'))
    fail(400, '该权限不支持校区范围');
  if (
    (scope.departmentIds !== undefined || scope.departments !== undefined) &&
    !allowed.has('department')
  )
    fail(400, '该权限不支持部门范围');
  if (scope.self !== undefined && !allowed.has('self')) fail(400, '该权限不支持本人范围');
  const conditions = grant.conditions || [];
  if (conditions.some((condition) => !authorizer.validCondition(condition)))
    fail(400, '权限条件、版本或参数不正确');
  for (const required of definition.conditionKinds || [])
    if (!conditions.some((item) => item?.code === required))
      fail(400, `权限缺少必要条件：${required}`);
  validateGrantValidity(grant.validity);
}

function csvRows(value) {
  const rows = [],
    current = [];
  let cell = '',
    quoted = false,
    closed = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quoted) {
      if (char === '"') {
        if (value[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += char;
    } else if (char === '"') {
      if (cell || closed) fail(400, 'CSV 引号格式不正确');
      quoted = true;
    } else if (char === ',') {
      current.push(cell);
      cell = '';
      closed = false;
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && value[index + 1] === '\n') index += 1;
      current.push(cell);
      cell = '';
      closed = false;
      if (current.some((item) => item.trim())) rows.push(current.splice(0));
    } else {
      if (closed) fail(400, 'CSV 引号后的内容不正确');
      cell += char;
    }
  }
  if (quoted) fail(400, 'CSV 引号未闭合');
  current.push(cell);
  if (current.some((item) => item.trim())) rows.push(current);
  return rows;
}

export {
  assertDutyAttendanceDate,
  randomToken,
  hashPayload,
  tokenDigest,
  inputString,
  validateGrantValidity,
  validateScope,
  validateGrant,
  csvRows
};
