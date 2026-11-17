import { fail } from '../../lib/http.js';
import { addDays, dateKey, weekRange, dutyWeekKey, validDate } from '../../platform/time.js';
import {
  DUTY_START,
  DUTY_END,
  DUTY_TYPES,
  DUTY_WEEKDAYS,
  dutyTypeLabels,
  isDutyExempt,
  dutyCandidateTypes,
  dutyAvailability,
  hasDutyAvailability,
  dutyPlanningReview,
  availableForDuty
} from '../../../shared/duty.js';
import { suggestDuties } from '../../modules/rosters/suggestions.js';
import { campusId } from '../../modules/authorization/scopes.js';
import { requestId, stableJson } from '../../platform/contracts.js';
import { tokenDigest, inputString } from './shared.js';
import { isRetiredElder } from '../../../shared/staff-identities.js';

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
        !DUTY_WEEKDAYS.includes(row.weekday) ||
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
      weekStart = week(query.weekStart || dutyWeekKey());
    const rows = await repository.availabilityRows([context.actor.memberId], weekStart);
    const value = dutyAvailability(rows, weekStart);
    const participates =
      !isRetiredElder(context) &&
      dutyCandidateTypes(context.memberships, context.authorizationDate).length > 0;
    return {
      weekStart,
      ...value,
      participates,
      needsAvailability:
        participates &&
        !hasDutyAvailability(value.effectiveWindows, context.actor.authorizedCampuses.map(campusId))
    };
  }
  async function saveAvailability(actor, input) {
    const context = await contextFor(actor),
      period = input.weekStart ? week(input.weekStart) : '';
    if (isRetiredElder(context)) fail(403, '退休老登不参与值班，无需填写空闲');
    if (isDutyExempt(context.memberships, context.authorizationDate))
      fail(403, '部长（含副）及以上不参与值班统计');
    if (!dutyCandidateTypes(context.memberships, context.authorizationDate).length)
      fail(403, '当前任职不参与值班统计');
    if (!Number.isInteger(input.revision) || input.revision < -1 || (input.useUsual && !period))
      fail(400, '可用时间版本或范围不正确');
    // JSON null restores usual availability while retaining the exception's revision.
    const normalized = {
      ...input,
      windows: input.useUsual ? null : windows(context, input.windows)
    };
    const current = dutyAvailability(
      await repository.availabilityRows([context.actor.memberId], period),
      period
    );
    if (
      !hasDutyAvailability(
        input.useUsual ? current.usual.windows : normalized.windows,
        context.actor.authorizedCampuses.map(campusId)
      )
    )
      fail(400, '请至少选择一天完整空闲时间');
    const before = period ? current.exception : current.usual;
    const storageType = before?.dutyType || 'repair';
    const cmd = await command(
      context,
      'rosters.availability.updated',
      input,
      `${context.actor.memberId}:availability:${period}`,
      before,
      normalized
    );
    if (!cmd.replay)
      await done(
        repository.saveAvailability(
          context.actor.memberId,
          storageType,
          period,
          normalized,
          cmd.record
        ),
        cmd.record
      );
    return availability(actor, { weekStart: period || undefined });
  }
  async function rosterWeek(actor, query) {
    const context = await contextFor(actor),
      campus = scoped(context, query.campusId),
      dutyType = type(query.dutyType || 'repair'),
      weekStart = week(query.weekStart || dutyWeekKey());
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
        weekStart
      );
    return {
      ...data,
      canManage,
      people: people.map((person) => {
        const value = dutyAvailability(
          values.filter((row) => row.memberId === person.memberId),
          weekStart
        );
        return {
          ...person,
          windows: value.effectiveWindows.filter((row) => row.campusId === campus),
          availabilitySource: value.usual.revision < 0 && !value.exception ? 'unset' : value.source,
          availabilityUpdatedAt:
            (value.source === 'exception' ? value.exception : value.usual)?.updatedAt || null
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
    const facts = await repository.rosterMemberFacts(
      people.map((person) => person.memberId),
      weekStart
    );
    const memberships = new Map(facts.map((person) => [person.memberId, person.memberships]));
    const paused = (await repository.serviceDays(weekStart, addDays(weekStart, 6)))
      .filter((row) => row.campusId === campus && row.paused)
      .map((row) => row.businessDate);
    const items = normalizeWeek(
      before,
      input.assignments,
      people.map((person) => ({ ...person, memberships: memberships.get(person.memberId) })),
      paused
    );
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
      weekStart = week(query.weekStart || dutyWeekKey());
    return {
      weekStart,
      items: (query.upcoming === '1'
        ? await repository.upcomingAssignments(context.actor.memberId, dateKey())
        : await repository.listAssignments(context.actor.memberId, weekStart)
      )
        .filter((row) => evaluate(context, 'roster.read', { campusId: row.campusId }).allowed)
        .map((row) => ({ ...row, canRequestCover: row.businessDate > dateKey() }))
    };
  }

  async function campusWeekData(actor, query) {
    const context = await contextFor(actor),
      campus = scoped(context, query.campusId, true),
      weekStart = week(query.weekStart || dutyWeekKey());
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
      repository.availabilityRows(ids, weekStart),
      repository.serviceDays(weekStart, addDays(weekStart, 6))
    ]);
    if (snapshot !== (await repository.scheduleSnapshot(campus, weekStart)))
      fail(409, '人员或班表已变化，请刷新');
    const availability = values;
    const factsByMember = new Map(facts.map((fact) => [fact.memberId, fact]));
    const availabilityByMember = new Map();
    for (const row of availability) {
      const key = row.memberId;
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
            const rows = availabilityByMember.get(person.memberId) || [];
            return [dutyType, dutyAvailability(rows, weekStart).effectiveWindows];
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
        ({
          memberId,
          name,
          studentId,
          homeCampusId,
          campuses,
          memberships,
          availability,
          assignments
        }) => ({
          memberId,
          name,
          studentId,
          homeCampusId,
          campuses,
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
      if (
        isDutyExempt(
          people.find((person) => person.memberId === row.memberId)?.memberships || [],
          row.businessDate
        )
      )
        fail(400, '部长（含副）及以上不参与值班统计，请移除对应安排');
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
        (row) =>
          row.dutyType === before.dutyType &&
          !isDutyExempt(
            data.people.find((person) => person.memberId === row.memberId)?.memberships || [],
            row.businessDate
          )
      );
      const normalized = normalizeWeek(before, values, data.people, data.paused);
      return normalized.map((row, i) => ({
        ...row,
        id: values[i].id || `retained-${before.dutyType}-${i}-${row.memberId}-${row.businessDate}`,
        campusId: data.campusId
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
        DUTY_WEEKDAYS.some((weekday) =>
          dutyCandidateTypes(person.memberships, addDays(data.weekStart, weekday - 1)).includes(
            'repair'
          )
        ) &&
        mine.length + person.assignments.filter((row) => row.campusId !== data.campusId).length > 1
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
    const review = dutyPlanningReview({ ...data, assignments });
    warnings.push(...review.gaps.map((row) => `${row.businessDate}${row.reason}`));
    warnings.push(
      ...review.unassigned
        .filter((row) => row.reasonCode !== 'scheduled_elsewhere')
        .map((row) => `${row.name} · ${dutyTypeLabels[row.dutyType]} · ${row.reason}`)
    );
    const days = DUTY_WEEKDAYS.map((weekday) => addDays(data.weekStart, weekday - 1)).filter(
      (day) => !data.paused.includes(day)
    );
    for (const dutyType of ['repair']) {
      const counts = days.map(
        (day) =>
          assignments.filter(
            (row) => row.businessDate === day && (!dutyType || row.dutyType === dutyType)
          ).length
      );
      if (counts.length && Math.max(...counts) - Math.min(...counts) > 2)
        warnings.push(`${dutyTypeLabels[dutyType] || '合计'}每日人数相差超过2人`);
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
  async function dutyPeople(campus, businessDate) {
    const people = await repository.schedulePeople(campus);
    const facts = await repository.rosterMemberFacts(
      people.map((person) => person.memberId),
      businessDate,
      businessDate
    );
    const memberships = new Map(facts.map((person) => [person.memberId, person.memberships]));
    return people.filter((person) => !isDutyExempt(memberships.get(person.memberId), businessDate));
  }
  async function coverCandidates(actor, id) {
    const { item } = await ownAssignment(actor, id);
    if (item.businessDate <= dateKey()) fail(409, '调岗须在值班日期前发起和同意');
    return {
      items: (await dutyPeople(item.campusId, item.businessDate)).filter(
        (person) => person.memberId !== item.memberId
      )
    };
  }
  async function requestCover(actor, id, input) {
    const { context, item } = await ownAssignment(actor, id);
    if (
      input.toMemberId === item.memberId ||
      !(await dutyPeople(item.campusId, item.businessDate)).some(
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
    if (item.businessDate <= dateKey()) fail(409, '调岗须在值班日期前发起和同意');
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
      const expired =
        row.status === 'pending' &&
        [item, exchangeAssignment].some(
          (assignment) => assignment && assignment.businessDate <= dateKey()
        );
      items.push({
        id: row.id,
        status: expired ? 'expired' : row.status,
        revision: row.revision,
        note: row.note,
        fromName: row.from_name,
        toName: row.to_name,
        assignment: item,
        exchangeAssignment,
        canRespond:
          row.to_member_id === context.actor.memberId && row.status === 'pending' && !expired,
        canCancel:
          row.from_member_id === context.actor.memberId && row.status === 'pending' && !expired
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
      if (original.businessDate <= dateKey()) fail(409, '调岗须在值班日期前发起和同意');
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
        if (other.businessDate <= dateKey()) fail(409, '调岗须在值班日期前发起和同意');
        changes.push({ ...other, memberId: row.from_member_id });
      }
      for (const change of changes) {
        const [person] = await repository.rosterMemberFacts(
          [change.memberId],
          change.businessDate,
          change.businessDate
        );
        if (isDutyExempt(person?.memberships, change.businessDate))
          fail(403, '部长（含副）及以上不参与值班统计，不能接替班次');
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
    coverCandidates,
    requestCover,
    covers,
    respondCover
  };
}
