import { fail } from '../../lib/http.js';
import {
  dateKey,
  eventWindow,
  instant,
  nowIso,
  weekRange,
  validDate,
  addDays
} from '../../platform/time.js';
import { requestId, stableJson, publicResourceRef } from '../../platform/contracts.js';
import { attendanceMethod, policyFor } from '../../modules/attendance/public.js';
import { campusId as normalizeCampusId } from '../../modules/authorization/scopes.js';
import { csvLine } from '../../lib/csv.js';
import { staffIdentities } from '../../../shared/staff-identities.js';
import { weeklyAttendanceRows } from '../../modules/attendance/weekly-export.js';
import {
  assertDutyAttendanceDate,
  randomToken,
  hashPayload,
  tokenDigest,
  inputString
} from './shared.js';

export function attendanceDomain({
  repository,
  platform,
  contextFor,
  evaluate,
  requirePermission,
  withReceipt
}) {
  async function createAttendanceEvent(actor, input) {
    await requirePermission(actor, 'attendance.session.manage', { campusId: input.campusId });
    const type = ['duty', 'meeting'].includes(input.type) ? input.type : 'duty';
    const businessDate = input.businessDate || dateKey();
    const startsAt = instant(input.startsAt || `${businessDate}T18:30:00+08:00`);
    const endsAt = instant(input.endsAt || `${businessDate}T21:30:00+08:00`);
    if (endsAt <= startsAt) fail(400, '签到窗口不正确');
    if (!validDate(businessDate)) fail(400, '签到日期不正确');
    assertDutyAttendanceDate({ type, businessDate, startsAt, endsAt });
    const context = await contextFor(actor);
    return withReceipt(actor, 'attendance.event.create', input, async () => {
      const created = await repository.createEvent(
        {
          type,
          policyCode: input.policyCode || `${type}.v1`,
          policyVersion: input.policyVersion || '1.0.0',
          ruleSnapshot: input.ruleSnapshot || { timezone: 'Asia/Shanghai' },
          campusId: input.campusId || null,
          businessDate,
          startsAt,
          endsAt,
          sourceRef: input.sourceRef || {}
        },
        context.actor.memberId,
        {
          actorMemberId: context.actor.memberId,
          actorAccount: actor.account,
          authVersion: context.authVersion,
          action: 'attendance.event.created',
          after: { type, businessDate, campusId: input.campusId, startsAt, endsAt },
          requestId: input.requestId
        }
      );
      if (!created) fail(409, '权限已变化，请重新登录后重试');
      return created;
    });
  }

  async function issueAttendanceToken(actor, eventId, input = {}) {
    const context = await contextFor(actor);
    const event = await repository.attendanceEvent?.(eventId);
    if (!event) fail(404, '签到场次不存在');
    await requirePermission(actor, 'attendance.session.manage', { campusId: event.campusId });
    const token = randomToken();
    const expiresAt = instant(input.expiresAt || event.endsAt);
    if (Date.parse(expiresAt) <= Date.now() || Date.parse(expiresAt) > Date.parse(event.endsAt))
      fail(400, '签到凭证到期时间不正确');
    const result = await repository.issueToken(
      eventId,
      await tokenDigest(token),
      expiresAt,
      context.actor.memberId,
      input.revision ?? event.revision
    );
    if (!result) fail(409, '签到场次已被更新，请刷新');
    return {
      eventId,
      token: `pioneer:attendance:v1:${token}`,
      version: result.version,
      expiresAt: result.expires_at,
      tokenId: result.id
    };
  }

  async function attendanceCredential(actor, input) {
    if (typeof input.token !== 'string' || !input.token.trim() || input.token.length > 256)
      fail(400, '签到凭证不正确');
    const rawToken = input.token?.startsWith('pioneer:attendance:v1:')
      ? input.token.slice('pioneer:attendance:v1:'.length)
      : input.token;
    if (!rawToken) fail(400, '签到凭证不正确');
    const found = await repository.findEventByToken(await tokenDigest(rawToken));
    if (!found) fail(404, '签到凭证已失效');
    const { event } = found;
    if (
      event.type === 'duty' &&
      (await repository.serviceDay(event.businessDate, event.campusId))?.paused
    )
      fail(409, '该日期暂停维修，不能签到', 'SERVICE_DAY_PAUSED');
    const authorization = await requirePermission(actor, 'attendance.self', {
      campusId: event.campusId,
      memberId: actor.memberId
    });
    const context = authorization.context;
    const campusNames = { 'campus-nanhu': '南湖', 'campus-hunnan': '浑南' };
    if (
      event.campusId &&
      !(actor.authorizedCampuses || []).some(
        (value) => value === event.campusId || value === campusNames[event.campusId]
      )
    )
      fail(403, '没有该校区的签到权限');
    const policy = policyFor(event);
    if (!policy) fail(400, '签到策略不存在');
    const now = nowIso();
    if (!eventWindow(event.startsAt, event.endsAt, now)) fail(409, '当前不在签到时间窗口');
    assertDutyAttendanceDate(event, 409);
    const eligible = policy.checkEligibility({
      event,
      context: { ...context, attendanceEligible: authorization.result.allowed }
    });
    if (!eligible) fail(403, '当前成员没有该场次的签到资格');
    return { found, event, context, policy, now };
  }

  async function checkIn(actor, input) {
    // Public requests prove QR possession only. Hardware evidence must come from a
    // trusted server adapter; body flags cannot attest NFC or manual attendance.
    if (input.method !== undefined && input.method !== 'qr')
      fail(403, '此入口仅支持扫码签到，补录请使用考勤修正');
    return commitAttendance(actor, input, await attendanceCredential(actor, input));
  }

  async function directAttendanceAction(actor, campusId, providedContext) {
    const context = providedContext || (await contextFor(actor)),
      identities = staffIdentities(context, platform.authorizer, { campusId });
    const scheduled = context.todayDuties.filter(
      (duty) => duty.campusId === campusId && duty.leaveStatus !== 'approved'
    );
    const leader = identities.some((item) =>
      ['repair_lead', 'office_lead', 'superadmin'].includes(item.code)
    );
    const qualified = scheduled.some((duty) => duty.dutyType === 'office') || leader;
    const permission = evaluate(context, 'attendance.self', {
      campusId,
      memberId: context.actor.memberId
    }).allowed;
    const paused = !!(await repository.serviceDay(dateKey(), campusId))?.paused;
    const reason = paused
      ? '今天暂停维修，停止签到'
      : !permission
        ? '没有该校区的签到权限'
        : !qualified
          ? '请扫描工作人员签到码完成签到'
          : '';
    return { allowed: !reason, reason };
  }

  async function directCheckIn(actor, input) {
    const campusId = normalizeCampusId(input.campusId),
      decision = await directAttendanceAction(actor, campusId);
    if (!decision.allowed) fail(403, decision.reason);
    const { context } = await requirePermission(actor, 'attendance.self', {
      campusId,
      memberId: actor.memberId
    });
    const businessDate = dateKey(),
      now = nowIso();
    const event =
      (await repository.dutyEvent(businessDate, campusId)) ||
      (await repository.createEvent(
        {
          type: 'duty',
          policyCode: 'duty.v1',
          policyVersion: '1.0.0',
          ruleSnapshot: { timezone: 'Asia/Shanghai' },
          campusId,
          businessDate,
          startsAt: `${businessDate}T18:30:00+08:00`,
          endsAt: `${businessDate}T21:30:00+08:00`,
          sourceRef: {}
        },
        context.actor.memberId,
        {
          actorMemberId: context.actor.memberId,
          actorAccount: actor.account,
          authVersion: context.authVersion,
          action: 'attendance.event.created',
          requestId: input.requestId
        }
      ));
    if (!event || !eventWindow(event.startsAt, event.endsAt, now))
      fail(409, '当前不在签到时间窗口');
    return commitAttendance(
      actor,
      input,
      { found: null, event, context, policy: policyFor(event), now },
      true
    );
  }

  async function commitAttendance(
    actor,
    input,
    { found, event, context, policy, now },
    direct = false
  ) {
    assertDutyAttendanceDate(event, 409);
    const dedupeKey = policy.getDedupeScope({ memberId: context.actor.memberId, event });
    const existing = await repository.findAttendanceByDedupe(dedupeKey);
    if (existing) return { ...existing, isExisting: true, result: policy.describeResult(existing) };
    const method = direct ? 'manual' : attendanceMethod(input.method);
    const occurredAt = now;
    if (!eventWindow(event.startsAt, event.endsAt, occurredAt))
      fail(400, '签到发生时间不在场次窗口内');
    const record = await withReceipt(actor, 'attendance.checkin', input, async () => {
      const created = await repository.insertAttendance(
        {
          id: crypto.randomUUID(),
          memberId: context.actor.memberId,
          eventId: event.id,
          dedupeKey,
          occurredAt,
          recordedAt: now,
          method,
          sourceRef: event.sourceRef,
          campusId: event.campusId,
          businessDate: event.businessDate,
          departmentId: context.memberships.find((item) => item.isPrimary)?.departmentId,
          departmentName: context.memberships.find((item) => item.isPrimary)?.departmentName,
          identitySnapshot: {
            name: context.actor.name,
            memberId: context.actor.memberId,
            identities: context.identities
          },
          nonScheduled: !context.todayDuties.some((duty) => duty.campusId === event.campusId),
          actorAccount: actor.account,
          checkInAudit: true,
          direct,
          directLeader:
            direct &&
            staffIdentities(context, platform.authorizer, { campusId: event.campusId }).some(
              (item) => ['repair_lead', 'office_lead', 'superadmin'].includes(item.code)
            ),
          tokenId: found?.token.id,
          authVersion: context.authVersion,
          requestId: requestId(input.requestId),
          payloadHash: hashPayload(input),
          type: event.type
        },
        event.type === 'duty'
      );
      if (!created) {
        const concurrent = await repository.findAttendanceByDedupe(dedupeKey);
        if (concurrent)
          return { ...concurrent, isExisting: true, result: policy.describeResult(concurrent) };
        fail(409, '签到记录已被其他请求创建');
      }
      return { ...created, isExisting: false, result: policy.describeResult(created) };
    });
    return record;
  }

  async function previewAttendance(actor, input) {
    const { event } = await attendanceCredential(actor, input);
    const campusName = { 'campus-nanhu': '南湖', 'campus-hunnan': '浑南' }[event.campusId];
    return {
      campusName,
      businessDate: event.businessDate,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      type: event.type
    };
  }

  async function attendanceList(actor, query) {
    const context = await contextFor(actor);
    const filters = {
      memberId: query?.memberId,
      businessDate: query?.businessDate,
      month: query?.month,
      departmentId: query?.departmentId,
      type: inputString(query || {}, 'type', 80),
      campusId: query?.campusId ? normalizeCampusId(query.campusId) : undefined
    };
    if (query?.businessDate && !validDate(query.businessDate)) fail(400, '签到日期不正确');
    if (query?.month && !validDate(`${query.month}-01`)) fail(400, '月份不正确');
    const all = query?.all === true || query?.all === '1' || query?.all === 'true';
    const otherMember = query?.memberId && query.memberId !== context.actor.memberId;
    const managing = all || otherMember;
    // A requested historical/future date selects records, never the actor's
    // grant version. Check every record with one complete current grant.
    if (managing && !context.permissions['attendance.correct'])
      fail(403, '没有查看其他成员签到记录的权限');
    if (all) {
      filters.memberId = query?.memberId || undefined;
    } else {
      if (!otherMember)
        await requirePermission(actor, 'attendance.self', { memberId: context.actor.memberId });
      filters.memberId = query?.memberId || context.actor.memberId;
    }
    let after;
    if (query?.cursor) {
      try {
        if (typeof query.cursor !== 'string' || query.cursor.length > 2048) throw new Error();
        const parts = JSON.parse(decodeURIComponent(query.cursor));
        if (
          !Array.isArray(parts) ||
          parts.length !== 2 ||
          typeof parts[0] !== 'string' ||
          !Number.isFinite(Date.parse(parts[0])) ||
          typeof parts[1] !== 'string' ||
          !parts[1] ||
          parts[1].length > 128
        )
          throw new Error();
        after = { occurredAt: parts[0], id: parts[1] };
      } catch {
        fail(400, '签到分页游标不正确');
      }
    }
    const items = [],
      definition = { unit: 'attendance_record', timezone: 'Asia/Shanghai', version: '1.0.0' };
    for (;;) {
      const records = await repository.listAttendance({ ...filters, after });
      for (const record of records) {
        if (
          managing &&
          !evaluate(context, 'attendance.correct', {
            id: record.id,
            memberId: record.memberId,
            campusId: record.campusId,
            departmentId: record.primaryDepartmentIdSnapshot
          }).allowed
        )
          continue;
        items.push(record);
        if (items.length === 101)
          return {
            items: items.slice(0, 100),
            nextCursor: encodeURIComponent(JSON.stringify([items[99].occurredAt, items[99].id])),
            definition
          };
      }
      if (records.length < 101) return { items, nextCursor: null, definition };
      const last = records.at(-1);
      after = { occurredAt: last.occurredAt, id: last.id };
    }
  }

  async function attendanceOptions(actor, query = {}) {
    const context = await contextFor(actor);
    if (!context.permissions['attendance.correct']) fail(403, '没有考勤修正权限');
    const businessDate = query.businessDate || dateKey(),
      campusId = normalizeCampusId(query.campusId);
    if (!validDate(businessDate) || !campusId) fail(400, '请选择有效日期和校区');
    const result = await repository.attendanceOptions({
      businessDate,
      campusId,
      q: inputString(query, 'q', 80)
    });
    const events = result.events.filter((item) =>
      (context.grants || []).some((grant) =>
        (grant.scope?.departmentIds || grant.scope?.departments || [undefined]).some(
          (departmentId) =>
            platform.authorizer.evaluate(
              context.actor,
              'attendance.correct',
              { id: item.id, campusId: item.campusId, departmentId },
              context,
              [grant]
            ).allowed
        )
      )
    );
    const members = result.members.filter((member) =>
      events.some(
        (item) =>
          evaluate(context, 'attendance.correct', {
            id: item.id,
            memberId: member.memberId,
            campusId: item.campusId,
            departmentId: member.departmentId
          }).allowed
      )
    );
    const identities = await repository.fieldContexts(
      members.map((item) => item.memberId),
      businessDate
    );
    return {
      events,
      members: members.map((member) => ({
        ...member,
        identities: identities.has(member.memberId)
          ? staffIdentities(identities.get(member.memberId), platform.authorizer, { campusId })
          : []
      }))
    };
  }

  async function attendanceExport(actor, query = {}) {
    if (query.weekStart) return weeklyAttendanceExport(actor, query);
    const month = query.month === undefined ? dateKey().slice(0, 7) : query.month;
    if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) fail(400, '月份不正确');
    const [year, monthNumber] = month.split('-').map(Number);
    if (
      !Number.isInteger(year) ||
      !Number.isInteger(monthNumber) ||
      monthNumber < 1 ||
      monthNumber > 12
    )
      fail(400, '月份不正确');
    const next = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
    const context = await contextFor(actor);
    if (!context.permissions['attendance.export']) fail(403, '没有导出考勤的权限');
    const names = { 南湖: 'campus-nanhu', 浑南: 'campus-hunnan' };
    const requestedCampus = query.campusId || '';
    if (requestedCampus && !['campus-nanhu', 'campus-hunnan'].includes(requestedCampus))
      fail(400, '校区不正确');
    const allowed = actor.authorizedCampuses || [];
    const campusIds = (
      requestedCampus ? [requestedCampus] : allowed.map((item) => names[item] || item)
    ).filter(Boolean);
    if (!campusIds.length) fail(403, '没有可导出的校区');
    const candidates = await repository.attendanceExport({
      month,
      nextMonth: next,
      campusIds,
      memberId: query.memberId,
      departmentId: query.departmentId
    });
    const rows = candidates.filter(
      (row) =>
        evaluate(context, 'attendance.export', {
          campusId: row.campusId,
          memberId: row.memberId,
          departmentId: row.departmentId
        }).allowed
    );
    const header = ['校区', '人员', '学号', '签到次数', '部门'];
    const body = rows.map((row) =>
      csvLine([
        row.campus,
        row.memberName,
        row.studentId ? `'${row.studentId}` : '',
        row.attendanceCount,
        row.department
      ])
    );
    return { month, rows, csv: `\uFEFF${header.join(',')}\r\n${body.join('')}` };
  }

  async function weeklyAttendanceExport(actor, query = {}) {
    const start = query.weekStart,
      end = query.weekEnd || start;
    if (
      !validDate(start) ||
      !validDate(end) ||
      weekRange(start).start !== start ||
      weekRange(end).start !== end ||
      end < start ||
      Date.parse(end) - Date.parse(start) > 25 * 7 * 86400000
    )
      fail(400, '请选择最多 26 周的周一范围');
    const context = await contextFor(actor);
    if (!context.permissions['attendance.export']) fail(403, '没有导出考勤的权限');
    if (query.campusId && !['campus-nanhu', 'campus-hunnan'].includes(query.campusId))
      fail(400, '校区不正确');
    const data = await repository.weeklyAttendanceData(start, addDays(end, 6)),
      paused = await repository.serviceDays(start, addDays(end, 6));
    const members = new Map(data.members.map((member) => [member.memberId, member])),
      rows = [];
    const canExport = (target) =>
      (!query.memberId || query.memberId === target.memberId) &&
      (!query.departmentId || query.departmentId === target.departmentId) &&
      (!query.campusId || query.campusId === target.campusId) &&
      evaluate(context, 'attendance.export', target).allowed;
    for (let week = start; week <= end; week = addDays(week, 7)) {
      const facts =
        query.leadersOnce === '1'
          ? (await repository.rosterMemberFacts([...members.keys()], week)).map((fact) => ({
              ...fact,
              campuses: members.get(fact.memberId).campuses
            }))
          : [];
      rows.push(
        ...weeklyAttendanceRows({
          week,
          records: data.records.filter(
            (row) => row.businessDate >= week && row.businessDate <= addDays(week, 6)
          ),
          facts,
          paused,
          authorizer: platform.authorizer,
          canExport,
          firstOnly: query.firstOnly === '1',
          leadersOnce: query.leadersOnce === '1'
        })
      );
    }
    const header = [
      '值班周',
      '姓名',
      '学号',
      '部门',
      '身份',
      '校区',
      '实际有效签到次数',
      '暂停日排除次数',
      '核算次数',
      '核算依据'
    ];
    return {
      weekStart: start,
      weekEnd: end,
      rows,
      definition: {
        firstOnly: query.firstOnly === '1',
        leadersOnce: query.leadersOnce === '1',
        unit: 'member_week',
        timezone: 'Asia/Shanghai'
      },
      csv: `\uFEFF${header.join(',')}\r\n${rows.map((row) => csvLine([row.weekStart, row.name, row.studentId ? `'${row.studentId}` : '', row.departments, row.identities, row.campuses, row.actualCount, row.excludedCount, row.creditedCount, row.basis])).join('')}`
    };
  }

  async function correctAttendance(actor, input) {
    if (
      typeof input.memberId !== 'string' ||
      !input.memberId ||
      input.memberId.length > 128 ||
      typeof input.eventId !== 'string' ||
      !input.eventId ||
      input.eventId.length > 128 ||
      typeof input.occurredAt !== 'string' ||
      !input.occurredAt ||
      input.occurredAt.length > 80 ||
      !input.reason
    )
      fail(400, '补录签到字段不完整');
    const reason = inputString(input, 'reason', 500, true);
    if (input.requestId !== undefined && !requestId(input.requestId)) fail(400, '请求编号不正确');
    if (!Number.isFinite(Date.parse(input.occurredAt))) fail(400, '补录时间不正确');
    const context = await contextFor(actor);
    const previousRecord = input.recordId ? await repository.attendanceById(input.recordId) : null;
    if (
      input.recordId &&
      (!previousRecord ||
        previousRecord.memberId !== input.memberId ||
        previousRecord.eventId !== input.eventId)
    )
      fail(404, '签到记录不存在');
    const occurredAt = instant(input.occurredAt);
    const fingerprint = await repository.attendanceCorrectionFingerprint(
      input.memberId,
      input.eventId,
      context.actor.memberId,
      context.businessDate,
      occurredAt
    );
    const event = await repository.attendanceEvent?.(input.eventId);
    if (!event) fail(404, '签到场次不存在');
    if (
      (input.campusId && normalizeCampusId(input.campusId) !== event.campusId) ||
      (input.businessDate && input.businessDate !== event.businessDate)
    )
      fail(400, '补录范围与签到场次不一致');
    if (
      !eventWindow(event.startsAt, event.endsAt, occurredAt) ||
      Date.parse(occurredAt) > Date.now()
    )
      fail(400, '补录时间必须位于场次窗口内且不能晚于现在');
    const primary = previousRecord
      ? {
          departmentId: previousRecord.primaryDepartmentIdSnapshot,
          departmentName: previousRecord.primaryDepartmentNameSnapshot
        }
      : (await repository.memberships(input.memberId, dateKey(new Date(occurredAt)))).find(
          (item) => item.isPrimary
        ) || null;
    if (
      !evaluate(context, 'attendance.correct', {
        id: event.id,
        memberId: input.memberId,
        campusId: event.campusId,
        departmentId: primary?.departmentId
      }).allowed
    )
      fail(403, '没有修正该校区与部门考勤的权限');
    const policy = policyFor(event);
    if (!policy) fail(400, '签到策略不存在');
    if (
      !policy.checkEligibility({
        event,
        context: { actor: { memberId: input.memberId }, attendanceEligible: true }
      })
    )
      fail(403, '该成员不在此场次的可参加范围内');
    const dedupeKey = policy.getDedupeScope({ memberId: input.memberId, event });
    const target = await repository.memberRow(input.memberId);
    if (!target) fail(404, '成员不存在');
    const receipt = {
      action: 'attendance.correct',
      id: requestId(input.requestId) || crypto.randomUUID(),
      hash: await tokenDigest(stableJson(input))
    };
    const replay = async () => {
      const previous = await repository.receipt(context.actor.memberId, receipt.action, receipt.id);
      if (!previous) return null;
      if (previous.payloadHash !== receipt.hash)
        fail(409, '请求编号已用于其他内容', 'REQUEST_CONFLICT');
      if (previous.resultStatus !== 'success')
        fail(409, '补录正在处理中，请稍后重试', 'REQUEST_CONFLICT');
      return { ...previous.result, idempotent: true };
    };
    const previous = await replay();
    if (previous) return previous;
    if (
      previousRecord &&
      (!Number.isInteger(input.revision) || input.revision !== previousRecord.revision)
    )
      fail(409, '签到已被其他人修正，请刷新后核对');
    const duties = await repository.todayDuties(input.memberId, event.businessDate);
    if (
      fingerprint !==
      (await repository.attendanceCorrectionFingerprint(
        input.memberId,
        input.eventId,
        context.actor.memberId,
        context.businessDate,
        occurredAt
      ))
    )
      fail(409, '成员资料、当日岗位或签到场次已变化，请重新核对');
    const created = await repository.correctAttendance(
      {
        id: previousRecord?.id || crypto.randomUUID(),
        previous: previousRecord,
        memberId: input.memberId,
        eventId: input.eventId,
        dedupeKey,
        occurredAt,
        recordedAt: nowIso(),
        sourceRef: event.sourceRef,
        departmentId: primary?.departmentId,
        departmentName: primary?.departmentName || 'unknown',
        identitySnapshot: {
          name: target.name,
          studentId: target.student_id || '',
          memberId: target.id
        },
        nonScheduled: !duties.length
      },
      {
        actorMemberId: context.actor.memberId,
        actorAccount: actor.account,
        authVersion: context.authVersion,
        businessDate: context.businessDate,
        action: 'attendance.corrected',
        reason,
        requestId: receipt.id
      },
      receipt,
      fingerprint
    );
    if (created) return created;
    const concurrent = await replay();
    if (concurrent) return concurrent;
    fail(409, '签到已存在，或成员资料、授权、场次已变化，请刷新后核对');
  }

  async function presence(actor, input) {
    if (input.businessDate && input.businessDate !== dateKey()) fail(400, '只能修改今天的在岗状态');
    const context = await contextFor(actor, input.businessDate || dateKey());
    if (!['available', 'away', 'off_duty'].includes(input.state)) fail(400, '在岗状态不正确');
    if (!context.presence) fail(409, '请先完成到岗签到');
    await requirePermission(actor, 'attendance.self', {
      campusId: context.presence.campusId,
      memberId: context.actor.memberId
    });
    if (input.campusId && input.campusId !== context.presence.campusId)
      fail(409, '在岗校区以签到记录为准');
    if (input.state !== 'available' && (await repository.activeRepair(context.actor.memberId)))
      fail(409, '当前仍有进行中的维修，不能离岗', 'PRESENCE_CHANGED');
    const result = await repository.setPresence(
      context.actor.memberId,
      { ...input, businessDate: input.businessDate || dateKey() },
      input.revision ?? 0,
      context.actor,
      {
        actorMemberId: context.actor.memberId,
        actorAccount: actor.account,
        authVersion: context.authVersion,
        action: 'duty.presence.changed',
        sourceRef: publicResourceRef(
          'duty',
          'presence',
          `${context.actor.memberId}:${context.businessDate}`
        ),
        before: context.presence,
        after: { state: input.state, campusId: context.presence.campusId },
        requestId: input.requestId
      }
    );
    if (!result) fail(409, '在岗状态已被其他操作修改，请刷新');
    return result;
  }
  return {
    createAttendanceEvent,
    issueAttendanceToken,
    checkIn,
    directAttendanceAction,
    directCheckIn,
    previewAttendance,
    attendanceList,
    attendanceOptions,
    attendanceExport,
    correctAttendance,
    presence
  };
}
