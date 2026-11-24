import type { AvailabilityPeriod, DutyType, Membership, PositionCode } from '../shared/staff-types.ts';
type SuggestionInput = Parameters<typeof suggestDuties>[0];
import type { StaffService } from '../src/services/staff-platform.ts';
import { present } from './helpers/present.ts';
import { modelEdges, runModel, rejectWithoutWrite } from './fixtures/workflow-seed.ts';
import { slotCapacityService } from '../src/services/slot-capacities.ts';
import { slotCapacityRepository } from '../src/db/slot-capacities.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { database, seedStaff, seedAppointment } from './helpers/database.ts';
import { userRepository } from '../src/db/users.ts';
import { staffPlatformRepository } from '../src/db/staff-platform.ts';
import { appointmentRepository } from '../src/db/appointments.ts';
import { composeStaffPlatform } from '../src/app/compose.ts';
import { staffPlatformService } from '../src/services/staff-platform.ts';
import { suggestDuties } from '../src/modules/rosters/suggestions.ts';
import { dutyPlacementIssue, mergeDutyDraft } from '../frontend/staff-react/duty-draft.ts';
import { canAssignDuty, dutyAvailability, dutyCandidateTypes, dutyPlanningReview, isDutyExempt } from '../shared/duty.ts';
import { addDays } from '../shared/time.ts';
import { staffPlatformRoutes } from '../src/routes/staff-platform.ts';

const weekStart = '2026-11-09',
  campusId = 'campus-nanhu';
