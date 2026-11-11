import test from 'node:test';
import assert from 'node:assert/strict';
import { database, seedStaff } from './helpers/database.mjs';
import { userRepository } from '../src/db/users.js';
import { staffPlatformRepository } from '../src/db/staff-platform.js';
import { appointmentRepository } from '../src/db/appointments.js';
import { composeStaffPlatform } from '../src/app/compose.js';
import { staffPlatformService } from '../src/services/staff-platform.js';
import { suggestDuties } from '../src/modules/rosters/suggestions.js';
import { dutyLeader } from '../shared/duty.js';

const weekStart = '2026-11-09',
  campusId = 'campus-nanhu';
const requestId = () => crypto.randomUUID();
const shift = (memberId, businessDate = weekStart) => ({
  memberId,
  businessDate,
  startAt: '19:00',
  endAt: '21:00'
});
function post(departmentCode = 'hardware', positionCode = 'member') {
  return {
    departmentCode,
    positionCode,
    isPrimary: true,
    assignmentType: 'primary',
    effectiveFrom: '2026-01-01'
  };
}
async function setup(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-09T11:10:00Z') });
  const db = database();
  t.after(() => db.sqlite.close());
  for (const id of ['20261001', '20261002', '20261003']) seedStaff(db, id);
  for (const [id, department, position] of [
    ['20261001', 'hardware', 'head'],
    ['20261002', 'hardware', 'member'],
    ['20261003', 'office', 'member']
  ]) {
    db.sqlite
      .prepare(
        "INSERT INTO member_department_memberships(id,member_id,department_id,position_code,assignment_type,is_primary,effective_from,created_at) VALUES(?,?,?,?,'primary',1,'2026-10-01','2026-10-01')"
      )
      .run(`post-${id}`, `member-${id}`, `dept-${department}`, position);
  }
  const repository = staffPlatformRepository(db),
    platform = composeStaffPlatform({ repository, repairs: appointmentRepository(db) });
  const staff = staffPlatformService({ repository, platform, manifests: platform.manifests });
  const users = userRepository(db);
  return {
    db,
    repository,
    staff,
    head: await users.find('20261001'),
    worker: await users.find('20261002'),
    office: await users.find('20261003')
  };
}
async function publish(staff, head, assignments, office = []) {
  const current = await staff.campusWeek(head, { weekStart, campusId });
  return staff.publishCampusWeek(head, {
    weekStart,
    campusId,
    requestId: requestId(),
    sourceVersion: current.sourceVersion,
    rosters: current.rosters.map((row) => ({
      dutyType: row.dutyType,
      revision: row.revision,
      assignments: row.dutyType === 'repair' ? assignments : office
    }))
  });
}

