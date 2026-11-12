import { fail } from '../../lib/http.js';
import { addDays, dateKey, weekRange, rosterWeekKey, validDate } from '../../platform/time.js';
import {
  DUTY_START,
  DUTY_END,
  DUTY_TYPES,
  dutyLeader,
  dutyCandidateTypes,
  availableForDuty
} from '../../../shared/duty.js';
import { suggestDuties } from '../../modules/rosters/suggestions.js';
import { campusId } from '../../modules/authorization/scopes.js';
import { requestId, stableJson } from '../../platform/contracts.js';
import { tokenDigest, inputString } from './shared.js';

export function scheduleDomain({ repository, contextFor, evaluate }) {
  const type = (value) => {
    if (!['repair', 'office'].includes(value)) fail(400, '请选择维修或办公班次');
    return value;
  };
  function week(value) {
    if (!validDate(value) || weekRange(value).start !== value) fail(400, '周开始日期必须为周一');
    return value;
  }
  function scoped(context, campus, manage = false) {
    campus = campusId(campus);
    if (
      !['campus-nanhu', 'campus-hunnan'].includes(campus) ||
      !evaluate(context, manage ? 'roster.manage' : 'roster.read', { campusId: campus }).allowed
    )
      fail(403, '没有该校区的排班访问权限');
    return campus;
  }
  function windows(context, values) {
    if (!Array.isArray(values) || values.length > 100) fail(400, '可用时间格式不正确');
    return values.map((row) => {
      if (
        !Number.isInteger(row.weekday) ||
        row.weekday < 1 ||
        row.weekday > 7 ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.startAt) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.endAt) ||
        row.startAt >= row.endAt
      )
        fail(400, '请检查可用日期和时间');
      return {
        weekday: row.weekday,
        campusId: scoped(context, row.campusId),
        startAt: row.startAt,
        endAt: row.endAt
      };
    });
  }
  async function command(context, action, input, id, before, after, result = {}) {
    const key = requestId(input.requestId);
    if (!key) fail(400, '缺少有效操作编号');
    const payloadHash = await tokenDigest(stableJson({ id, input }));
    const saved = await repository.receipt(context.actor.memberId, action, key);
    if (saved) {
      if (saved.payloadHash !== payloadHash) fail(409, '操作编号已用于其他内容');
      return { replay: saved.result };
    }
    return {
      record: {
        actorMemberId: context.actor.memberId,
        actorAccount: context.actor.account,
        authVersion: context.authVersion,
        action,
        requestId: key,
        payloadHash,
        sourceRef: { module: 'rosters', type: 'week', id },
        before,
        after,
        result,
        at: new Date().toISOString()
      }
    };
  }
  async function done(write, record) {
    if (await write) return record.result;
    const saved = await repository.receipt(record.actorMemberId, record.action, record.requestId);
    if (saved?.payloadHash === record.payloadHash) return saved.result;
    fail(409, '班表、可用时间或人员权限已变化，请刷新后重试');
  }
  async function availability(actor, query = {}) {
    const context = await contextFor(actor),
      dutyType = type(query.dutyType || 'repair'),
      weekStart = week(query.weekStart || rosterWeekKey());
    const rows = await repository.availabilityRows([context.actor.memberId], dutyType, weekStart);
    const usual = rows.find((row) => !row.weekStart) || { revision: -1, windows: [] },
      exception = rows.find((row) => row.weekStart === weekStart) || null;
    return {
      dutyType,
      weekStart,
      usual,
      exception,
      effectiveWindows: exception?.windows ?? usual.windows,
      source: exception?.windows ? 'exception' : 'usual',
      updatedThisWeek: !!exception?.windows
    };
  }
  async function saveAvailability(actor, input) {
    const context = await contextFor(actor),
      dutyType = type(input.dutyType),
      period = input.weekStart ? week(input.weekStart) : '';
    if (!Number.isInteger(input.revision) || input.revision < -1 || (input.useUsual && !period))
      fail(400, '可用时间版本或范围不正确');
    // JSON null restores usual availability while retaining the exception's revision.
    const normalized = {
      ...input,
      windows: input.useUsual ? null : windows(context, input.windows)
    };
    const before =
      (await repository.availabilityRows([context.actor.memberId], dutyType, period)).find(
        (row) => row.weekStart === period
      ) || null;
    const cmd = await command(
      context,
      'rosters.availability.updated',
      input,
      `${context.actor.memberId}:${dutyType}:${period}`,
      before,
      normalized
    );
    if (!cmd.replay)
      await done(
        repository.saveAvailability(
          context.actor.memberId,
          dutyType,
          period,
          normalized,
          cmd.record
        ),
        cmd.record
      );
    return availability(actor, { dutyType, weekStart: period || undefined });
  }
  async function rosterWeek(actor, query) {
    const context = await contextFor(actor),
      campus = scoped(context, query.campusId),
      dutyType = type(query.dutyType || 'repair'),
      weekStart = week(query.weekStart || rosterWeekKey());
    const canManage = evaluate(context, 'roster.manage', { campusId: campus }).allowed;
    const data = await repository.scheduleWeek(weekStart, campus, dutyType);
    if (!canManage)
      return {
        ...data,
        assignments: data.assignments.filter((item) => item.memberId === context.actor.memberId),
        canManage: false
      };
    const people = await repository.schedulePeople(campus),
      values = await repository.availabilityRows(
        people.map((row) => row.memberId),
        dutyType,
        weekStart
      );
    return {
      ...data,
      canManage,
      people: people.map((person) => {
        const exception = values.find(
            (row) =>
              row.memberId === person.memberId &&
              row.weekStart === weekStart &&
              row.windows !== null
          ),
          usual = values.find((row) => row.memberId === person.memberId && !row.weekStart);
        return {
          ...person,
          windows: ((exception || usual)?.windows || []).filter((row) => row.campusId === campus),
          availabilitySource: exception ? 'exception' : usual ? 'usual' : 'unset',
          availabilityUpdatedAt: (exception || usual)?.updatedAt || null
        };
      }),
      history: await repository.scheduleHistory(data.id)
    };
  }
  async function saveRosterWeek(actor, input) {
    const context = await contextFor(actor),
      campus = scoped(context, input.campusId, true),
      dutyType = type(input.dutyType),
      weekStart = week(input.weekStart);
    const before = await repository.scheduleWeek(weekStart, campus, dutyType);
    const cmd = await command(context, 'rosters.week.published', input, before.id, before, null);
    if (cmd.replay) return rosterWeek(actor, input);
    if (!Number.isInteger(input.revision) || input.revision !== before.revision)
      fail(409, '班表已变化，请刷新');
    const snapshot = await repository.scheduleSnapshot(campus, weekStart);
    const people = await repository.schedulePeople(campus);
    const paused = (await repository.serviceDays(weekStart, addDays(weekStart, 6)))
      .filter((row) => row.campusId === campus && row.paused)
      .map((row) => row.businessDate);
    const items = normalizeWeek(before, input.assignments, people, paused);
    assertNoOverlap(items);
    cmd.record.after = { ...before, assignments: items, revision: before.revision + 1 };
    await done(
      repository.saveSchedules(
        [{ before, items }],
        cmd.record,
        repository.scheduleSnapshotGuard(campus, weekStart, snapshot)
      ),
      cmd.record
    );
    return rosterWeek(actor, input);
  }
  async function rosterMine(actor, query = {}) {
    const context = await contextFor(actor),
      weekStart = week(query.weekStart || rosterWeekKey());
    return {
      weekStart,
      items: (query.upcoming === '1'
        ? await repository.upcomingAssignments(context.actor.memberId, dateKey())
        : await repository.listAssignments(context.actor.memberId, weekStart)
      ).filter((row) => evaluate(context, 'roster.read', { campusId: row.campusId }).allowed)
    };
  }

  async function campusWeekData(actor, query) {
    const context = await contextFor(actor),
      campus = scoped(context, query.campusId, true),
      weekStart = week(query.weekStart || rosterWeekKey());
    const [snapshot, people] = await Promise.all([
      repository.scheduleSnapshot(campus, weekStart),
      repository.schedulePeople(campus)
    ]);
    const ids = people.map((person) => person.memberId);
    const [rosters, facts, values, pauses] = await Promise.all([
      Promise.all(
        DUTY_TYPES.map((dutyType) => repository.scheduleWeek(weekStart, campus, dutyType))
      ),
      repository.rosterMemberFacts(ids, weekStart),
      Promise.all(
        DUTY_TYPES.map((dutyType) => repository.availabilityRows(ids, dutyType, weekStart))
      ),
      repository.serviceDays(weekStart, addDays(weekStart, 6))
    ]);
    if (snapshot !== (await repository.scheduleSnapshot(campus, weekStart)))
      fail(409, '人员或班表已变化，请刷新');
    const availability = values.flat();
    const factsByMember = new Map(facts.map((fact) => [fact.memberId, fact]));
    const availabilityByMember = new Map();
    for (const row of availability) {
      const key = `${row.memberId}:${row.dutyType}`;
      if (!availabilityByMember.has(key)) availabilityByMember.set(key, []);
      availabilityByMember.get(key).push(row);
    }
    return {
      context,
      snapshot,
      weekStart,
      campusId: campus,
      rosters,
      availability,
      people: people.map((person) => ({
        ...person,
        ...factsByMember.get(person.memberId),
        availability: Object.fromEntries(
          DUTY_TYPES.map((dutyType) => {
            const rows = availabilityByMember.get(`${person.memberId}:${dutyType}`) || [];
            return [
              dutyType,
              rows.find((row) => row.weekStart === weekStart && row.windows !== null)?.windows ??
                rows.find((row) => !row.weekStart)?.windows ??
                []
            ];
          })
        )
      })),
      paused: pauses
        .filter((row) => row.campusId === campus && row.paused)
        .map((row) => row.businessDate)
    };
  }
  function publicCampusWeek(data) {
    return {
      weekStart: data.weekStart,
      campusId: data.campusId,
      rosters: data.rosters,
      paused: data.paused,
      people: data.people.map(
        ({ memberId, name, studentId, memberships, availability, assignments }) => ({
          memberId,
          name,
          studentId,
          memberships,
          availability,
          alreadyScheduled: assignments.some((row) => row.campusId !== data.campusId)
        })
      )
    };
  }
  async function campusWeek(actor, query) {
    const data = await campusWeekData(actor, query);
    return { ...publicCampusWeek(data), sourceVersion: await tokenDigest(data.snapshot) };
  }
  function normalizeWeek(before, values, people, paused) {
    if (!Array.isArray(values) || values.length > 300) fail(400, '班次格式不正确或过多');
    const items = values.map((row) => {
      if (!people.some((person) => person.memberId === row.memberId))
        fail(403, '排班人员无该校区访问权限或已停用');
      if (!validDate(row.businessDate) || weekRange(row.businessDate).start !== before.weekStart)
        fail(400, '班次日期必须位于当前周');
      const startAt = row.startAt || DUTY_START,
        endAt = row.endAt || DUTY_END;
      const previous = before.assignments.find((item) => item.id === row.id);
      const same =
        previous &&
        previous.memberId === row.memberId &&
        previous.businessDate === row.businessDate &&
        previous.startAt === startAt &&
        previous.endAt === endAt;
      if (!same && (startAt !== DUTY_START || endAt !== DUTY_END))
        fail(400, '新班次统一为19:00–21:00');
      if (!same && paused.includes(row.businessDate)) fail(409, '该日期已暂停服务，不能新增班次');
      return {
        id: same ? previous.id : crypto.randomUUID(),
        memberId: row.memberId,
        businessDate: row.businessDate,
        startAt,
        endAt,
        dutyType: before.dutyType
      };
    });
    if (new Set(items.map((row) => row.id)).size !== items.length)
      fail(400, '不能重复提交同一班次');
    return items;
  }
  function assertNoOverlap(items) {
    for (let i = 0; i < items.length; i++)
      for (let j = 0; j < i; j++) {
        const a = items[i],
          b = items[j];
        if (
          a.memberId === b.memberId &&
          a.businessDate === b.businessDate &&
          a.startAt < b.endAt &&
          b.startAt < a.endAt
        )
          fail(400, '同一成员的班次时间重叠');
      }
  }
  async function rosterSuggestions(actor, input) {
    const data = await campusWeekData(actor, input);
    if (input.sourceVersion && input.sourceVersion !== (await tokenDigest(data.snapshot)))
      fail(409, '空闲、人员或班表已变化，请刷新后重新核对');
    if (!Array.isArray(input.assignments || [])) fail(400, '保留班次格式不正确');
    const kept = data.rosters.flatMap((before) => {
      const values = (input.assignments || data.rosters.flatMap((row) => row.assignments)).filter(
        (row) => row.dutyType === before.dutyType
      );
      const normalized = normalizeWeek(before, values, data.people, data.paused);
      return normalized.map((row, i) => ({
        ...row,
        id: values[i].id || `retained-${before.dutyType}-${i}-${row.memberId}-${row.businessDate}`,
        campusId: data.campusId,
        leaveStatus: before.assignments.find((old) => old.id === row.id)?.leaveStatus || ''
      }));
    });
    assertNoOverlap(kept);
    const result = suggestDuties({ ...data, kept });
    return { ...result, sourceVersion: await tokenDigest(data.snapshot) };
  }
  async function publishCampusWeek(actor, input) {
    const data = await campusWeekData(actor, input);
    const cmd = await command(
      data.context,
      'rosters.campus-week.published',
      input,
      `${data.weekStart}:${data.campusId}`,
      data.rosters,
      null
    );
    if (cmd.replay) return campusWeek(actor, input);
    if (input.sourceVersion !== (await tokenDigest(data.snapshot)))
      fail(409, '空闲、人员或班表已变化，请刷新后重新核对');
    if (
      !Array.isArray(input.rosters) ||
      input.rosters.length !== 2 ||
      new Set(input.rosters.map((row) => row.dutyType)).size !== 2
    )
      fail(400, '请同时提交维修和办公班表');
    const weeks = data.rosters.map((before) => {
      const value = input.rosters.find((row) => row.dutyType === before.dutyType);
      if (!value || value.revision !== before.revision) fail(409, '班表已变化，请刷新');
      return { before, items: normalizeWeek(before, value.assignments, data.people, data.paused) };
    });
    const assignments = weeks.flatMap((row) => row.items);
    assertNoOverlap(assignments);
    const warnings = [];
    for (const person of data.people) {
      const mine = assignments.filter((row) => row.memberId === person.memberId);
      if (
        mine.length + person.assignments.filter((row) => row.campusId !== data.campusId).length >
        1
      )
        warnings.push(`${person.name}本周有多次值班`);
      for (const row of mine) {
        const weekday = new Date(`${row.businessDate}T12:00:00Z`).getUTCDay() || 7;
        if (!availableForDuty(person.availability[row.dutyType], weekday, data.campusId))
          warnings.push(`${person.name} ${row.businessDate}不在已填整班空闲内`);
        if (!dutyCandidateTypes(person.memberships, row.businessDate).includes(row.dutyType))
          warnings.push(`${person.name}为跨部门安排`);
      }
    }
    for (let i = 0; i < 4; i++) {
      const day = addDays(data.weekStart, i);
      if (!data.paused.includes(day) && !assignments.some((row) => row.businessDate === day))
        warnings.push(`${day}尚未安排值班人员`);
      if (
        !data.paused.includes(day) &&
        !assignments.some(
          (row) =>
            row.businessDate === day &&
            data.rosters.flatMap((roster) => roster.assignments).find((old) => old.id === row.id)
              ?.leaveStatus !== 'recorded' &&
            dutyLeader(
              data.people.find((person) => person.memberId === row.memberId)?.memberships || [],
              day
            )
        )
      )
        warnings.push(`${day}缺少硬件部负责人或更高职位人员`);
    }
    cmd.record.after = {
      rosters: weeks.map((row) => ({ ...row.before, assignments: row.items })),
      warnings
    };
    await done(
      repository.saveSchedules(
        weeks,
        cmd.record,
        repository.scheduleSnapshotGuard(data.campusId, data.weekStart, data.snapshot)
      ),
      cmd.record
    );
    return { ...(await campusWeek(actor, input)), warnings };
  }
  async function ownAssignment(actor, id) {
    const context = await contextFor(actor),
      item = await repository.assignmentById(id);
    if (!item || !item.active) fail(404, '当前班次不存在');
    if (item.memberId !== context.actor.memberId) fail(403, '只能操作本人班次');
    scoped(context, item.campusId);
    return { context, item };
  }
  async function leave(actor, id, input) {
    const { context, item } = await ownAssignment(actor, id),
      reason = inputString(input, 'reason', 500, true);
    const cmd = await command(
      context,
      'rosters.leave.recorded',
      { ...input, assignmentId: id },
      item.weekId,
      item,
      { ...item, leaveStatus: 'recorded', reason }
    );
    if (cmd.replay) return { recorded: true };
    if (input.revision !== item.revision) fail(409, '班次已变化');
    await done(repository.recordLeave(item, { reason }, cmd.record), cmd.record);
    return { recorded: true };
  }
  async function withdrawLeave(actor, id, input) {
    const { context, item } = await ownAssignment(actor, id);
    const cmd = await command(
      context,
      'rosters.leave.withdrawn',
      { ...input, assignmentId: id },
      item.weekId,
      item,
      { ...item, leaveStatus: '' }
    );
    if (cmd.replay) return { withdrawn: true };
    if (input.revision !== item.revision) fail(409, '班次已变化');
    await done(repository.withdrawLeave(item, cmd.record), cmd.record);
    return { withdrawn: true };
  }
  async function coverCandidates(actor, id) {
    const { item } = await ownAssignment(actor, id);
    return {
      items: (await repository.schedulePeople(item.campusId)).filter(
        (person) => person.memberId !== item.memberId
      )
    };
  }
  async function requestCover(actor, id, input) {
    const { context, item } = await ownAssignment(actor, id);
    if (
      input.toMemberId === item.memberId ||
      !(await repository.schedulePeople(item.campusId)).some(
        (person) => person.memberId === input.toMemberId
      )
    )
      fail(400, '请选择该校区的接替成员');
    const result = { id: crypto.randomUUID() },
      note = inputString(input, 'note', 500);
    const cmd = await command(
      context,
      'rosters.cover.requested',
      { ...input, assignmentId: id },
      item.weekId,
      item,
      { toMemberId: input.toMemberId, note },
      result
    );
    if (cmd.replay) return cmd.replay;
    if (input.revision !== item.revision) fail(409, '班次已变化');
    return done(repository.createCover(item, input.toMemberId, note, cmd.record), cmd.record);
  }
  async function covers(actor) {
    const context = await contextFor(actor),
      rows = await repository.covers(context.actor.memberId),
      items = [];
    for (const row of rows) {
      const item = await repository.assignmentById(row.assignment_id);
      if (!item || !evaluate(context, 'roster.read', { campusId: item.campusId }).allowed) continue;
      const exchangeAssignment = row.exchange_assignment_id
        ? await repository.assignmentById(row.exchange_assignment_id)
        : null;
      if (
        exchangeAssignment &&
        !evaluate(context, 'roster.read', { campusId: exchangeAssignment.campusId }).allowed
      )
        continue;
      items.push({
        id: row.id,
        status: row.status,
        revision: row.revision,
        note: row.note,
        fromName: row.from_name,
        toName: row.to_name,
        assignment: item,
        exchangeAssignment,
        canRespond: row.to_member_id === context.actor.memberId && row.status === 'pending',
        canCancel: row.from_member_id === context.actor.memberId && row.status === 'pending'
      });
    }
    return { items };
  }
  async function respondCover(actor, id, input) {
    const context = await contextFor(actor),
      row = await repository.cover(id);
    if (!row) fail(404, '接替邀请不存在');
    if (!['accepted', 'declined', 'cancelled'].includes(input.decision))
      fail(400, '接替动作不正确');
    if (
      (input.decision === 'cancelled' ? row.from_member_id : row.to_member_id) !==
      context.actor.memberId
    )
      fail(403, '只有邀请发起人可撤回、接替者可确认');
    const original = await repository.assignmentById(row.assignment_id);
    if (!original) fail(404, '原班次不存在');
    scoped(context, original.campusId);
    const cmd = await command(
      context,
      'rosters.cover.responded',
      { ...input, coverId: id },
      original.weekId,
      row,
      { id, status: input.decision },
      { status: input.decision }
    );
    if (cmd.replay) return cmd.replay;
    if (input.revision !== row.revision || row.status !== 'pending') fail(409, '邀请已变化');
    const changes = [];
    if (input.decision === 'accepted') {
      if (
        !original.active ||
        original.revision !== row.assignment_revision ||
        original.memberId !== row.from_member_id
      )
        fail(409, '原班次已变化，请重新邀请');
      changes.push({ ...original, memberId: row.to_member_id });
      if (row.exchange_assignment_id) {
        const other = await repository.assignmentById(row.exchange_assignment_id);
        if (
          !other?.active ||
          other.revision !== row.exchange_revision ||
          other.memberId !== row.to_member_id
        )
          fail(409, '互换班次已变化');
        scoped(context, other.campusId);
        changes.push({ ...other, memberId: row.from_member_id });
      }
    }
    cmd.record.after.changes = changes;
    await done(repository.decideCover(row, input.decision, changes, cmd.record), cmd.record);
    return { status: input.decision };
  }
  return {
    availability,
    saveAvailability,
    rosterWeek,
    saveRosterWeek,
    rosterMine,
    campusWeek,
    rosterSuggestions,
    publishCampusWeek,
    leave,
    withdrawLeave,
    coverCandidates,
    requestCover,
    covers,
    respondCover
  };
}
