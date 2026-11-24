import type { RepairOutcome, StoredRepairLink } from '../../shared/appointment-types.ts';
import type { StaffAccountDto } from '../../shared/staff-types.ts';
import type { AppointmentListQuery, AppointmentRecord } from '../db/records.ts';

type Input = Readonly<Record<string, unknown>>;
type QueryInput = Readonly<Record<string, string | undefined>>;

export interface BookingData extends Partial<AppointmentRecord> {
  campus: string;
  date: string;
  timeSlot: string;
  studentId: string;
  acceptedNotices?: { id: string; revision: number }[];
  sameDeviceAndRepairRelated?: unknown;
  sameDeviceAndFault?: unknown;
  linkKind?: StoredRepairLink;
}

type RepairPatch = {
  status?: 'in_progress' | 'completed' | 'cancelled';
  outcome?: RepairOutcome;
  repairNote?: string;
  frontPhotoId?: string;
  backPhotoId?: string;
};
export interface Verification {
  brand: string;
  model: string;
  warranty: string;
  liquidMetal: string;
}

import { appointmentOrder, readAppointmentCursor } from '../../shared/appointment-pagination.ts';
import { fail } from './http.ts';
import {
  normalizeTimeSlot,
  statusLabels,
  repairOutcomes,
  CAMPUSES,
  roleLevel
} from '../../shared/constants.ts';
import { validDate } from '../../shared/time.ts';
import { validSignature } from '../../shared/signature.ts';
import { studentFieldErrors, AGREEMENT_VERSION, ANSWERS, bookingDeviceQuestions } from '../../shared/student-booking.ts';

export const account = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toLowerCase();
export function stringField(value: unknown, name: string, max: number, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    fail(400, `${name} 格式不正确或超过 ${max} 字符`);
  return value.trim();
}
export function onsiteBookingInput(input: Input): BookingData {
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
    liquidMetal: 30,
    dellG15: 20,
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
  ) as Record<keyof typeof limits | 'signature', string>;
  const questions = bookingDeviceQuestions(data.deviceType === '笔记本电脑' ? '笔记本' : data.deviceType, data.brand);
  for (const key of ['liquidMetal','dellG15'] as const) {
    if (!questions[key]) data[key] = '';
    else if (data[key] && !ANSWERS.includes(data[key])) fail(400, key === 'liquidMetal' ? '请选择是否使用液金' : '请选择是否属于 Dell G15 / G16 系列');
  }
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
export function bookingInput(input: Input): BookingData {
  const errors = studentFieldErrors(input);
  if (!CAMPUSES.some(campus => campus === input.campus)) errors.campus = '请选择校区';
  if (!validDate(input.date)) errors.date = '请选择有效的预约日期';
  const timeSlot = normalizeTimeSlot(input.timeSlot);
  if (!timeSlot) errors.timeSlot = '请选择到场时段';
  if (
    input.agreementAccepted !== true ||
    input.agreementVersion !== AGREEMENT_VERSION ||
    !Number.isFinite(Date.parse(input.agreementAt as string))
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
  ] as const;
  const fields = Object.fromEntries(keys.map((key) => [key, ((input[key] || '') as string).trim()])) as Record<typeof keys[number], string>;
  const data: BookingData = { ...fields, timeSlot };
  data.liquidMetal = data.deviceType === '笔记本' ? input.liquidMetal as string : null;
  data.dellG15 =
    data.deviceType === '笔记本' && data.brand === 'Dell' ? (input.dellG15 || null) as string | null : null;
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
export function bookingRequestKey(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value))
    fail(400, '缺少有效的预约请求标识', 'REQUEST_KEY_INVALID');
  return value;
}
export function serviceLocationInput(input: Input) {
  const campus = CAMPUSES.find(campus => campus === input.campus);
  if (!campus) fail(400, '校区不正确');
  if (!validDate(input.date)) fail(400, '服务日期不正确');
  if (typeof input.revision !== 'number' || !Number.isSafeInteger(input.revision) || input.revision < 0) fail(400, '地点版本不正确');
  return {
    campus,
    date: input.date,
    revision: input.revision,
    location: stringField(input.location, '维修地点', 200)
  };
}