test('suggestions maximize real leader coverage, exclude occupied members and preserve manual assignments', () => {
  const people = [
    ['a', post('hardware', 'head')],
    ['b', post('hardware', 'deputy_head')],
    ['c', post('office', 'head')],
    ['d', post('station', 'director')],
    ['e', post('network', 'head')]
  ].map(([memberId, membership]) => ({
    memberId,
    name: memberId,
    memberships: [
      membership,
      ...(['c', 'd'].includes(memberId)
        ? [{ ...post('office'), assignmentType: 'maintenance_affairs', isPrimary: false }]
        : [])
    ],
    assignments: []
  }));
  const availability = [
    ['a', 'repair', [1, 2]],
    ['b', 'repair', [1]],
    ['c', 'office', [1, 2, 3]],
    ['d', 'office', [3]],
    ['e', 'repair', [1, 2, 3]]
  ].map(([memberId, dutyType, days]) => ({
    memberId,
    dutyType,
    weekStart: '',
    windows: days.map((weekday) => ({ weekday, campusId, startAt: '19:00', endAt: '21:00' }))
  }));
  const input = { weekStart, campusId, people, availability, paused: ['2026-11-12'] };
  const result = suggestDuties(input);
  assert.deepEqual(result, suggestDuties(input));
  assert.equal(result.assignments.length, 4);
  assert.equal(new Set(result.assignments.map((row) => row.memberId)).size, 4);
  assert.equal(result.gaps.length, 0, 'matching moves the flexible leader to Tuesday');
  assert.equal(result.assignments.find((row) => row.memberId === 'b').businessDate, '2026-11-09');
  assert.equal(result.assignments.find((row) => row.memberId === 'a').businessDate, '2026-11-10');
  assert.ok(
    !result.assignments.some((row) => row.memberId === 'e'),
    'network heads are neither repair candidates nor hardware leaders'
  );
  assert.equal(dutyLeader([post('office', 'head')], weekStart), false);
  people[0].assignments = [{ campusId: 'campus-hunnan' }];
  const occupied = suggestDuties(input);
  assert.ok(!occupied.assignments.some((row) => row.memberId === 'a'));
  assert.ok(
    occupied.unassigned.some((row) => row.memberId === 'a' && row.reason.includes('其他校区'))
  );
  assert.equal(
    result.assignments.some((row) => row.businessDate === '2026-11-12'),
    false
  );
  const kept = [{ ...shift('c', '2026-11-11'), id: 'manual', campusId, dutyType: 'office' }];
  const regenerated = suggestDuties({ ...input, kept });
  assert.deepEqual(
    regenerated.assignments.find((row) => row.id === 'manual'),
    kept[0]
  );
  assert.equal(regenerated.assignments.filter((row) => row.memberId === 'c').length, 1);
});

test('joint publication prepares shared events without attendance, retains IDs and rejects a stale or conflicting pair atomically', async (t) => {
  const { db, staff, head, worker, office } = await setup(t);
  const current = await staff.campusWeek(head, { weekStart, campusId });
  const input = {
    weekStart,
    campusId,
    requestId: requestId(),
    sourceVersion: current.sourceVersion,
    rosters: current.rosters.map((row) => ({
      dutyType: row.dutyType,
      revision: -1,
      assignments: [shift(row.dutyType === 'repair' ? worker.memberId : office.memberId)]
    }))
  };
  const first = await staff.publishCampusWeek(head, input);
  await staff.publishCampusWeek(head, input);
  await assert.rejects(
    staff.rosterSuggestions(head, {
      weekStart,
      campusId,
      sourceVersion: current.sourceVersion,
      assignments: []
    }),
    { status: 409 }
  );
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM attendance_events').get().n, 1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM attendance_records').get().n, 0);
  assert.equal(
    db.sqlite
      .prepare("SELECT COUNT(*) n FROM audit_events WHERE action='rosters.campus-week.published'")
      .get().n,
    1
  );
  const before = first.rosters.flatMap((row) => row.assignments).map((row) => row.id);
  const updated = await publish(
    staff,
    head,
    first.rosters[0].assignments,
    first.rosters[1].assignments
  );
  assert.deepEqual(
    updated.rosters.flatMap((row) => row.assignments).map((row) => row.id),
    before
  );
  await assert.rejects(staff.publishCampusWeek(head, { ...input, requestId: requestId() }), {
    status: 409
  });
  await assert.rejects(publish(staff, head, [shift(worker.memberId)], [shift(worker.memberId)]), {
    status: 400
  });
  assert.deepEqual(
    (await staff.campusWeek(head, { weekStart, campusId })).rosters
      .flatMap((row) => row.assignments)
      .map((row) => row.id),
    before
  );
  await assert.rejects(publish(staff, head, [{ ...shift(worker.memberId), startAt: '18:00' }]), {
    status: 400
  });
});

