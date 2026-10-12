import { fail } from './http.js';
import { normalizeTimeSlot, statusLabels, outcomeLabels, CAMPUSES, roleLevel } from '../../shared/constants.js';
import { validDate } from '../../shared/time.js';
import { validSignature } from '../../shared/signature.js';

export const account = value => String(value ?? '').trim().toLowerCase();
export function stringField(value, name, max, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(400, `${name} 格式不正确或超过 ${max} 字符`);
  return value.trim();
}
export function bookingInput(input) {
  const limits = { studentId: 20, name: 80, college: 120, campus: 20, phone: 30, social: 120, deviceType: 80, brand: 80, deviceModel: 120, serial: 120, warranty: 20, faultType: 80, issue: 10000, liquidDrop: 20, date: 10, timeSlot: 40, note: 500, agreementAt: 40, agreementVersion: 20 };
  const required = new Set(['studentId','name','campus','social','deviceType','brand','deviceModel','warranty','date','timeSlot','faultType','agreementAt']);
  const data = Object.fromEntries(Object.entries(limits).map(([key, max]) => [key, stringField(input[key], key, max, required.has(key))]));
  if (!/^\d{6,20}$/.test(data.studentId) || data.name.length < 2 || (data.phone && !/^[0-9+()\-\s]{6,30}$/.test(data.phone))) fail(400, '学号、姓名或联系方式格式不正确');
  if (!['南湖','浑南'].includes(data.campus)) fail(400, '校区不正确');
  if (!validDate(data.date)) fail(400, '预约日期不正确');
  data.timeSlot = normalizeTimeSlot(data.timeSlot);
  if (!data.timeSlot) fail(400, '预约时段不正确');
  if (!Number.isFinite(Date.parse(data.agreementAt))) fail(400, '协议记录不正确');
  if (!validSignature(input.signature)) fail(400, '请阅读协议并完成本人手写签名');
  data.signature = JSON.stringify(input.signature);
  return data;
}
export function appointmentPatch(input) {
  const patch = {};
  if (input.action !== undefined && input.action !== 'correct') fail(400, '操作不正确');
  if (input.startedAt !== undefined || input.completedAt !== undefined) fail(400, '维修时间由系统记录');
  if (input.repairNumber !== undefined) fail(400, '维修单号由系统生成');
  for (const key of ['frontPhotoId', 'backPhotoId']) {
    if (input[key] !== undefined) patch[key] = stringField(input[key], key, 80, true);
  }
  if (input.outcome !== undefined) {
    if (!Object.hasOwn(outcomeLabels, input.outcome) || input.outcome === 'legacy_unknown') fail(400, '结束结果不正确');
    patch.outcome = input.outcome;
  }
  if (input.status !== undefined) {
    if (!Object.hasOwn(statusLabels, input.status)) fail(400, '状态不正确');
    patch.status = input.status;
  }
  for (const [key, max] of [['assignedTo', 80], ['repairNote', 3000]]) {
    if (input[key] !== undefined) patch[key] = stringField(input[key], key, max);
  }
  if (input.revision!==undefined && (!Number.isInteger(input.revision) || input.revision<0)) fail(400,'预约版本不正确');
  return {patch,revision:input.revision,action:input.action};
}
export function appointmentQuery(input) {
  const query = { q: stringField(input.q, '搜索内容', 120), campus: input.campus || '', date: input.date || '', status: input.status || 'all', timeSlot: input.timeSlot || '', sort: input.sort || 'createdAt', direction: input.direction || 'desc' };
  if (query.campus === 'all') query.campus = '';
  if (query.campus && !['南湖','浑南'].includes(query.campus)) fail(400, '校区不正确');
  if (query.date && !validDate(query.date)) fail(400, '日期不正确');
  if (query.status !== 'all' && !Object.hasOwn(statusLabels, query.status)) fail(400, '状态不正确');
  if (query.timeSlot) { query.timeSlot = normalizeTimeSlot(query.timeSlot); if (!query.timeSlot) fail(400, '时段不正确'); }
  if (!['createdAt','date','status','campus'].includes(query.sort) || !['asc','desc'].includes(query.direction)) fail(400, '排序方式不正确');
  if (input.sorts !== undefined) {
    const value = stringField(input.sorts, '组合排序', 120);
    query.sorts = value ? value.split(',').map(part => {
      const [key,direction,...extra] = part.split(':');
      if (!['createdAt','date','status','campus'].includes(key) || !['asc','desc'].includes(direction) || extra.length) fail(400, '组合排序方式不正确');
      return { key,direction };
    }) : [];
    if (query.sorts.length > 4 || new Set(query.sorts.map(item => item.key)).size !== query.sorts.length) fail(400, '组合排序字段不能重复');
  }
  return query;
}
export function liveQuery(input) {
  const query = { date:input.date || '',campus:input.campus || '',timeSlot:input.timeSlot || '',appointmentId:input.appointmentId || '' };
  if (input.studentId!==undefined) fail(400,'学号不能用作查询凭证');
  if (query.appointmentId) query.appointmentId=stringField(query.appointmentId,'预约编号',40,true);
  if (query.date && !validDate(query.date)) fail(400, '日期不正确');
  if (query.campus && !['南湖','浑南'].includes(query.campus)) fail(400, '校区不正确');
  if (query.timeSlot) { query.timeSlot = normalizeTimeSlot(query.timeSlot); if (!query.timeSlot) fail(400, '时段不正确'); }
  return query;
}
export function statsQuery(input) {
  const range = input.range || 'all', day = input.day || '';
  if (!['7','30','all'].includes(range) || (day && !validDate(day))) fail(400, '统计范围或日期不正确');
  return { range, day };
}
export function slotCapacityInput(input) {
  if (!CAMPUSES.includes(input.campus)) fail(400, '校区不正确');
  const timeSlot = normalizeTimeSlot(stringField(input.timeSlot, '时段', 40, true));
  if (!timeSlot) fail(400, '时段不正确');
  if (!Number.isSafeInteger(input.capacity) || input.capacity < 0) fail(400, '预约人数必须为非负安全整数');
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) fail(400, '配置版本不正确');
  return { campus: input.campus, timeSlot, capacity: input.capacity, revision: input.revision };
}
export function passwordInput(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) fail(400, '密码长度应为 8 至 128 位');
  return value;
}
export function campusGrants(value) {
  if (!Array.isArray(value) || !value.length || value.length>2 || value.some(campus => !CAMPUSES.includes(campus)) || new Set(value).size!==value.length) fail(400,'请选择有效的授权校区');
  return [...value].sort();
}
export function userPatch(input) {
  const patch = {};
  if (input.password !== undefined) patch.password = passwordInput(input.password);
  if (input.status !== undefined) { if (!['enabled','disabled'].includes(input.status)) fail(400, '账号状态不正确'); patch.status = input.status; }
  if (input.name !== undefined) { patch.name = stringField(input.name, '姓名', 80, true); if (patch.name.length < 2) fail(400, '姓名格式不正确'); }
  if (input.homeCampus !== undefined) { if (!CAMPUSES.includes(input.homeCampus)) fail(400, '校区不正确'); patch.homeCampus = input.homeCampus; }
  if (input.authorizedCampuses !== undefined) patch.authorizedCampuses = campusGrants(input.authorizedCampuses);
  if (input.role !== undefined) { if (!Object.hasOwn(roleLevel,input.role)) fail(400,'角色不正确'); patch.role = input.role; }
  return patch;
}
