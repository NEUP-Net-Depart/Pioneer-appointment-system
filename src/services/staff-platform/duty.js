import { fail } from '../../lib/http.js';
import { dateKey, validDate, nowIso, eventWindow } from '../../platform/time.js';
import { requestId, stableJson } from '../../platform/contracts.js';
import { campusId as normalizeCampus } from '../../modules/authorization/scopes.js';
import { dutyCampusNames, dutyWindow } from '../../../shared/duty.js';
import { tokenDigest, inputString } from './shared.js';

export function dutyDomain({ repository, contextFor, evaluate, ensureDutyEvent }) {
  async function authorized(actor, campusId) {
    const context = await contextFor(actor),
      campus = normalizeCampus(campusId);
    if (
      !dutyCampusNames[campus] ||
      !evaluate(context, 'attendance.correct', { campusId: campus }).allowed
    )
      fail(403, '没有该校区的考勤管理权限');
    return { context, campus };
  }
  async function attendanceDay(actor, query) {
    const { context, campus } = await authorized(actor, query.campusId),
      day = query.businessDate || dateKey();
    if (!validDate(day)) fail(400, '日期不正确');
    const [data, attendance, service, people] = await Promise.all([
      repository.dutyDay(day, campus),
      repository.weeklyAttendanceData(day, day),
      repository.serviceDay(day, campus),
      repository.schedulePeople(campus)
    ]);
    const canCorrect = (memberId) =>
      !service?.paused && day <= dateKey() && people.some((person) => person.memberId === memberId);
    const records = attendance.records.filter(
      (row) =>
        row.campusId === campus &&
        evaluate(context, 'attendance.correct', {
          campusId: campus,
          memberId: row.memberId,
          departmentId: row.primaryDepartmentIdSnapshot
        }).allowed
    );
    const byMember = new Map();
    for (const item of data.assignments) {
      if (
        !evaluate(context, 'attendance.correct', { campusId: campus, memberId: item.memberId })
          .allowed
      )
        continue;
      if (!byMember.has(item.memberId))
        byMember.set(item.memberId, {
          memberId: item.memberId,
          name: item.memberName,
          assignments: []
        });
      byMember.get(item.memberId).assignments.push(item);
    }
    const now = nowIso();
    const items = [...byMember.values()].map((person) => {
      const expected = person.assignments.filter((row) => row.leaveStatus !== 'recorded');
      const item = expected[0] || person.assignments[0];
      const record = records.find((row) => row.memberId === person.memberId);
      const absent = expected.length && expected.every((row) => row.review?.decision === 'absent');
      const reviewEnd = expected.reduce(
        (latest, row) => (row.endAt > latest ? row.endAt : latest),
        item.endAt
      );
      const started = Date.parse(`${day}T${item.startAt}:00+08:00`) <= Date.parse(now);
      return {
        ...person,
        record,
        assignment: item,
        canCorrect: canCorrect(person.memberId),
        unavailable: !people.some((row) => row.memberId === person.memberId),
        presence: data.presence.find((row) => row.member_id === person.memberId)?.state || null,
        status: service?.paused
          ? 'paused'
          : !expected.length
            ? 'leave'
            : record
              ? 'arrived'
              : absent
                ? 'absent'
                : started
                  ? 'pending'
                  : 'upcoming',
        canConfirm:
          canCorrect(person.memberId) &&
          !service?.paused &&
          !!expected.length &&
          !record &&
          day === dateKey() &&
          eventWindow(...Object.values(dutyWindow(day)), now),
        canReview:
          canCorrect(person.memberId) &&
          !service?.paused &&
          !!expected.length &&
          !record &&
          Date.parse(`${day}T${reviewEnd}:00+08:00`) <= Date.parse(now)
      };
    });
    const temporary = records
      .filter((record) => !byMember.has(record.memberId))
      .map((record) => ({
        memberId: record.memberId,
        name: record.identitySnapshot?.name || record.memberName,
        canCorrect: canCorrect(record.memberId),
        record,
        status: 'arrived'
      }));
    return {
      businessDate: day,
      campusId: campus,
      paused: !!service?.paused,
      serverNow: now,
      items,
      temporary,
      summary: {
        expected: items.filter((row) => !['leave', 'paused'].includes(row.status)).length,
        arrived: items.filter((row) => row.status === 'arrived').length,
        pending: items.filter((row) => row.status === 'pending').length,
        absent: items.filter((row) => row.status === 'absent').length
      },
      people: people
        .filter(
          (person) =>
            evaluate(context, 'attendance.correct', { campusId: campus, memberId: person.memberId })
              .allowed
        )
        .map(({ memberId, name, studentId }) => ({ memberId, name, studentId }))
    };
  }
  async function command(actor, input, action) {
    if (!requestId(input.requestId)) fail(400, '缺少有效操作编号');
    const assignmentId = inputString(input, 'assignmentId', 128, true);
    const snapshot = await repository.dutySnapshot(assignmentId);
    const item = await repository.assignmentById(assignmentId);
    if (!item) fail(404, '班次已变化，请刷新');
    const { context } = await authorized(actor, item.campusId);
    const hash = await tokenDigest(stableJson(input));
    const previous = await repository.receipt(context.actor.memberId, action, input.requestId);
    if (previous) {
      if (previous.payloadHash !== hash) fail(409, '操作编号已用于其他内容');
      return { replay: previous.result };
    }
    if (!item.active) fail(409, '班次已变化，请刷新');
    if (input.assignmentRevision !== item.revision) fail(409, '班次已变化，请刷新');
    if (item.leaveStatus === 'recorded') fail(409, '该成员已请假，请先撤销请假或调整班表');
    if ((await repository.serviceDay(item.businessDate, item.campusId))?.paused)
      fail(409, '该日期暂停服务');
    const person = (await repository.schedulePeople(item.campusId)).find(
      (row) => row.memberId === item.memberId
    );
    if (!person) fail(409, '成员已停用或无该校区访问权限');
    const memberships = await repository.memberships(item.memberId, item.businessDate),
      department = memberships.find((row) => row.isPrimary);
    if (
      !evaluate(context, 'attendance.correct', {
        campusId: item.campusId,
        memberId: item.memberId,
        departmentId: department?.departmentId
      }).allowed
    )
      fail(403, '没有该人员的考勤管理权限');
    return {
      item,
      context,
      snapshot,
      person,
      department,
      record: {
        actorMemberId: context.actor.memberId,
        actorAccount: actor.account,
        authVersion: context.authVersion,
        action,
        requestId: input.requestId,
        payloadHash: hash,
        sourceRef: { module: 'rosters', type: 'assignment', id: item.id },
        before: item,
        after: input,
        at: nowIso(),
        result: { saved: true }
      }
    };
  }
  async function confirmArrival(actor, input) {
    const value = await command(actor, input, 'attendance.arrival.confirmed');
    if (value.replay) return value.replay;
    const { item, record, snapshot, person, department } = value;
    if (
      item.businessDate !== dateKey() ||
      !eventWindow(...Object.values(dutyWindow(item.businessDate)), record.at)
    )
      fail(409, '当前不在今日签到窗口，漏签请使用补录');
    const existing = await repository.findAttendanceByDedupe(
      `duty:${item.memberId}:${item.businessDate}`
    );
    if (existing) {
      if (existing.campusId !== item.campusId) fail(409, '该成员当天已在其他校区签到，请核对班表');
      return { saved: true, isExisting: true };
    }
    const event = await ensureDutyEvent(actor, item.businessDate, item.campusId);
    record.result = { id: crypto.randomUUID(), saved: true };
    record.reason = '负责人现场确认到场';
    record.after = {
      memberId: item.memberId,
      campusId: item.campusId,
      businessDate: item.businessDate,
      eventId: event.id,
      attendanceId: record.result.id,
      occurredAt: record.at
    };
    if (
      !(await repository.confirmDuty(item, event, record, snapshot, department, {
        memberId: item.memberId,
        name: person.name,
        studentId: person.studentId
      }))
    ) {
      const concurrent = await repository.findAttendanceByDedupe(
        `duty:${item.memberId}:${item.businessDate}`
      );
      if (concurrent) {
        if (concurrent.campusId !== item.campusId)
          fail(409, '该成员当天已在其他校区签到，请核对班表');
        return { saved: true, isExisting: true };
      }
      const receipt = await repository.receipt(
        record.actorMemberId,
        record.action,
        record.requestId
      );
      if (receipt?.payloadHash === record.payloadHash) return receipt.result;
      fail(409, '班次、成员或权限已变化，请刷新后核对');
    }
    return record.result;
  }
  async function reviewAttendance(actor, input) {
    if (
      !['absent', 'cleared'].includes(input.decision) ||
      !Number.isInteger(input.revision) ||
      input.revision < -1
    )
      fail(400, '核查结论或版本不正确');
    const value = await command(actor, input, 'attendance.reviewed');
    if (value.replay) return value.replay;
    const { item, record, snapshot } = value;
    if (Date.parse(`${item.businessDate}T${item.endAt}:00+08:00`) > Date.now())
      fail(409, '班次结束后才能确认未到');
    const data = await repository.dutyDay(item.businessDate, item.campusId);
    const review = data.assignments.find((row) => row.id === item.id)?.review;
    if ((review?.revision ?? -1) !== input.revision) fail(409, '核查结论已变化，请刷新');
    record.reason =
      inputString(input, 'reason', 500) ||
      (input.decision === 'absent' ? '负责人核查确认未到' : '撤销未到结论');
    record.before = { ...item, review: review || null };
    record.after = {
      ...input,
      memberId: item.memberId,
      revision: input.revision + 1,
      reason: record.reason
    };
    if (
      !(await repository.reviewDuty(item, { ...input, reason: record.reason }, record, snapshot))
    ) {
      const receipt = await repository.receipt(
        record.actorMemberId,
        record.action,
        record.requestId
      );
      if (receipt?.payloadHash === record.payloadHash) return receipt.result;
      fail(409, '签到、班次或核查结论已变化，请刷新');
    }
    return record.result;
  }
  return { attendanceDay, confirmArrival, reviewAttendance };
}