test('personnel changes at the write boundary cancel both publications and their audit and receipt', async (t) => {
  const { db, repository, staff, head, worker, office } = await setup(t);
  const original = repository.saveSchedules;
  repository.saveSchedules = (...args) => {
    db.sqlite
      .prepare("UPDATE members SET status='inactive',revision=revision+1 WHERE id=?")
      .run(worker.memberId);
    return original(...args);
  };
  await assert.rejects(publish(staff, head, [shift(worker.memberId)], [shift(office.memberId)]), {
    status: 409
  });
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM duty_assignments').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM attendance_events').get().n, 0);
  assert.equal(
    db.sqlite
      .prepare("SELECT COUNT(*) n FROM audit_events WHERE action='rosters.campus-week.published'")
      .get().n,
    0
  );
  assert.equal(
    db.sqlite
      .prepare(
        "SELECT COUNT(*) n FROM operation_receipts WHERE action='rosters.campus-week.published'"
      )
      .get().n,
    0
  );
});

test('today includes unsigned people and leave, arrival is idempotent and attributes the live confirmation to the minister', async (t) => {
  const { db, staff, head, worker, office } = await setup(t);
  const published = await publish(staff, head, [shift(worker.memberId)], [shift(office.memberId)]);
  const repair = published.rosters[0].assignments[0],
    officeShift = published.rosters[1].assignments[0];
  await staff.leave(office, officeShift.id, {
    revision: 0,
    reason: '有课',
    requestId: requestId()
  });
  const day = await staff.attendanceDay(head, { campusId, businessDate: weekStart });
  assert.deepEqual(day.summary, { expected: 1, arrived: 0, pending: 1, absent: 0 });
  assert.equal(day.items.find((row) => row.memberId === office.memberId).status, 'leave');
  const input = { assignmentId: repair.id, assignmentRevision: 0, requestId: requestId() };
  const results = await Promise.all([
    staff.confirmArrival(head, input),
    staff.confirmArrival(head, input)
  ]);
  assert.ok(results.every((row) => row.saved));
  const record = db.sqlite.prepare('SELECT * FROM attendance_records').get();
  assert.equal(record.member_id, worker.memberId);
  assert.equal(record.occurred_at, '2026-11-09T11:10:00.000Z');
  assert.equal(
    db.sqlite.prepare('SELECT actor_member_id FROM presence_events').get().actor_member_id,
    head.memberId
  );
  assert.equal(
    db.sqlite
      .prepare(
        "SELECT actor_member_id FROM audit_events WHERE action='attendance.arrival.confirmed'"
      )
      .get().actor_member_id,
    head.memberId
  );
  await staff.confirmArrival(head, input);
  await staff.confirmArrival(head, { ...input, requestId: requestId() });
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM attendance_records').get().n, 1);
  const arrived = await staff.attendanceDay(head, { campusId, businessDate: weekStart });
  assert.equal(arrived.summary.arrived, 1);
  assert.deepEqual(
    arrived.items.find((row) => row.memberId === worker.memberId).record.checkinSource,
    {
      kind: 'correction',
      operatorMemberId: head.memberId,
      operatorAccount: head.account
    }
  );
});

test('QR and minister confirmation race to one attendance fact and one live transition', async (t) => {
  const { db, staff, head, worker } = await setup(t);
  const published = await publish(staff, head, [shift(worker.memberId)]);
  const event = await staff.createAttendanceEvent(head, {
    campusId,
    businessDate: weekStart,
    requestId: requestId()
  });
  const credential = await staff.issueAttendanceToken(head, event.id, { revision: event.revision });
  await Promise.all([
    staff.checkIn(worker, { token: credential.token, method: 'qr', requestId: requestId() }),
    staff.confirmArrival(head, {
      assignmentId: published.rosters[0].assignments[0].id,
      assignmentRevision: 0,
      requestId: requestId()
    })
  ]);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM attendance_records').get().n, 1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM presence_events').get().n, 1);
});