const requestId = () => crypto.randomUUID();
const shift = (memberId: string, businessDate = weekStart) => ({
  memberId,
  businessDate,
  startAt: '19:00',
  endAt: '21:00'
});
function post(departmentCode = 'hardware', positionCode: PositionCode = 'member'): Membership {
  return {
    departmentCode,
    positionCode,
    isPrimary: true,
    assignmentType: 'primary',
    effectiveFrom: '2026-01-01'
  };
}
function addDutyMembership(db: import('./helpers/database.ts').TestDatabase, member: { memberId: string }, type: string) {
  db.sqlite.prepare(`INSERT INTO member_department_memberships
    (id,member_id,department_id,position_code,assignment_type,is_primary,effective_from,created_at)
    VALUES(?,?,?,'member',?,0,'2026-01-01','2026-01-01')`)
    .run(`${member.memberId}-${type}`, member.memberId, type === 'exchange' ? 'dept-hardware' : 'dept-office', type);
}
async function setup(t: import('node:test').TestContext, managed = false) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-09T11:10:00Z') });
  const db = database();
  if (!managed) t.after(() => db.sqlite.close());
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
    head: present(await users.find('20261001')),
    worker: present(await users.find('20261002')),
    office: present(await users.find('20261003'))
  };
}
async function publish(staff: StaffService, head: Parameters<StaffService['campusWeek']>[0], assignments: ReturnType<typeof shift>[], office: ReturnType<typeof shift>[] = []) {
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

test('work staffing scopes read-only idle and missing people without exposing attendance sources', async (t) => {
  const { db, staff, head, worker, office } = await setup(t);
  addDutyMembership(db, office, 'exchange');
  await publish(staff, head, [shift(worker.memberId), shift(office.memberId)]);
  await assert.rejects(staff.workStaffing(office, { campusId }), { status: 403 });
  await assert.rejects(staff.workStaffing(head, { campusId: 'campus-hunnan' }), { status: 403 });
  let result = await staff.workStaffing(head, { campusId });
  assert.equal(present(result.missing).length, 2);
  assert.equal(result.idle.length, 0);
  await staff.correctAttendance(head, { memberId: worker.memberId, campusId, businessDate: weekStart, timeMode: 'duty_start', reason: '核实到岗', requestId: requestId() });
  result = await staff.workStaffing(head, { campusId });
  assert.deepEqual(result.idle, [{ memberId: worker.memberId, name: worker.name }]);
  assert.equal(present((await staff.attendanceDay(head, { campusId, businessDate: weekStart })).items.find(person => person.memberId === worker.memberId)).workStatus, 'idle');
  assert.equal(present(result.missing).length, 1);
  await assert.rejects(staff.workStaffing(worker, { campusId }), { status: 403 });
  seedAppointment(db, { id: 'busy-worker', status: 'in_progress', assigned_to: worker.account });
  assert.equal((await staff.workStaffing(head, { campusId })).idle.length, 0);
  assert.equal(present((await staff.attendanceDay(head, { campusId, businessDate: weekStart })).items.find(person => person.memberId === worker.memberId)).workStatus, 'repairing');
});

test('duty workload is cross-campus but only exposes the visible duty members to authorized viewers', async (t) => {
  const { db, staff, head, worker, office } = await setup(t);
  await publish(staff, head, [shift(worker.memberId)]);
  seedAppointment(db, { id: 'workload-foreign', campus: '浑南', status: 'completed', assigned_to: worker.account, started_at: '2026-11-08T10:00:00Z' });
  seedAppointment(db, { id: 'workload-unlisted', status: 'completed', assigned_to: head.account, started_at: '2026-11-08T10:00:00Z' });
  const query = { campusId, businessDate: weekStart, memberIds: head.memberId };
  const result = await staff.attendanceWorkload(head, query);
  assert.equal(result.month, '2026-11');
  assert.deepEqual(result.items.map((row) => ({ ...row })), [{ memberId: worker.memberId, total: 1, monthly: 1 }]);
  await assert.rejects(staff.attendanceWorkload(worker, { campusId, businessDate: weekStart }), { status: 403 });
  await assert.rejects(staff.attendanceWorkload(office, { campusId, businessDate: weekStart }), { status: 403 });
  await assert.rejects(staff.attendanceWorkload(head, { campusId: 'campus-hunnan', businessDate: weekStart }), { status: 403 });
  await assert.rejects(staff.attendanceWorkload(head, { campusId, businessDate: 'invalid' }), { status: 400 });
  assert.deepEqual((await staff.attendanceWorkload(head, { campusId, businessDate: '2026-10-01' })).items, []);
});

test('only ordinary members participate in duty statistics regardless of secondary leadership', () => {
  const member = post();
  const affairs: Membership = { ...post('office'), assignmentType: 'maintenance_affairs', isPrimary: false };
  assert.deepEqual(dutyCandidateTypes([member, affairs], weekStart), ['repair', 'office']);
  assert.deepEqual(dutyCandidateTypes([post('office')], weekStart), []);
  assert.deepEqual(dutyCandidateTypes([{ ...member, assignmentType: 'exchange', isPrimary: false }], weekStart), []);
  assert.deepEqual(dutyCandidateTypes([{ ...member, effectiveFrom: '2026-12-01' }], weekStart), []);
  // Simulate a persisted appointment missing its position.
  const incomplete = { ...member, positionCode: String('') };
  assert.deepEqual(dutyCandidateTypes([incomplete as Membership], weekStart), []);
  for (const position of ['deputy_head', 'head', 'deputy_director', 'director', 'vice_president', 'president'] as const) {
    const leadership = { ...post('network', position), isPrimary: false };
    assert.equal(isDutyExempt([member, leadership], weekStart), true);
    assert.deepEqual(dutyCandidateTypes([member, leadership, affairs], weekStart), []);
    assert.deepEqual(dutyCandidateTypes([member, { ...leadership, effectiveTo: weekStart }, affairs], weekStart), ['repair', 'office']);
  }
});

test('suggestions balance ordinary members, exclude leaders and occupied members, and preserve ordinary manual assignments', () => {
  const posts: [string, Membership][] = [
    ['a', post('hardware')],
    ['b', post('hardware')],
    ['c', post('office')],
    ['d', post('network')],
    ['e', post('hardware', 'deputy_head')],
    ['f', post('hardware', 'head')],
    ['g', post('station', 'director')]
  ];
  const people: SuggestionInput['people'][number][] = posts.map(([memberId, membership]) => ({
    memberId,
    name: memberId,
    memberships: [
      membership,
      ...(['c', 'd', 'g'].includes(memberId)
        ? [{ ...post('office'), assignmentType: 'maintenance_affairs' as const, isPrimary: false }]
        : [])
    ],
    assignments: []
  }));
  const offeredDays: [string, DutyType, number[]][] = [
    ['a', 'repair', [1, 2]],
    ['b', 'repair', [1]],
    ['c', 'office', [1, 2, 3]],
    ['d', 'office', [3]],
    ['e', 'repair', [1, 2, 3]],
    ['f', 'repair', [1, 2, 3]],
    ['g', 'office', [1, 2, 3]]
  ];
  const availability = offeredDays.map(([memberId, dutyType, days]) => ({
    memberId,
    dutyType,
    weekStart: '',
    revision: 0,
    windows: days.map((weekday: number) => ({ weekday, campusId, startAt: '19:00', endAt: '21:00' }))
  }));
  const input = { weekStart, campusId, people, availability, paused: ['2026-11-12'] };
  const result = suggestDuties(input);
  assert.deepEqual(result, suggestDuties(input));
  assert.equal(result.assignments.length, 4);
  assert.equal(new Set(result.assignments.map((row) => row.memberId)).size, 4);
  assert.deepEqual(result.gaps.filter((row) => row.dutyType === 'repair').map((row) => row.businessDate), [
    '2026-11-11'
  ], 'office coverage must not conceal a missing repair shift');
  assert.equal(result.gaps.filter((row) => row.dutyType === 'office').length, 1);
  assert.equal(present(result.assignments.find((row) => row.memberId === 'b')).businessDate, '2026-11-09');
  assert.equal(present(result.assignments.find((row) => row.memberId === 'a')).businessDate, '2026-11-10');
  assert.ok(
    !result.assignments.some((row) => ['e', 'f', 'g'].includes(row.memberId)),
    'leaders do not participate even when old availability exists'
  );
  people[0].assignments = [{ ...shift('a', '2026-11-10'), campusId: 'campus-hunnan' }];
  const occupied = suggestDuties(input);
  assert.notEqual(present(occupied.assignments.find((row) => row.memberId === 'a')).businessDate, '2026-11-10');
  assert.equal(
    result.assignments.some((row) => row.businessDate === '2026-11-12'),
    false
  );
  const kept = [
    { ...shift('c', '2026-11-11'), id: 'manual', campusId, dutyType: 'office' as const },
    { ...shift('e'), id: 'legacy-leader', campusId, dutyType: 'repair' as const }
  ];
  const regenerated = suggestDuties({ ...input, kept });
  assert.deepEqual(
    regenerated.assignments.find((row) => row.id === 'manual'),
    kept[0]
  );
  assert.equal(regenerated.assignments.filter((row) => row.businessDate === kept[0].businessDate && row.dutyType === 'office').length, 1);
  assert.equal(regenerated.assignments.some((row) => row.id === 'legacy-leader'), false);
});

test('paused shifts do not fulfill the weekly repair requirement and regeneration respects an excluded slot', () => {
  const pausedShift = { ...shift('worker'), id: 'paused', campusId, dutyType: 'repair' as const };
  const person = { memberId: 'worker', name: 'worker', memberships: [post()], assignments: [], availability: { repair: [], office: [] } };
  const input = { weekStart, campusId, people: [person], paused: [weekStart], availability: [], kept: [pausedShift] };
  assert.equal(dutyPlanningReview({ ...input, assignments: [pausedShift] }).unassigned.length, 1);
  const first = suggestDuties(input);
  const proposed = first.assignments.find((row) => row.suggested);
  assert.ok(proposed);
  assert.notEqual(proposed.businessDate, weekStart);
  assert.equal(first.optimization.weeklyOnce, true);
  const second = suggestDuties({ ...input, excluded: [proposed] });
  assert.deepEqual(second.assignments.find((row) => row.id === pausedShift.id), pausedShift);
  assert.equal(second.assignments.filter((row) => row.suggested).length, 1);
  assert.notEqual(present(second.assignments.find((row) => row.suggested)).businessDate, proposed.businessDate);
});

test('publishing around a pause preserves original rows and blocks adjustments to them', async (t) => {
  const { db, staff, repository, head, worker, office } = await setup(t);
  t.mock.timers.setTime(Date.parse('2026-11-08T12:00:00Z'));
  addDutyMembership(db, office, 'exchange');
  const first = await publish(staff, head, [shift(worker.memberId)]);
  const original = first.rosters[0].assignments[0];
  const invite = await staff.requestCover(worker, original.id, {
    toMemberId: office.memberId, revision: original.revision, requestId: requestId()
  });
  db.sqlite.prepare(`INSERT INTO service_day_overrides(business_date,campus_id,paused,reason,revision,updated_at)
    VALUES(?,?,1,'暂停',0,?)`).run(weekStart, campusId, weekStart);
  const openDay = addDays(weekStart, 1);
  const replacement = shift(worker.memberId, openDay);
  await rejectWithoutWrite(db, () => publish(staff, head, [{ ...original, businessDate: openDay }]), { status: 409 });
  await rejectWithoutWrite(db, () => publish(staff, head, [shift(office.memberId)]), { status: 409 });
  assert.equal((await staff.covers(office)).items[0].status, 'paused');
  assert.equal(await repository.pendingCoverInvitations(office.memberId), 0);
  await rejectWithoutWrite(db, () => staff.respondCover(office, invite.id, {
    revision: 0, decision: 'accepted', requestId: requestId()
  }), { status: 409 });
  const suggested = await staff.rosterSuggestions(head, { campusId, weekStart, assignments: [] });
  assert.ok(suggested.assignments.some((row) => row.memberId === worker.memberId && row.suggested && row.businessDate !== weekStart));
  const published = await publish(staff, head, [replacement]);
  assert.deepEqual(published.rosters[0].assignments.find((row) => row.id === original.id), original);
  assert.ok(!present(published.warnings).some((warning) => warning.includes('多次值班') || warning.includes(weekStart)));
  assert.deepEqual((await staff.rosterMine(worker, { weekStart })).items.map((row) => row.businessDate), [openDay]);
});

test('draft refresh merges independent edits and requires a choice for competing moves', () => {
  const original = { ...shift('worker'), id: 'published', dutyType: 'repair' as const };
  const local = { ...original, id: 'local', businessDate: '2026-11-10' };
  const remote = { ...original, id: 'remote', businessDate: '2026-11-11' };
  const unaffected = { ...shift('other'), id: 'unaffected', dutyType: 'repair' as const };
  assert.deepEqual(mergeDutyDraft([original], [local], [original, unaffected]), { rows: [local, unaffected], conflicts: [] });
  assert.deepEqual(mergeDutyDraft([original], [local], [remote, unaffected]), {
    rows: [remote, unaffected],
    conflicts: [{ memberId: original.memberId, local: [local], remote: [remote] }]
  });
  const independent = { ...original, id: 'independent', businessDate: '2026-11-12' };
  assert.deepEqual(mergeDutyDraft([original], [local], [original, independent]), { rows: [independent, local], conflicts: [] });
});

test('unified availability accepts Monday through Thursday and rejects leadership or unrelated members without writes', async (t) => {
  const { db, staff, head, worker, office } = await setup(t);
  const input = {
    weekStart: '', revision: -1,
    windows: [{ weekday: 1, campusId, startAt: '19:00', endAt: '21:00' }],
    requestId: requestId()
  };
  await rejectWithoutWrite(db, () => staff.saveAvailability(head, input), { status: 403 });
  for (const weekday of [5, 6, 7])
    await rejectWithoutWrite(db, () => staff.saveAvailability(worker, {
      ...input, requestId: requestId(), windows: [{ ...input.windows[0], weekday }]
    }), { status: 400 });
  await rejectWithoutWrite(db, () => staff.saveAvailability(office, {
    ...input, dutyType: 'office', requestId: requestId()
  }), { status: 403 });
  const saved = await staff.saveAvailability(worker, input);
  assert.deepEqual(saved.usual.windows, input.windows);
  db.sqlite.prepare("INSERT INTO member_department_memberships(id,member_id,department_id,position_code,assignment_type,is_primary,effective_from,created_at) VALUES('office-affairs',?,'dept-office','member','maintenance_affairs',0,'2026-01-01','2026-01-01')").run(office.memberId);
  const values = [1, 2, 3, 4].map((weekday) => ({ ...input.windows[0], weekday }));
  const officeSaved = await staff.saveAvailability(office, { ...input, dutyType: 'office', windows: values, requestId: requestId() });
  assert.deepEqual(officeSaved.usual.windows, values);
});

test('availability requires a whole weekday and refuses restoring an empty usual record without writes', async (t) => {
  const { db, staff, worker } = await setup(t);
  const input = { weekStart: '', revision: -1, requestId: requestId(), windows: [] };
  for (const values of [[], [{ weekday: 1, campusId, startAt: '19:30', endAt: '20:00' }]])
    await rejectWithoutWrite(db, () => staff.saveAvailability(worker, { ...input, windows: values, requestId: requestId() }), { status: 400 });
  await rejectWithoutWrite(db, () => staff.saveAvailability(worker, {
    ...input, weekStart: addDays(weekStart, 7), useUsual: true
  }), { status: 400 });
  const values = [{ weekday: 4, campusId, startAt: '19:00', endAt: '21:00' }];
  await staff.saveAvailability(worker, { ...input, windows: values });
  await rejectWithoutWrite(db, () => staff.saveAvailability(worker, {
    ...input, revision: 0, requestId: requestId()
  }), { status: 400 });
});

test('QR and direct confirmations remind only eligible members about next week and never prevent attendance', async (t) => {
  const { db, staff, head, worker, office } = await setup(t);
  const nextWeek = addDays(weekStart, 7);
  const leader = await staff.previewAttendance(head, { campusId });
  assert.equal(leader.availabilityReminder.needsAvailability, false);
  await staff.directCheckIn(head, { campusId, requestId: requestId() });
  const event = await staff.createAttendanceEvent(head, { campusId, businessDate: weekStart, requestId: requestId() });
  const credential = await staff.issueAttendanceToken(head, event.id, { revision: event.revision });
  const missing = await staff.previewAttendance(worker, { token: credential.token });
  assert.deepEqual(missing.availabilityReminder, { weekStart: nextWeek, needsAvailability: true });
  assert.equal(missing.memberName, worker.name);
  const checkedIn = await staff.checkIn(worker, { token: credential.token, method: 'qr', requestId: requestId() });
  assert.equal(checkedIn.businessDate, weekStart, 'missing availability never blocks check-in');
  const values = [{ weekday: 1, campusId, startAt: '19:00', endAt: '21:00' }];
  await staff.saveAvailability(worker, { weekStart: '', revision: -1, windows: values, requestId: requestId() });
  assert.equal((await staff.previewAttendance(worker, { token: credential.token })).availabilityReminder.needsAvailability, false);
  db.sqlite.prepare('INSERT INTO member_availability(member_id,duty_type,week_start,windows,revision,updated_at) VALUES(?,?,?,?,?,?)')
    .run(worker.memberId, 'repair', nextWeek, '[]', 0, '2026-11-09');
  assert.equal((await staff.previewAttendance(worker, { token: credential.token })).availabilityReminder.needsAvailability, true);
  assert.equal((await staff.availability(worker, { weekStart: nextWeek })).needsAvailability, true);
  await staff.saveAvailability(worker, { weekStart: nextWeek, revision: 0, windows: values, requestId: requestId() });
  assert.equal((await staff.previewAttendance(worker, { token: credential.token })).availabilityReminder.needsAvailability, false);
  db.sqlite.prepare("INSERT INTO member_department_memberships(id,member_id,department_id,position_code,assignment_type,is_primary,effective_from,created_at) VALUES('affairs-checkin',?,'dept-hardware','member','maintenance_affairs',0,'2026-01-01','2026-01-01')").run(office.memberId);
  assert.equal((await staff.previewAttendance(office, { campusId })).availabilityReminder.needsAvailability, true);
  await staff.directCheckIn(office, { campusId, requestId: requestId() });
});

test('unfilled repair members are assigned with explicit conflicts and remain visible when manually omitted', async (t) => {
  const { db, staff, head, worker, office } = await setup(t);
  addDutyMembership(db, office, 'maintenance_affairs');
  const current = await staff.campusWeek(head, { weekStart, campusId });
  const result = await staff.rosterSuggestions(head, { weekStart, campusId, sourceVersion: current.sourceVersion, assignments: [] });
  const assigned = result.assignments.find((person) => person.memberId === worker.memberId);
  assert.equal(present(assigned).availabilityConflict, true);
  assert.equal(present(assigned).dutyType, 'repair');
  const published = await publish(staff, head, [], [shift(office.memberId)]);
  assert.ok(present(published.warnings).some((message) => message.includes(`${weekStart}尚未安排维修值班`)));
  assert.ok(present(published.warnings).some((message) => message.includes(worker.name) && message.includes('未填写统计表')));
});

test('suggestions explain why a required member cannot be scheduled and leave persisted shifts intact', async (t) => {
  const { db, staff, head, worker } = await setup(t);
  const current = await publish(staff, head, [shift(worker.memberId)]);
  const excluded = [0, 1, 2, 3].map((offset) => ({
    memberId: worker.memberId,
    businessDate: addDays(weekStart, offset),
    dutyType: 'repair'
  }));
  await rejectWithoutWrite(db, () => staff.rosterSuggestions(head, {
    weekStart, campusId, sourceVersion: current.sourceVersion, assignments: [], excluded
  }), { status: 409, message: /本周没有可安排的班次/ });
});

test('leave storage and actions are removed while roster coverage and direct office check-in remain usable', async (t) => {
  const { db, staff, repository, head, worker } = await setup(t);
  const initial = await publish(staff, head, [shift(worker.memberId)]);
  const item = present(initial.rosters.find((row) => row.dutyType === 'repair')).assignments[0];
  assert.equal(present(db.sqlite.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE name='roster_leaves'").get()).n, 0);
  assert.equal(Reflect.get(staff, 'leave'), undefined);
  assert.equal(Reflect.get(staff, 'withdrawLeave'), undefined);
  assert.equal(Reflect.get(repository, 'recordLeave'), undefined);
  assert.equal(Reflect.get(repository, 'withdrawLeave'), undefined);
  for (const suffix of ['leave', 'leave-withdraw'])
    assert.equal(staffPlatformRoutes.some(([method, pattern]) => method === 'POST' && pattern.test(`/api/rosters/assignments/${item.id}/${suffix}`)), false);
  const current = await staff.campusWeek(head, { weekStart, campusId });
  const republished = await publish(staff, head, present(current.rosters.find((row) => row.dutyType === 'repair')).assignments);
  assert.ok(!present(republished.warnings).includes(`${weekStart}尚未安排维修值班`));
  const retained = present(republished.rosters.find((row) => row.dutyType === 'repair')).assignments[0];
  assert.equal(retained.id, item.id);
  assert.equal('leaveStatus' in retained, false);
  const suggestions = await staff.rosterSuggestions(head, { weekStart, campusId, sourceVersion: republished.sourceVersion });
  assert.equal(suggestions.assignments.filter((row) => row.memberId === worker.memberId).length, 1);
  const day = await staff.attendanceDay(head, { campusId, businessDate: weekStart });
  assert.equal(day.summary.expected, 1);
  assert.equal(day.items[0].status, 'upcoming');
  db.sqlite.prepare("UPDATE duty_assignments SET duty_type='office' WHERE id=?").run(item.id);
  const signed = await staff.directCheckIn(worker, { campusId, requestId: requestId() });
  assert.equal(signed.memberId, worker.memberId);
});

test('unified availability reads the latest legacy record, including explicit empty and restored exceptions', () => {
  const usual = [{ weekday: 1, campusId, startAt: '19:00', endAt: '21:00' }];
  const rows: AvailabilityPeriod[] = [
    { dutyType: 'repair', weekStart: '', windows: [], revision: 3, updatedAt: '2026-11-01' },
    { dutyType: 'office', weekStart: '', windows: usual, revision: 0, updatedAt: '2026-11-02' },
    { dutyType: 'repair', weekStart, windows: usual, revision: 0, updatedAt: '2026-11-03' },
    { dutyType: 'office', weekStart, windows: [], revision: 0, updatedAt: '2026-11-04' }
  ];
  assert.deepEqual(dutyAvailability(rows, weekStart).effectiveWindows, []);
  rows[3].windows = null;
  const restored = dutyAvailability(rows, weekStart);
  assert.equal(restored.source, 'usual');
  assert.deepEqual(restored.effectiveWindows, usual);
  assert.equal(restored.exception.revision, 0);
});

test('one availability record serves both duties and dual appointments automatically prefer office', async (t) => {
  const { db, staff, head, worker } = await setup(t);
  db.sqlite.prepare("INSERT INTO member_department_memberships(id,member_id,department_id,position_code,assignment_type,is_primary,effective_from,created_at) VALUES('dual-affairs',?,'dept-office','member','maintenance_affairs',0,'2026-01-01','2026-01-01')").run(worker.memberId);
  const values = [{ weekday: 1, campusId, startAt: '19:00', endAt: '21:00' }];
  db.sqlite.prepare('INSERT INTO member_availability(member_id,duty_type,week_start,windows,revision,updated_at) VALUES(?,?,?,?,?,?)')
    .run(worker.memberId, 'office', '', JSON.stringify(values), 4, '2026-11-01');
  const fromLegacy = await staff.availability(worker, { weekStart });
  assert.equal(fromLegacy.usual.revision, 4);
  const input = { weekStart: '', revision: 4, windows: values, requestId: requestId() };
  await staff.saveAvailability(worker, input);
  await rejectWithoutWrite(db, () => staff.saveAvailability(worker, { ...input, requestId: requestId() }), { status: 409 });
  assert.equal(present(db.sqlite.prepare('SELECT COUNT(*) n FROM member_availability WHERE member_id=?').get(worker.memberId)).n, 1);
  for (const dutyType of ['repair', 'office']) {
    assert.deepEqual((await staff.availability(worker, { weekStart, dutyType })).effectiveWindows, values);
    const roster = await staff.rosterWeek(head, { weekStart, campusId, dutyType });
    assert.ok('people' in roster);
    assert.deepEqual(present(roster.people?.find((person) => person.memberId === worker.memberId)).windows, values);
  }
  const current = await staff.campusWeek(head, { weekStart, campusId });
  const person = current.people.find((row) => row.memberId === worker.memberId);
  assert.deepEqual(present(person).availability.repair, values);
  assert.deepEqual(present(person).availability.office, values);
  const suggestion = await staff.rosterSuggestions(head, { weekStart, campusId, sourceVersion: current.sourceVersion, assignments: [] });
  assert.deepEqual(suggestion.assignments.filter((row) => row.memberId === worker.memberId).map((row) => row.dutyType), ['office']);
});

test('office preference respects occupied days and retained manual duties remain intact', () => {
  const people: SuggestionInput['people'] = [{ memberId: 'dual', name: '双任职', memberships: [post(), { ...post('office'), assignmentType: 'maintenance_affairs', isPrimary: false }], assignments: [] }];
  const availability: SuggestionInput['availability'] = [{ memberId: 'dual', dutyType: 'repair', weekStart: '', revision: 0, windows: [1, 2].map((weekday) => ({ weekday, campusId, startAt: '19:00', endAt: '21:00' })) }];
  const kept = [1, 2].map((weekday) => ({ ...shift(`other-${weekday}`, `2026-11-${weekday === 1 ? '09' : '10'}`), campusId, dutyType: 'office' as const }));
  const input = { weekStart, campusId, people, availability, kept, paused: [] };
  assert.equal(present(suggestDuties(input).assignments.find((row) => row.memberId === 'dual')).dutyType, 'repair');
  const manual = { ...shift('dual'), id: 'manual-dual', campusId, dutyType: 'repair' as const };
  const result = suggestDuties({ ...input, kept: [manual] });
  assert.deepEqual(result.assignments, [manual]);
});

test('publication rejects leadership and suggestions discard legacy leader arrangements without mutating history', async (t) => {
  const { db, staff, head, worker } = await setup(t);
  await rejectWithoutWrite(db, () => publish(staff, head, [shift(head.memberId)]), { status: 400 });
  await rejectWithoutWrite(db, () => staff.saveRosterWeek(head, {
    weekStart, campusId, dutyType: 'repair', revision: -1,
    assignments: [shift(head.memberId)], requestId: requestId()
  }), { status: 400 });
  const current = await publish(staff, head, [shift(worker.memberId)]);
  const legacy = current.rosters[0].assignments[0];
  db.sqlite.prepare('UPDATE duty_assignments SET member_id=? WHERE id=?').run(head.memberId, legacy.id);
  const data = await staff.campusWeek(head, { weekStart, campusId });
  const suggestion = await staff.rosterSuggestions(head, {
    weekStart, campusId, sourceVersion: data.sourceVersion,
    assignments: data.rosters.flatMap((roster) => roster.assignments)
  });
  assert.equal(suggestion.assignments.some((row) => row.memberId === head.memberId), false);
  assert.equal(suggestion.gaps.some((gap) => /负责人/.test(gap.reason)), false);
  assert.equal(present(db.sqlite.prepare('SELECT active FROM duty_assignments WHERE id=?').get(legacy.id)).active, 1);
});

test('duty type eligibility governs placement, publication and retained suggestions on the shift date', async (t) => {
  const { db, staff, head, worker, office } = await setup(t);
  const officeDay = addDays(weekStart, 1);
  const officeShift = shift(office.memberId, officeDay);
  await rejectWithoutWrite(db, () => publish(staff, head, [], [officeShift]), { status: 400 });
  await rejectWithoutWrite(db, () => publish(staff, head, [], [shift(worker.memberId)]), { status: 400 });
  addDutyMembership(db, office, 'maintenance_affairs');
  await rejectWithoutWrite(db, () => staff.saveRosterWeek(head, {
    weekStart, campusId, dutyType: 'repair', revision: -1,
    assignments: [shift(office.memberId)], requestId: requestId()
  }), { status: 400 });
  addDutyMembership(db, office, 'exchange');
  const current = await publish(staff, head, [shift(office.memberId)], [officeShift]);
  const person = current.people.find(({ memberId }) => memberId === office.memberId);
  const exchange = present(present(person).memberships.find(({ assignmentType }) => assignmentType === 'exchange'));
  assert.equal(canAssignDuty([exchange], weekStart, 'repair'), true);
  assert.equal(canAssignDuty([exchange], weekStart, 'office'), false);
  assert.deepEqual(dutyCandidateTypes([exchange], weekStart), []);
  db.sqlite.prepare('UPDATE member_department_memberships SET effective_to=? WHERE id=?').run(officeDay, present(exchange).id);
  const updated = await staff.campusWeek(head, { weekStart, campusId });
  const updatedPerson = updated.people.find(({ memberId }) => memberId === office.memberId);
  assert.equal(dutyPlacementIssue({ data: updated, rows: [], person: updatedPerson, row: {
    ...officeShift, dutyType: 'repair'
  } }), '无维修值班资格');
  db.sqlite.prepare('UPDATE member_department_memberships SET effective_to=? WHERE id=?').run(weekStart, present(exchange).id);
  const suggested = await staff.rosterSuggestions(head, { weekStart, campusId });
  assert.ok(suggested.assignments.some((row) => row.memberId === office.memberId && row.dutyType === 'office'));
  assert.ok(!suggested.assignments.some((row) => row.memberId === office.memberId && row.dutyType === 'repair'));
  assert.equal((await staff.campusWeek(head, { weekStart, campusId })).rosters[0].assignments[0].memberId, office.memberId);
});

test('office cover requires maintenance affairs and rechecks an expiring appointment when accepting', async (t) => {
  const { db, repository, staff, head, worker, office } = await setup(t);
  t.mock.timers.setTime(Date.parse('2026-11-08T12:00:00Z'));
  addDutyMembership(db, office, 'maintenance_affairs');
  const current = await publish(staff, head, [], [shift(office.memberId)]);
  const item = current.rosters[1].assignments[0];
  const requestCover = () => staff.requestCover(office, item.id, {
    revision: item.revision, toMemberId: worker.memberId, requestId: requestId()
  });
  assert.ok(!(await staff.coverCandidates(office, item.id)).items.some(({ memberId }) => memberId === worker.memberId));
  await rejectWithoutWrite(db, requestCover, { status: 400 });
  addDutyMembership(db, worker, 'maintenance_affairs');
  const invitation = await requestCover();
  db.sqlite.exec('DROP TRIGGER organization_authorization_update');
  const original = repository.decideCover;
  const expire = db.sqlite.prepare("UPDATE member_department_memberships SET effective_to=? WHERE member_id=? AND assignment_type='maintenance_affairs'");
  repository.decideCover = async (...args) => {
    expire.run(weekStart, worker.memberId);
    try {
      return await original(...args);
    } finally {
      expire.run(null, worker.memberId);
    }
  };
  const accept = () => staff.respondCover(worker, invitation.id, {
    revision: 0, decision: 'accepted', requestId: requestId()
  });
  await rejectWithoutWrite(db, accept, { status: 409 });
  repository.decideCover = original;
  assert.deepEqual(await accept(), { status: 'accepted' });
});

test('leaders cannot receive cover invitations or accept an invitation issued before their promotion', async (t) => {
  const { db, staff, head, worker, office } = await setup(t);
  addDutyMembership(db, office, 'exchange');
  t.mock.timers.setTime(Date.parse('2026-11-08T12:00:00Z'));
  const current = await publish(staff, head, [shift(worker.memberId)]);
  const item = current.rosters[0].assignments[0];
  const candidates = await staff.coverCandidates(worker, item.id);
  assert.equal(candidates.items.some((person) => person.memberId === head.memberId), false);
  await rejectWithoutWrite(db, () => staff.requestCover(worker, item.id, {
    revision: item.revision, toMemberId: head.memberId, requestId: requestId()
  }), { status: 400 });
  const invite = await staff.requestCover(worker, item.id, {
    revision: item.revision, toMemberId: office.memberId, requestId: requestId()
  });
  db.sqlite.prepare("UPDATE member_department_memberships SET position_code='deputy_head' WHERE member_id=? AND is_primary=1").run(office.memberId);
  await rejectWithoutWrite(db, () => staff.respondCover(office, invite.id, {
    revision: 0, decision: 'accepted', requestId: requestId()
  }), { status: 403 });
});

for (const operation of ['createCover', 'decideCover'] as const) {
  test(`promotion at the ${operation} write boundary rejects the cover without roster, audit or receipt changes`, async (t) => {
    const { db, repository, staff, head, worker, office } = await setup(t);
    addDutyMembership(db, office, 'exchange');
    t.mock.timers.setTime(Date.parse('2026-11-08T12:00:00Z'));
    const current = await publish(staff, head, [shift(worker.memberId)]);
    const item = current.rosters[0].assignments[0];
    const input = { revision: item.revision, toMemberId: office.memberId, requestId: requestId() };
    const invite = operation === 'decideCover' ? await staff.requestCover(worker, item.id, input) : null;
    const promote = () => db.sqlite.prepare("UPDATE member_department_memberships SET position_code='deputy_head' WHERE member_id=? AND is_primary=1").run(office.memberId);
    if (operation === 'createCover') {
      const original = repository.createCover;
      repository.createCover = (...args) => { promote(); return original(...args); };
    } else {
      const original = repository.decideCover;
      repository.decideCover = (...args) => { promote(); return original(...args); };
    }
    const audits = present(db.sqlite.prepare('SELECT COUNT(*) n FROM audit_events').get()).n;
    const receipts = present(db.sqlite.prepare('SELECT COUNT(*) n FROM operation_receipts').get()).n;
    await assert.rejects(
      invite
        ? staff.respondCover(office, invite.id, { revision: 0, decision: 'accepted', requestId: requestId() })
        : staff.requestCover(worker, item.id, input),
      { status: 409 }
    );
    assert.equal(present(db.sqlite.prepare('SELECT COUNT(*) n FROM audit_events').get()).n, audits);
    assert.equal(present(db.sqlite.prepare('SELECT COUNT(*) n FROM operation_receipts').get()).n, receipts);
    assert.deepEqual(await repository.scheduleWeek(weekStart, campusId, 'repair'), current.rosters[0]);
    assert.equal(present(db.sqlite.prepare('SELECT COUNT(*) n FROM roster_covers').get()).n, invite ? 1 : 0);
    if (invite) assert.equal(present((await repository.cover(invite.id))).status, 'pending');
  });
}

test('an out-of-campus member with access is excluded from suggestions, publication and cover', async (t) => {
  const { db, staff, head, worker, office } = await setup(t);
  addDutyMembership(db, office, 'exchange');
  t.mock.timers.setTime(Date.parse('2026-11-08T12:00:00Z'));
  db.sqlite.prepare("UPDATE members SET home_campus_id='campus-hunnan' WHERE id=?").run(office.memberId);
  const current = await staff.campusWeek(head, { weekStart, campusId });
  assert.ok(!current.people.some((person) => person.memberId === office.memberId));
  const suggestions = await staff.rosterSuggestions(head, { weekStart, campusId, assignments: [] });
  assert.ok(!suggestions.assignments.some((row) => row.memberId === office.memberId));
  await assert.rejects(publish(staff, head, [shift(office.memberId)]), { status: 403 });
  const generated = suggestions.assignments.find((row) => row.memberId === worker.memberId);
  assert.equal(present(generated).source, 'auto');
  const published = await publish(staff, head, [present(generated)]);
  const item = published.rosters[0].assignments[0];
  assert.equal(item.source, 'auto');
  assert.ok(!(await staff.coverCandidates(worker, item.id)).items.some((person) => person.memberId === office.memberId));
  await assert.rejects(staff.requestCover(worker, item.id, {
    revision: item.revision, toMemberId: office.memberId, requestId: requestId()
  }), { status: 400 });
});

test('joint publication prepares shared events without attendance, retains IDs and rejects a stale or conflicting pair atomically', async (t) => {
  const { db, staff, head, worker, office } = await setup(t);
  addDutyMembership(db, office, 'maintenance_affairs');
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
  assert.equal(present(db.sqlite.prepare('SELECT COUNT(*) n FROM attendance_events').get()).n, 1);
  assert.equal(present(db.sqlite.prepare('SELECT COUNT(*) n FROM attendance_records').get()).n, 0);
  assert.equal(
    present(db.sqlite
      .prepare("SELECT COUNT(*) n FROM audit_events WHERE action='rosters.campus-week.published'")
      .get()).n,
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
  addDutyMembership(db, office, 'maintenance_affairs');
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
  assert.equal(present(db.sqlite.prepare('SELECT COUNT(*) n FROM duty_assignments').get()).n, 0);
  assert.equal(present(db.sqlite.prepare('SELECT COUNT(*) n FROM attendance_events').get()).n, 0);
  assert.equal(
    present(db.sqlite
      .prepare("SELECT COUNT(*) n FROM audit_events WHERE action='rosters.campus-week.published'")
      .get()).n,
    0
  );
  assert.equal(
    present(db.sqlite
      .prepare(
        "SELECT COUNT(*) n FROM operation_receipts WHERE action='rosters.campus-week.published'"
      )
      .get()).n,
    0
  );
});

test('today includes all unsigned scheduled people without manual review or proxy arrival', async (t) => {
  const { db, staff, head, worker, office } = await setup(t);
  addDutyMembership(db, office, 'maintenance_affairs');
  await publish(staff, head, [shift(worker.memberId)], [shift(office.memberId)]);
  const day = await staff.attendanceDay(head, { campusId, businessDate: weekStart });
  assert.deepEqual(day.summary, { expected: 2, arrived: 0, absent: 0 });
  assert.equal(present(day.items.find((row) => row.memberId === office.memberId)).status, 'upcoming');
  assert.equal(Reflect.get(staff, 'confirmArrival'), undefined);
  assert.equal(Reflect.get(staff, 'reviewAttendance'), undefined);
  assert.ok(day.items.every((row) => !('canReview' in row) && !('canConfirm' in row)));
  assert.equal(present(db.sqlite.prepare('SELECT COUNT(*) n FROM attendance_records').get()).n, 0);
});

test('actual staffing follows current assignments after manager edits and self-service cover', async (t) => {
  const { db, staff, head, worker, office } = await setup(t);
  addDutyMembership(db, office, 'exchange');
  t.mock.timers.setTime(Date.parse('2026-11-08T12:00:00Z'));
  const capacity = slotCapacityRepository(db);
  const counts = async () => (await capacity.actual(weekStart, '南湖', ['repair', 'office'])).staffing;
  await publish(staff, head, [shift(worker.memberId)]);
  assert.deepEqual(await counts(), { repair: 1, office: 0 });
  const current = await publish(staff, head, [shift(office.memberId)]);
  assert.deepEqual(await counts(), { repair: 1, office: 0 });
  const item = present(current.rosters.find(row => row.dutyType === 'repair')).assignments[0];
  const invite = await staff.requestCover(office, item.id, { revision: item.revision, toMemberId: worker.memberId, requestId: requestId() });
  await staff.respondCover(worker, invite.id, { revision: 0, decision: 'accepted', requestId: requestId() });
  assert.deepEqual(await counts(), { repair: 1, office: 0 });
  const day = await staff.attendanceDay(head, { campusId, businessDate: weekStart });
  assert.deepEqual(day.items.map(person => person.memberId), [worker.memberId]);
  assert.equal(day.summary.expected, 1);
  await publish(staff, head, []);
  assert.deepEqual(await counts(), { repair: 0, office: 0 });
});

test('repeated QR check-in yields one attendance fact and one live transition', async (t) => {
  const { db, staff, head, worker } = await setup(t);
  await publish(staff, head, [shift(worker.memberId)]);
  const event = await staff.createAttendanceEvent(head, {
    campusId,
    businessDate: weekStart,
    requestId: requestId()
  });
  await staff.directCheckIn(head, { campusId, requestId: requestId() });
  const credential = await staff.issueAttendanceToken(head, event.id, { revision: event.revision });
  await Promise.all([
    staff.checkIn(worker, { token: credential.token, method: 'qr', requestId: requestId() }),
    staff.checkIn(worker, { token: credential.token, method: 'qr', requestId: requestId() })
  ]);
  assert.equal(present(db.sqlite.prepare('SELECT COUNT(*) n FROM attendance_records WHERE member_id=?').get(worker.memberId)).n, 1);
  assert.equal(present(db.sqlite.prepare('SELECT COUNT(*) n FROM presence_events WHERE member_id=?').get(worker.memberId)).n, 1);
});

test('absence is automatic, ignores preserved legacy review decisions and clears after audited correction', async (t) => {
  await attendanceModel(t);
  const { db, staff, head, worker } = await setup(t);
  const published = await publish(staff, head, [shift(worker.memberId)]),
    item = published.rosters[0].assignments[0];
  db.sqlite.prepare('INSERT INTO attendance_reviews(assignment_id,member_id,decision,revision,reason,reviewed_by,reviewed_at) VALUES(?,?,?,?,?,?,?)')
    .run(item.id, worker.memberId, 'cleared', 2, '历史结论', head.memberId, '2026-11-09');
  assert.equal((await staff.attendanceDay(head, { campusId, businessDate: weekStart })).items[0].status, 'upcoming');
  t.mock.timers.setTime(new Date('2026-11-09T13:10:00Z').getTime());
  assert.equal(
    (await staff.attendanceDay(head, { campusId, businessDate: weekStart })).items[0].status,
    'absent'
  );
  assert.equal(present(db.sqlite.prepare('SELECT COUNT(*) n FROM attendance_records').get()).n, 0);
  assert.equal(present(db.sqlite.prepare('SELECT COUNT(*) n FROM staff_presence').get()).n, 0);
  await staff.correctAttendance(head, {
    memberId: worker.memberId,
    campusId,
    businessDate: weekStart,
    timeMode: 'duty_start',
    reason: '已核实漏签',
    requestId: requestId()
  });
  assert.equal(
    (await staff.attendanceDay(head, { campusId, businessDate: weekStart })).items[0].status,
    'arrived'
  );
  assert.equal(present(db.sqlite.prepare('SELECT revision FROM attendance_reviews').get()).revision, 2);
});

test('scopes and suspensions remain enforced in historical correction', async (t) => {
  const { db, staff, head, worker } = await setup(t);
  await assert.rejects(
    staff.attendanceDay(head, { campusId: 'campus-hunnan', businessDate: weekStart }),
    { status: 403 }
  );
  await publish(staff, head, [shift(worker.memberId)]);
  const correction = await staff.correctAttendance(head, {
    memberId: worker.memberId,
    campusId,
    businessDate: '2026-11-02',
    occurredAt: '2026-11-02T11:00:00Z',
    reason: '已核实漏签',
    requestId: requestId()
  });
  assert.equal(correction.businessDate, '2026-11-02');
  assert.equal(present(db.sqlite.prepare('SELECT COUNT(*) n FROM staff_presence').get()).n, 0);
  db.sqlite
    .prepare(
      "INSERT INTO service_day_overrides(business_date,campus_id,paused,reason,revision,updated_at) VALUES(?, ?,1,'暂停',0,'2026-11-09')"
    )
    .run(weekStart, campusId);
  t.mock.timers.setTime(new Date('2026-11-09T13:10:00Z').getTime());
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
  assert.equal(present(db.sqlite.prepare('SELECT COUNT(*) n FROM staff_presence').get()).n, 0);
  assert.equal(
    present(db.sqlite
      .prepare(
        'SELECT COUNT(*) n FROM attendance_records r JOIN attendance_events e ON e.id=r.event_id WHERE r.member_id=? AND e.business_date=?'
      )
      .get(worker.memberId, weekStart)).n,
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
  assert.equal(JSON.parse(String(present(stored).checkin_source)).timeBasis, 'duty_start');
  assert.equal(present(stored).recorded_at, '2026-11-09T11:10:00.000Z');
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
      String(present(db.sqlite.prepare('SELECT checkin_source FROM attendance_records WHERE id=?').get(record.id))
        .checkin_source)
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
    /补录默认记为当天 19:00，目前尚未到该时间，请在 19:00 后补录/
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
  assert.equal(present(db.sqlite.prepare('SELECT COUNT(*) n FROM staff_presence').get()).n, 0);
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
  assert.equal(present(db.sqlite.prepare('SELECT COUNT(*) n FROM attendance_records').get()).n, 0);
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

test('missing volunteer profiles expose shortcuts only inside current member management scope', async (t) => {
  const { db, staff, head, worker } = await setup(t);
  await staff.correctAttendance(head, {
    memberId: worker.memberId,
    campusId,
    businessDate: '2026-11-02',
    timeMode: 'duty_start',
    reason: '核实漏签',
    requestId: requestId()
  });
  db.sqlite.prepare("UPDATE members SET college='' WHERE id=?").run(worker.memberId);
  const rows = async () => (await staff.volunteerReport(head, { month: '2026-11' })).weeks
    .flatMap((week) => week.campuses.flatMap((campus) => campus.rows))
    .filter((row) => row.memberId === worker.memberId);
  assert.equal((await rows())[0].canManageProfile, true);
  db.sqlite.prepare("UPDATE members SET home_campus_id='campus-hunnan' WHERE id=?").run(worker.memberId);
  assert.equal((await rows())[0].canManageProfile, false);
});

test('office and repair shifts share one attendance fact and unique summary while retaining separate statuses', async (t) => {
  const { db, staff, head, worker, office } = await setup(t);
  addDutyMembership(db, office, 'maintenance_affairs');
  await publish(staff, head, [shift(worker.memberId)], [shift(office.memberId)]);
  db.sqlite.prepare("UPDATE duty_assignments SET member_id=?,start_at='18:30',end_at='19:00' WHERE duty_type='office'").run(worker.memberId);
  const before = await staff.attendanceDay(head, { campusId, businessDate: weekStart });
  assert.equal(before.summary.expected, 1);
  assert.deepEqual(before.items[0].dutyStatuses, { office: 'absent', repair: 'upcoming' });
  await staff.correctAttendance(head, {
    memberId: worker.memberId, campusId, businessDate: weekStart,
    timeMode: 'duty_start', reason: '双班次漏签补记', requestId: requestId()
  });
  const after = await staff.attendanceDay(head, { campusId, businessDate: weekStart });
  assert.equal(after.summary.arrived, 1);
  assert.deepEqual(after.items[0].dutyStatuses, { office: 'arrived', repair: 'arrived' });
});

type AttendanceModel = Awaited<ReturnType<typeof setup>> & { token: string; dispose(): void };

async function attendanceModel(t: import('node:test').TestContext) {
  const correction = (r: AttendanceModel) =>
    r.staff.correctAttendance(r.head, {
      memberId: r.worker.memberId,
      campusId,
      businessDate: weekStart,
      timeMode: 'duty_start',
      reason: '已核实漏签',
      requestId: requestId()
    });
  const pause = async (r: AttendanceModel, paused: boolean) => {
    const item = await r.repository.serviceDay(weekStart, campusId);
    await slotCapacityService(slotCapacityRepository(r.db), r.staff, r.repository).saveServiceDay(r.head, {
      businessDate: weekStart,
      campusId,
      paused,
      reason: '模型验证',
      revision: item?.revision ?? -1,
      requestId: requestId()
    });
  };
  const checkIn = (r: AttendanceModel) =>
    r.staff.checkIn(r.worker, { token: r.token, method: 'qr', requestId: requestId() });
  const edges = modelEdges<AttendanceModel>([
    [
      'upcoming',
      'absent',
      'END_SHIFT',
      () => t.mock.timers.setTime(Date.parse('2026-11-09T13:10:00Z'))
    ],
    ['absent', 'arrived', 'CORRECT', correction],
    ['upcoming', 'arrived', 'CHECK_IN', checkIn],
    [
      'arrived',
      'arrived',
      'REJECT_DUPLICATE_CORRECTION',
      (r) => rejectWithoutWrite(r.db, () => correction(r), { status: 409 })
    ],
    ['upcoming', 'paused', 'PAUSE', (r) => pause(r, true)],
    ['paused', 'upcoming', 'RESUME', (r) => pause(r, false)],
    [
      'paused',
      'paused',
      'REJECT_CORRECTION',
      (r) => rejectWithoutWrite(r.db, () => correction(r), { status: 409 })
    ],
    [
      'upcoming',
      'upcoming',
      'REJECT_MEMBER_CORRECTION',
      (r) =>
        rejectWithoutWrite(
          r.db,
          () =>
            r.staff.correctAttendance(r.worker, {
              memberId: r.worker.memberId,
              campusId,
              businessDate: weekStart,
              timeMode: 'duty_start',
              reason: '越权补记',
              requestId: requestId()
            }),
          { status: 403 }
        )
    ]
  ]);
  await runModel({
    name: 'attendance',
    initial: 'upcoming',
    edges,
    setup: async () => {
      t.mock.timers.reset();
      const r = await setup(t, true);
      await publish(r.staff, r.head, [shift(r.worker.memberId)]);
      const event = await r.staff.createAttendanceEvent(r.head, {
        campusId,
        businessDate: weekStart,
        requestId: requestId()
      });
      await r.staff.directCheckIn(r.head, { campusId, requestId: requestId() });
      const { token } = await r.staff.issueAttendanceToken(r.head, event.id, { revision: event.revision });
      return {
        ...r, token,
        dispose() {
          r.db.sqlite.close();
          t.mock.timers.reset();
        }
      };
    },
    observe: async (r, state: string) => {
      const row = (
        await r.staff.attendanceDay(r.head, { campusId, businessDate: weekStart })
      ).items.find((row) => row.memberId === r.worker.memberId);
      assert.equal(present(row).status, state);
      assert.equal(
        present(r.db.sqlite
          .prepare('SELECT COUNT(*) n FROM attendance_records WHERE member_id=?')
          .get(r.worker.memberId)).n,
        state === 'arrived' ? 1 : 0
      );
    }
  });
}