export function appointmentPatch(input: Input) {
  const accepted = ['status','outcome','repairNote','frontPhotoId','backPhotoId','revision','requestId','action','verification','photosCaptured','uploadTimedOut'];
  if (!input || Object.keys(input).some(key=>!accepted.includes(key))) fail(400,'工单操作含不支持的字段');
  if (typeof input.revision !== 'number' || !Number.isInteger(input.revision) || input.revision<0) fail(400,'缺少工单版本');
  if (input.action!==undefined && input.action!=='correct') fail(400,'操作不正确');
  const patch: RepairPatch = {};
  if (input.status!==undefined) {
    if (input.status !== 'in_progress' && input.status !== 'completed' && input.status !== 'cancelled') fail(400,'不支持的状态转换');
    patch.status=input.status;
  }
  if (input.outcome!==undefined) {
    const outcome = repairOutcomes.find(value => value === input.outcome);
    if (!outcome) fail(400,'维修结果不正确');
    patch.outcome=outcome;
  }
  for (const [key,max] of [['repairNote',1000],['frontPhotoId',80],['backPhotoId',80]] as const)
    if (input[key]!==undefined) patch[key]=stringField(input[key],key,max);
  let verification;
  if (input.verification) {
    const value = input.verification as Partial<Record<keyof Verification, unknown>>;
    verification={brand:stringField(value.brand,'品牌',80),model:stringField(value.model,'型号',120),
      warranty:stringField(value.warranty,'保修',30),liquidMetal:stringField(value.liquidMetal,'液金',30)};
  }
  return {patch,revision:input.revision,action:input.action,requestId:input.requestId,verification,
    photosCaptured:input.photosCaptured,uploadTimedOut:input.uploadTimedOut};
}
export function appointmentQuery(input: QueryInput) {
  const query: AppointmentListQuery & Required<Pick<AppointmentListQuery, 'q' | 'campus' | 'date' | 'status' | 'timeSlot' | 'sort' | 'direction'>> = {
    q: stringField(input.q, '搜索内容', 120),
    campus: input.campus || '',
    date: input.date || '',
    status: input.status || 'all',
    timeSlot: input.timeSlot || '',
    sort: input.sort || 'createdAt',
    direction: input.direction || 'desc', deferCounts: input.deferCounts === '1'
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
  for (const key of ['dateFrom', 'dateTo'] as const) {
    if (input[key]) {
      if (!validDate(input[key])) fail(400, '日期范围不正确');
      query[key] = input[key];
    }
  }
  if (
    !!query.dateFrom !== !!query.dateTo ||
    (query.dateFrom && (query.dateFrom > (query.dateTo ?? '') || query.date))
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
export function liveQuery(input: QueryInput) {
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
export function statsQuery(input: QueryInput) {
  const range = input.range || 'all',
    day = input.day || '',
    campus = input.campus || '';
  if (!['7', '30', 'all'].includes(range) || (day && !validDate(day)))
    fail(400, '统计范围或日期不正确');
  if (campus && !CAMPUSES.some(value => value === campus)) fail(400, '校区不正确');
  return { range, day, campus };
}
export function slotCapacityInput(input: Input) {
  const campus = CAMPUSES.find(campus => campus === input.campus);
  if (!campus) fail(400, '校区不正确');
  const timeSlot = normalizeTimeSlot(stringField(input.timeSlot, '时段', 40, true));
  if (!timeSlot) fail(400, '时段不正确');
  if (typeof input.weekday !== 'number' || !Number.isInteger(input.weekday) || input.weekday < 1 || input.weekday > 4)
    fail(400, '请选择周一至周四');
  if (typeof input.capacity !== 'number' || !Number.isSafeInteger(input.capacity) || input.capacity < 0)
    fail(400, '预约人数必须为非负安全整数');
  if (typeof input.revision !== 'number' || !Number.isSafeInteger(input.revision) || input.revision < 0) fail(400, '配置版本不正确');
  return {
    campus,
    weekday: input.weekday,
    timeSlot,
    capacity: input.capacity,
    revision: input.revision
  };
}
export function slotCapacityBatchInput(input: Input) {
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 32)
    fail(400, '请选择 1 至 32 项人数配置');
  const items = input.items.map((item) => {
    if (!item || typeof item !== 'object') fail(400, '人数配置不正确');
    return slotCapacityInput(item as Input);
  });
  if (
    new Set(items.map((item) => `${item.campus}/${item.weekday}/${item.timeSlot}`)).size !==
    items.length
  )
    fail(400, '人数配置不能重复');
  return items;
}
export function passwordInput(value: unknown) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128)
    fail(400, '密码长度应为 8 至 128 位');
  return value;
}
export function campusGrants(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 2 ||
    value.some((campus) => !CAMPUSES.some(value => value === campus)) ||
    new Set(value).size !== value.length
  )
    fail(400, '请选择有效的授权校区');
  return [...value].sort();
}
export function userPatch(input: Input) {
  const patch: Partial<Pick<StaffAccountDto, 'name' | 'status' | 'role' | 'homeCampus' | 'authorizedCampuses'>> & { password?: string } = {};
  if (input.password !== undefined) patch.password = passwordInput(input.password);
  if (input.status !== undefined) {
    if (input.status !== 'enabled' && input.status !== 'disabled') fail(400, '账号状态不正确');
    patch.status = input.status;
  }
  if (input.name !== undefined) {
    patch.name = stringField(input.name, '姓名', 80, true);
    if (patch.name.length < 2) fail(400, '姓名格式不正确');
  }
  if (input.homeCampus !== undefined) {
    if (!CAMPUSES.some(campus => campus === input.homeCampus)) fail(400, '校区不正确');
    patch.homeCampus = input.homeCampus as StaffAccountDto['homeCampus'];
  }
  if (input.authorizedCampuses !== undefined)
    patch.authorizedCampuses = campusGrants(input.authorizedCampuses);
  if (input.role !== undefined) {
    if (typeof input.role !== 'string' || !Object.hasOwn(roleLevel, input.role)) fail(400, '角色不正确');
    patch.role = input.role as keyof typeof roleLevel;
  }
  return patch;
}
export function assigneeQuery(input: QueryInput) {
  const campus = stringField(input.campus, '校区', 20, true);
  if (!CAMPUSES.some(value => value === campus)) fail(400, '校区不正确');
  return { campus, q: stringField(input.q, '搜索内容', 120) };
}