test('absence conclusions preserve revisions, never invent attendance and give precedence to a subsequent arrival', async (t) => {
  const { db, staff, head, worker } = await setup(t);
  const published = await publish(staff, head, [shift(worker.memberId)]),
    item = published.rosters[0].assignments[0];
  const input = {
    assignmentId: item.id,
    assignmentRevision: 0,
    revision: -1,
    decision: 'absent',
    requestId: requestId()
  };
  await assert.rejects(staff.reviewAttendance(head, input), { status: 409 });
  t.mock.timers.setTime(new Date('2026-11-09T13:10:00Z').getTime());
  await staff.reviewAttendance(head, input);
  await staff.reviewAttendance(head, input);
  assert.equal(
    (await staff.attendanceDay(head, { campusId, businessDate: weekStart })).items[0].status,
    'absent'
  );
  await staff.reviewAttendance(head, {
    ...input,
    decision: 'cleared',
    revision: 0,
    requestId: requestId()
  });
  await assert.rejects(staff.reviewAttendance(head, { ...input, requestId: requestId() }), {
    status: 409
  });
  await staff.reviewAttendance(head, { ...input, revision: 1, requestId: requestId() });
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM attendance_records').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM staff_presence').get().n, 0);
  await staff.confirmArrival(head, {
    assignmentId: item.id,
    assignmentRevision: 0,
    requestId: requestId()
  });
  assert.equal(
    (await staff.attendanceDay(head, { campusId, businessDate: weekStart })).items[0].status,
    'arrived'
  );
  assert.equal(db.sqlite.prepare('SELECT revision FROM attendance_reviews').get().revision, 2);
});

test('scopes, suspensions and target changes remain enforced in arrival, review and historical correction', async (t) => {
  const { db, repository, staff, head, worker } = await setup(t);
  await assert.rejects(
    staff.attendanceDay(head, { campusId: 'campus-hunnan', businessDate: weekStart }),
    { status: 403 }
  );
  const published = await publish(staff, head, [shift(worker.memberId)]),
    item = published.rosters[0].assignments[0];
  const original = repository.confirmDuty;
  repository.confirmDuty = (...args) => {
    db.sqlite
      .prepare(
        "UPDATE staff_accounts SET status='disabled',auth_version=auth_version+1 WHERE member_id=?"
      )
      .run(worker.memberId);
    return original(...args);
  };
  await assert.rejects(
    staff.confirmArrival(head, {
      assignmentId: item.id,
      assignmentRevision: 0,
      requestId: requestId()
    }),
    { status: 409 }
  );
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM staff_presence').get().n, 0);
  db.sqlite
    .prepare(
      "UPDATE staff_accounts SET status='enabled',auth_version=auth_version+1 WHERE member_id=?"
    )
    .run(worker.memberId);
  const correction = await staff.correctAttendance(head, {
    memberId: worker.memberId,
    campusId,
    businessDate: '2026-11-02',
    occurredAt: '2026-11-02T11:00:00Z',
    reason: '已核实漏签',
    requestId: requestId()
  });
  assert.equal(correction.businessDate, '2026-11-02');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM staff_presence').get().n, 0);
  db.sqlite
    .prepare(
      "INSERT INTO service_day_overrides(business_date,campus_id,paused,reason,revision,updated_at) VALUES(?, ?,1,'暂停',0,'2026-11-09')"
    )
    .run(weekStart, campusId);
  t.mock.timers.setTime(new Date('2026-11-09T13:10:00Z').getTime());
  await assert.rejects(
    staff.reviewAttendance(head, {
      assignmentId: item.id,
      assignmentRevision: 0,
      revision: -1,
      decision: 'absent',
      requestId: requestId()
    }),
    { status: 409 }
  );
  await assert.rejects(publish(staff, head, [shift(worker.memberId), shift(head.memberId)]), {
    status: 409
  });
  await assert.rejects(
    staff.correctAttendance(head, {
      memberId: worker.memberId,
      campusId,
      businessDate: weekStart,
      occurredAt: '2026-11-09T11:00:00Z',
      reason: '漏签',
      requestId: requestId()
    }),
    { status: 409 }
  );
  db.sqlite.exec('DELETE FROM service_day_overrides');
  repository.confirmDuty = original;
  const find = repository.assignmentById;
  repository.assignmentById = async (id) => {
    const previous = await find(id);
    db.sqlite
      .prepare('UPDATE duty_assignments SET member_id=?,revision=revision+1 WHERE id=?')
      .run(head.memberId, id);
    return previous;
  };
  await assert.rejects(
    staff.confirmArrival(head, {
      assignmentId: item.id,
      assignmentRevision: 0,
      requestId: requestId()
    }),
    { status: 409 }
  );
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM staff_presence').get().n, 0);
  assert.equal(
    db.sqlite
      .prepare(
        'SELECT COUNT(*) n FROM attendance_records r JOIN attendance_events e ON e.id=r.event_id WHERE r.member_id=? AND e.business_date=?'
      )
      .get(worker.memberId, weekStart).n,
    0
  );
});

