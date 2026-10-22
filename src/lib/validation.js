import { appointmentOrder, readAppointmentCursor } from '../../shared/appointment-pagination.js';
import { fail } from './http.js';
import {
  normalizeTimeSlot,
  statusLabels,
  repairOutcomes,
  CAMPUSES,
  roleLevel,
  TIME_SLOTS
} from '../../shared/constants.js';
import { validDate } from '../../shared/time.js';
import { validSignature } from '../../shared/signature.js';
import { studentFieldErrors, AGREEMENT_VERSION } from '../../shared/student-booking.js';

export const account = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase();
export function stringField(value, name, max, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    fail(400, `${name} 格式不正确或超过 ${max} 字符`);
  return value.trim();
}
export function onsiteBookingInput(input) {
  const limits = {
    studentId: 20,
    name: 80,
    college: 120,
    campus: 20,
    phone: 30,
    social: 120,
    deviceType: 80,
    brand: 80,
    deviceModel: 120,
    serial: 120,
    warranty: 20,
    faultType: 80,
    issue: 10000,
    liquidDrop: 20,
    date: 10,
    timeSlot: 40,
    note: 500,
    agreementAt: 40,
    agreementVersion: 20
  };
  const required = new Set([
    'studentId',
    'name',
    'campus',
    'social',
    'deviceType',
    'brand',
    'deviceModel',
    'warranty',
    'date',
    'timeSlot',
    'faultType',
    'agreementAt'
  ]);
  const data = Object.fromEntries(
    Object.entries(limits).map(([key, max]) => [
      key,
      stringField(input[key], key, max, required.has(key))
    ])
  );
  if (
    !/^\d{6,20}$/.test(data.studentId) ||
    data.name.length < 2 ||
    (data.phone && !/^[0-9+()\-\s]{6,30}$/.test(data.phone))
  )
    fail(400, '学号、姓名或联系方式格式不正确');
  if (!['南湖', '浑南'].includes(data.campus)) fail(400, '校区不正确');
  if (!validDate(data.date)) fail(400, '预约日期不正确');
  data.timeSlot = normalizeTimeSlot(data.timeSlot);
  if (!data.timeSlot) fail(400, '预约时段不正确');
  if (!Number.isFinite(Date.parse(data.agreementAt))) fail(400, '协议记录不正确');
  if (!validSignature(input.signature)) fail(400, '请阅读协议并完成本人手写签名');
  data.signature = JSON.stringify(input.signature);
  return data;
}
export function bookingInput(input) {
  const errors = studentFieldErrors(input);
  if (!CAMPUSES.includes(input.campus)) errors.campus = '请选择校区';
  if (!validDate(input.date)) errors.date = '请选择有效的预约日期';
  const timeSlot = normalizeTimeSlot(input.timeSlot);
  if (!timeSlot) errors.timeSlot = '请选择到场时段';
  if (
    input.agreementAccepted !== true ||
    input.agreementVersion !== AGREEMENT_VERSION ||
    !Number.isFinite(Date.parse(input.agreementAt))
  )
    errors.agreement = '请阅读并同意维修协议';
  if (!validSignature(input.signature)) errors.signature = '请完成合格的本人手写签名';
  if (Object.keys(errors).length) fail(400, '请检查预约信息', 'FIELD_INVALID', errors);
  const keys = [
    'studentId',
    'name',
    'college',
    'campus',
    'deviceType',
    'brand',
    'deviceModel',
    'warranty',
    'faultType',
    'issue',
    'date',
    'email',
    'contactType',
    'contactValue',
    'agreementAt',
    'agreementVersion'
  ];
  const data = Object.fromEntries(keys.map((key) => [key, (input[key] || '').trim()]));
  data.timeSlot = timeSlot;
  data.liquidMetal = data.deviceType === '笔记本' ? input.liquidMetal : null;
  data.dellG15 =
    data.deviceType === '笔记本' && data.brand === 'Dell' ? input.dellG15 || null : null;
  data.signature = JSON.stringify(input.signature);
  data.phone = '';
  data.social = `${data.contactType === 'qq' ? 'QQ' : '微信'}：${data.contactValue}`;
  data.serial = '';
  data.liquidDrop = '';
  data.note = '';
  if (input.acceptedNotices !== undefined) {
    if (!Array.isArray(input.acceptedNotices) || input.acceptedNotices.length > 100 || input.acceptedNotices.some(item => !item || typeof item.id !== 'string' || item.id.length > 80 || !Number.isSafeInteger(item.revision) || item.revision < 0)) fail(400, '公告确认记录不正确');
    data.acceptedNotices = input.acceptedNotices.map(({ id, revision }) => ({ id, revision }));
  }
  return data;
}
export function bookingRequestKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value))
    fail(400, '缺少有效的预约请求标识', 'REQUEST_KEY_INVALID');
  return value;
}
export function serviceLocationInput(input) {
  if (!CAMPUSES.includes(input.campus)) fail(400, '校区不正确');
  if (!validDate(input.date)) fail(400, '服务日期不正确');
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) fail(400, '地点版本不正确');
  return {
    campus: input.campus,
    date: input.date,
    revision: input.revision,
    location: stringField(input.location, '维修地点', 200)
  };
}
export function onsiteInput(input) {
  const value = input || {};
  const registrationFlow = value.registrationFlow || 'technician_intake';
  if (!['technician_intake', 'frontdesk'].includes(registrationFlow)) fail(400, '登记入口不正确');
  const data = {
    studentId: stringField(value.studentId, 'studentId', 20, true),
    name: stringField(value.name, 'name', 80, true),
    college: stringField(value.college, 'college', 120),
    campus: stringField(value.campus, 'campus', 20, true),
    phone: stringField(value.phone, 'phone', 30),
    social: stringField(value.social, 'social', 120),
    deviceType: stringField(value.deviceType, 'deviceType', 80, true),
    brand: stringField(value.brand, 'brand', 80, true),
    deviceModel: stringField(value.deviceModel, 'deviceModel', 120, true),
    serial: stringField(value.serial, 'serial', 120),
    warranty: stringField(value.warranty, 'warranty', 20),
    faultType: stringField(value.faultType, 'faultType', 80, true),
    issue: stringField(value.issue, 'issue', 10000),
    liquidDrop: stringField(value.liquidDrop, 'liquidDrop', 20),
    date: stringField(value.date, 'date', 10, true),
    timeSlot: normalizeTimeSlot(stringField(value.timeSlot, 'timeSlot', 40, true)),
    note: stringField(value.note, 'note', 500),
    registrationKey: stringField(
      value.registrationKey || value.requestId,
      'registrationKey',
      128,
      true
    ),
    registrationFlow
  };
  if (!/^\d{6,20}$/.test(data.studentId) || data.name.length < 2) fail(400, '学号或姓名格式不正确');
  if (!CAMPUSES.includes(data.campus)) fail(400, '校区不正确');
  if (!validDate(data.date) || !data.timeSlot) fail(400, '预约日期或时段不正确');
  return data;
}
export function appointmentPatch(input) {
  const patch = {};
  if (input.assignedToName !== undefined) fail(400, '维修人员姓名由账号信息提供，不能修改');
  if (input.action !== undefined && input.action !== 'correct') fail(400, '操作不正确');
  if (input.startedAt !== undefined || input.completedAt !== undefined)
    fail(400, '维修时间由系统记录');
  if (input.id !== undefined || input.repairNumber !== undefined)
    fail(400, '预约编号和历史维修编号不能修改');
  for (const key of ['frontPhotoId', 'backPhotoId']) {
    if (input[key] !== undefined) patch[key] = stringField(input[key], key, 80, true);
  }
  if (input.outcome !== undefined) {
    if (!repairOutcomes.includes(input.outcome)) fail(400, '维修结果不正确');
    patch.outcome = input.outcome;
  }
  if (input.status !== undefined) {
    if (!Object.hasOwn(statusLabels, input.status)) fail(400, '状态不正确');
    patch.status = input.status;
  }
  if (input.status && input.status !== 'completed' && input.outcome !== undefined)
    fail(400, '仅已完成工单可以填写维修结果');
  if (input.expiresAt !== undefined) {
    if (input.action !== 'correct' || input.status !== 'booked')
      fail(400, '有效截止时间只能在管理员恢复为已预约时设置');
    const value = stringField(input.expiresAt, '有效截止时间', 40, true);
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      !validDate(value.slice(0, 10)) ||
      !Number.isFinite(Date.parse(value))
    )
      fail(400, '有效截止时间格式不正确');
    patch.expiresAt = new Date(value).toISOString();
  }
  const correctionReason =
    input.correctionReason === undefined
      ? ''
      : stringField(input.correctionReason, '纠错原因', 300, true);
  if (
    input.correctionReason !== undefined &&
    (input.action !== 'correct' || correctionReason.length < 8)
  )
    fail(400, '管理员纠错原因至少填写 8 字');
  for (const [key, max] of [
    ['assignedTo', 80],
    ['repairNote', 3000]
  ]) {
    if (input[key] !== undefined) patch[key] = stringField(input[key], key, max);
  }
  if (input.revision !== undefined && (!Number.isInteger(input.revision) || input.revision < 0))
    fail(400, '预约版本不正确');
  let verification;
  if (input.verification !== undefined) {
    const value = input.verification;
    if (!value || typeof value !== 'object') fail(400, '现场核验信息不正确');
    verification = {
      brand: stringField(value.brand, '设备厂商', 80, true),
      model: stringField(value.model, '设备型号', 120, true),
      warranty: value.warranty,
      liquidMetal: value.liquidMetal,
      note: stringField(value.note, '核验说明', 500)
    };
    if (
      !['in_warranty', 'expired', 'unknown'].includes(value.warranty) ||
      !['yes', 'no', 'unknown'].includes(value.liquidMetal)
    )
      fail(400, '请选择保修与液金情况');
  }
  return {
    patch,
    revision: input.revision,
    action: input.action,
    correctionReason,
    requestId: input.requestId || '',
    reason: input.reason || correctionReason,
    verification
  };
}
export function appointmentQuery(input) {
  const query = {
    q: stringField(input.q, '搜索内容', 120),
    campus: input.campus || '',
    date: input.date || '',
    status: input.status || 'all',
    timeSlot: input.timeSlot || '',
    sort: input.sort || 'createdAt',
    direction: input.direction || 'desc'
  };
  if (input.limit !== undefined) {
    if (!/^\d+$/.test(String(input.limit))) fail(400, '预约分页大小不正确');
    query.limit = Number(input.limit);
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 200)
      fail(400, '预约分页大小不正确');
  }
  if (query.campus === 'all') query.campus = '';
  if (query.campus && !['南湖', '浑南'].includes(query.campus)) fail(400, '校区不正确');
  if (query.date && !validDate(query.date)) fail(400, '日期不正确');
  for (const key of ['dateFrom', 'dateTo']) {
    if (input[key]) {
      if (!validDate(input[key])) fail(400, '日期范围不正确');
      query[key] = input[key];
    }
  }
  if (
    !!query.dateFrom !== !!query.dateTo ||
    (query.dateFrom && (query.dateFrom > query.dateTo || query.date))
  )
    fail(400, '日期范围不正确');
  if (!['all', 'pending'].includes(query.status) && !Object.hasOwn(statusLabels, query.status))
    fail(400, '状态不正确');
  if (query.timeSlot) {
    query.timeSlot = normalizeTimeSlot(query.timeSlot);
    if (!query.timeSlot) fail(400, '时段不正确');
  }
  if (
    !['createdAt', 'date', 'status', 'campus'].includes(query.sort) ||
    !['asc', 'desc'].includes(query.direction)
  )
    fail(400, '排序方式不正确');
  if (input.sorts !== undefined) {
    const value = stringField(input.sorts, '组合排序', 120);
    query.sorts = value
      ? value.split(',').map((part) => {
          const [key, direction, ...extra] = part.split(':');
          if (
            !['createdAt', 'date', 'status', 'campus'].includes(key) ||
            !['asc', 'desc'].includes(direction) ||
            extra.length
          )
            fail(400, '组合排序方式不正确');
          return { key, direction };
        })
      : [];
    if (
      query.sorts.length > 4 ||
      new Set(query.sorts.map((item) => item.key)).size !== query.sorts.length
    )
      fail(400, '组合排序字段不能重复');
  }
  query.limit ??= 200;
  if (input.cursor) {
    query.cursor = stringField(input.cursor, '预约分页游标', 2500);
    try {
      readAppointmentCursor(query.cursor, appointmentOrder(query));
    } catch {
      fail(400, '预约分页游标不正确');
    }
  }
  return query;
}
export function liveQuery(input) {
  const query = {
    date: input.date || '',
    campus: input.campus || '',
    timeSlot: input.timeSlot || '',
    appointmentId: input.appointmentId || ''
  };
  if (input.studentId !== undefined) fail(400, '学号不能用作查询凭证');
  if (query.appointmentId)
    query.appointmentId = stringField(query.appointmentId, '预约编号', 40, true);
  if (query.date && !validDate(query.date)) fail(400, '日期不正确');
  if (query.campus && !['南湖', '浑南'].includes(query.campus)) fail(400, '校区不正确');
  if (query.timeSlot) {
    query.timeSlot = normalizeTimeSlot(query.timeSlot);
    if (!query.timeSlot) fail(400, '时段不正确');
  }
  return query;
}
export function statsQuery(input) {
  const range = input.range || 'all',
    day = input.day || '';
  if (!['7', '30', 'all'].includes(range) || (day && !validDate(day)))
    fail(400, '统计范围或日期不正确');
  return { range, day };
}
export function slotCapacityInput(input) {
  if (!CAMPUSES.includes(input.campus)) fail(400, '校区不正确');
  const timeSlot = normalizeTimeSlot(stringField(input.timeSlot, '时段', 40, true));
  if (!TIME_SLOTS.includes(timeSlot)) fail(400, '时段不正确');
  if (!Number.isInteger(input.weekday) || input.weekday < 1 || input.weekday > 4)
    fail(400, '请选择周一至周四');
  if (!Number.isSafeInteger(input.capacity) || input.capacity < 0)
    fail(400, '预约人数必须为非负安全整数');
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) fail(400, '配置版本不正确');
  return {
    campus: input.campus,
    weekday: input.weekday,
    timeSlot,
    capacity: input.capacity,
    revision: input.revision
  };
}
export function slotCapacityBatchInput(input) {
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 32)
    fail(400, '请选择 1 至 32 项人数配置');
  const items = input.items.map((item) => {
    if (!item || typeof item !== 'object') fail(400, '人数配置不正确');
    return slotCapacityInput(item);
  });
  if (
    new Set(items.map((item) => `${item.campus}/${item.weekday}/${item.timeSlot}`)).size !==
    items.length
  )
    fail(400, '人数配置不能重复');
  return items;
}
export function passwordInput(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128)
    fail(400, '密码长度应为 8 至 128 位');
  return value;
}
export function campusGrants(value) {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 2 ||
    value.some((campus) => !CAMPUSES.includes(campus)) ||
    new Set(value).size !== value.length
  )
    fail(400, '请选择有效的授权校区');
  return [...value].sort();
}
export function userPatch(input) {
  const patch = {};
  if (input.password !== undefined) patch.password = passwordInput(input.password);
  if (input.status !== undefined) {
    if (!['enabled', 'disabled'].includes(input.status)) fail(400, '账号状态不正确');
    patch.status = input.status;
  }
  if (input.name !== undefined) {
    patch.name = stringField(input.name, '姓名', 80, true);
    if (patch.name.length < 2) fail(400, '姓名格式不正确');
  }
  if (input.homeCampus !== undefined) {
    if (!CAMPUSES.includes(input.homeCampus)) fail(400, '校区不正确');
    patch.homeCampus = input.homeCampus;
  }
  if (input.authorizedCampuses !== undefined)
    patch.authorizedCampuses = campusGrants(input.authorizedCampuses);
  if (input.role !== undefined) {
    if (!Object.hasOwn(roleLevel, input.role)) fail(400, '角色不正确');
    patch.role = input.role;
  }
  return patch;
}
export function assigneeQuery(input) {
  const campus = stringField(input.campus, '校区', 20, true);
  if (!CAMPUSES.includes(campus)) fail(400, '校区不正确');
  return { campus, q: stringField(input.q, '搜索内容', 120) };
}