test('default duty correction resolves shift time in the selected campus and preserves correction safeguards', async (t) => {
  const { db, repository, staff, head, worker, office } = await setup(t);
  await publish(staff, head, [shift(worker.memberId)]);
  db.sqlite.exec("UPDATE duty_assignments SET start_at='19:05',revision=revision+1 WHERE active=1");
  const input = {
    memberId: worker.memberId,
    campusId,
    businessDate: weekStart,
    timeMode: 'duty_start',
    reason: '已核实漏签',
    requestId: requestId()
  };
  const record = await staff.correctAttendance(head, input);
  assert.equal(record.occurredAt, `${weekStart}T11:05:00.000Z`);
  assert.equal(record.businessDate, weekStart);
  assert.equal(record.nonScheduled, false);
  const stored = db.sqlite.prepare('SELECT * FROM attendance_records WHERE id=?').get(record.id);
  assert.equal(JSON.parse(stored.checkin_source).timeBasis, 'duty_start');
  assert.equal(stored.recorded_at, '2026-11-09T11:10:00.000Z');
  assert.equal((await staff.correctAttendance(head, input)).idempotent, true);
  await assert.rejects(staff.correctAttendance(head, { ...input, requestId: requestId() }), {
    status: 409
  });
  const corrected = await staff.correctAttendance(head, {
    memberId: worker.memberId,
    recordId: record.id,
    eventId: record.eventId,
    revision: record.revision,
    occurredAt: `${weekStart}T11:06:00Z`,
    reason: '确认实际时间',
    requestId: requestId()
  });
  assert.equal(corrected.occurredAt, `${weekStart}T11:06:00.000Z`);
  await assert.rejects(
    staff.correctAttendance(head, {
      memberId: worker.memberId,
      recordId: record.id,
      eventId: record.eventId,
      revision: corrected.revision,
      occurredAt: '2026-11-04T11:06:00Z',
      reason: '不允许跨日修正',
      requestId: requestId()
    }),
    /只能修正所选值班日期/
  );
  assert.equal(
    JSON.parse(
      db.sqlite.prepare('SELECT checkin_source FROM attendance_records WHERE id=?').get(record.id)
        .checkin_source
    ).timeBasis,
    undefined
  );
  for (const extra of [
    { occurredAt: `${weekStart}T11:00:00Z` },
    { recordId: record.id },
    { eventId: record.eventId },
    { timeMode: 'unknown' }
  ])
    await assert.rejects(
      staff.correctAttendance(head, { ...input, ...extra, requestId: requestId() }),
      { status: 400 }
    );
  const temporary = await staff.correctAttendance(head, {
    ...input,
    memberId: office.memberId,
    businessDate: '2026-11-04',
    requestId: requestId()
  });
  assert.equal(temporary.occurredAt, '2026-11-04T11:00:00.000Z');
  assert.equal(temporary.nonScheduled, true);
  await assert.rejects(
    staff.correctAttendance(head, { ...input, campusId: 'campus-hunnan', requestId: requestId() }),
    { status: 403 }
  );
  await assert.rejects(
    staff.correctAttendance(head, { ...input, businessDate: '2026-11-10', requestId: requestId() }),
    { status: 400 }
  );
  t.mock.timers.setTime(new Date('2026-11-09T10:59:00Z').getTime());
  await assert.rejects(
    staff.correctAttendance(head, { ...input, memberId: head.memberId, requestId: requestId() }),
    /尚未开始/
  );
  t.mock.timers.setTime(new Date('2026-11-09T11:10:00Z').getTime());
  db.sqlite.exec(
    "INSERT INTO service_day_overrides(business_date,campus_id,paused,reason,revision,updated_at) VALUES('2026-11-03','campus-nanhu',1,'暂停',0,'2026-11-09')"
  );
  await assert.rejects(
    staff.correctAttendance(head, { ...input, businessDate: '2026-11-03', requestId: requestId() }),
    { status: 409 }
  );
  db.sqlite
    .prepare("UPDATE staff_accounts SET status='disabled' WHERE member_id=?")
    .run(office.memberId);
  await assert.rejects(
    staff.correctAttendance(head, {
      ...input,
      memberId: office.memberId,
      businessDate: '2026-11-02',
      requestId: requestId()
    }),
    { status: 409 }
  );
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM staff_presence').get().n, 0);
  assert.ok(await repository.attendanceById(record.id));
});

test('default correction rejects a shift change after its snapshot', async (t) => {
  const { db, repository, staff, head, worker } = await setup(t);
  await publish(staff, head, [shift(worker.memberId)]);
  const fingerprint = repository.attendanceCorrectionFingerprint;
  let calls = 0;
  repository.attendanceCorrectionFingerprint = async (...args) => {
    const result = await fingerprint(...args);
    if (++calls === 1)
      db.sqlite.exec("UPDATE duty_assignments SET start_at='19:05',revision=revision+1");
    return result;
  };
  await assert.rejects(
    staff.correctAttendance(head, {
      memberId: worker.memberId,
      campusId,
      businessDate: weekStart,
      timeMode: 'duty_start',
      reason: '漏签',
      requestId: requestId()
    }),
    { status: 409 }
  );
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM attendance_records').get().n, 0);
});

test('personal volunteer hours match the shared report calculation and do not expose another member', async (t) => {
  const { db, staff, head, worker, office } = await setup(t);
  for (const [memberId, day] of [
    [worker.memberId, '2026-11-02'],
    [worker.memberId, '2026-11-03'],
    [office.memberId, '2026-11-02']
  ])
    await staff.correctAttendance(head, {
      memberId,
      campusId,
      businessDate: day,
      occurredAt: `${day}T11:00:00Z`,
      reason: '核实漏签',
      requestId: requestId()
    });
  const summary = await staff.volunteerSummary(worker),
    report = await staff.volunteerReport(head, { month: '2026-11' });
  const expected = report.weeks
    .flatMap((week) => week.campuses.flatMap((campus) => campus.rows))
    .filter((row) => row.memberId === worker.memberId)
    .reduce((sum, row) => sum + row.hours, 0);
  assert.equal(expected, 4, 'multiple arrivals in the same week count once');
  assert.equal(summary.monthHours, expected);
  assert.equal(summary.totalHours, expected);
  db.sqlite
    .prepare(
      "UPDATE member_department_memberships SET department_id='dept-network',revision=revision+1 WHERE member_id=?"
    )
    .run(worker.memberId);
  assert.equal(
    (await staff.volunteerSummary(worker)).totalHours,
    expected,
    'own history remains readable after a department change'
  );
  db.sqlite.exec('UPDATE attendance_report_settings SET merge_leaders=1');
  const leaderSummary = await staff.volunteerSummary(head),
    leaderReport = await staff.volunteerReport(head, { month: '2026-11' });
  const leaderExpected = leaderReport.weeks
    .flatMap((week) => week.campuses.flatMap((campus) => campus.rows))
    .filter((row) => row.memberId === head.memberId)
    .reduce((sum, row) => sum + row.hours, 0);
  assert.equal(leaderSummary.monthHours, leaderExpected);
  assert.ok(leaderSummary.totalHours > leaderSummary.monthHours);
});
