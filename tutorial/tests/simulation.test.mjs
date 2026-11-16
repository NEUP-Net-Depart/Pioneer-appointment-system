import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/simulation/engine.js';
import { profiles, permissionsFor, prepareWorkflow } from '../src/simulation/fixtures.js';
import { courses, courseAllowed } from '../src/courses.js';
import { journeysFor, tutorialProfiles } from '../src/journeys.js';

test('every lesson has a unique ID, an existing group, targets and actionable steps', () => {
  assert.equal(new Set(courses.map((course) => course.id)).size, courses.length);
  for (const course of courses) {
    assert.ok(course.steps.length >= 2, course.id);
    for (const step of course.steps)
      assert.ok(step.title && step.description && step.target, course.id);
    assert.ok(
      profiles.some((profile) => courseAllowed(course, profile, permissionsFor(profile))),
      course.id
    );
  }
});

test('affairs can receive but cannot start repair or inspect management evidence', async () => {
  const engine = createSimulation('affairs');
  const id = engine.state.orders[0].id;
  const initial = await engine.request(`/api/field/appointments/${id}`);
  assert.equal(initial.canReceive, true);
  assert.equal(initial.canStart, false);
  assert.equal(initial.original, null);
  await engine.request(`/api/appointments/${id}/receive`, 'POST', {
    revision: 1,
    frontPhotoId: 'a',
    backPhotoId: 'b'
  });
  assert.ok(engine.state.orders[0].receivedAt);
  assert.equal(engine.state.orders[0].status, 'booked');
  await assert.rejects(
    engine.request(`/api/appointments/${id}/status`, 'PATCH', {
      status: 'in_progress',
      revision: 2
    }),
    { status: 403 }
  );
});

test('technician repair changes persist within a lesson and new lessons reset state', async () => {
  const engine = createSimulation('repair');
  const id = engine.state.orders[0].id;
  await engine.request(`/api/appointments/${id}/status`, 'PATCH', {
    status: 'in_progress',
    revision: 1,
    frontPhotoId: 'a',
    backPhotoId: 'b'
  });
  assert.equal(engine.state.orders[0].assignedMemberId, 'demo-self');
  await engine.request(`/api/appointments/${id}/status`, 'PATCH', {
    status: 'completed',
    revision: 2,
    outcome: 'repaired',
    repairNote: '完成测试'
  });
  assert.equal(engine.state.orders[0].status, 'completed');
  assert.equal(createSimulation('repair').state.orders[0].status, 'booked');
});

test('failed saves retain original data and retry succeeds; stale revisions are rejected', async () => {
  const engine = createSimulation('head');
  const id = engine.state.orders[0].id;
  engine.state.failNext = true;
  await assert.rejects(
    engine.request(`/api/appointments/${id}/information`, 'PATCH', {
      revision: 1,
      deviceModel: '已校对'
    }),
    { status: 503 }
  );
  assert.equal(engine.state.orders[0].deviceModel, 'ThinkBook 14');
  await engine.request(`/api/appointments/${id}/information`, 'PATCH', {
    revision: 1,
    deviceModel: '已校对'
  });
  assert.equal(engine.state.orders[0].deviceModel, '已校对');
  await assert.rejects(
    engine.request(`/api/appointments/${id}/information`, 'PATCH', {
      revision: 1,
      deviceModel: '旧草稿'
    }),
    { status: 409 }
  );
});

test('leadership scope, exchange participation and retired identity follow current dev', async () => {
  const head = createSimulation('head');
  await assert.rejects(head.request('/api/field/board?campusId=campus-hunnan'), { status: 403 });
  assert.equal(
    (await createSimulation('director').request('/api/field/board?campusId=campus-hunnan'))
      .campusId,
    'campus-hunnan'
  );
  assert.equal(createSimulation('exchange').state.actor.permissions['repair.start'], true);
  const retired = createSimulation('retired');
  assert.equal(retired.state.actor.permissions['attendance.self'], false);
  await assert.rejects(retired.request('/api/attendance/self-check-in', 'POST'), { status: 403 });
  assert.equal(retired.state.actor.permissions['roster.manage'], true);
  assert.equal(retired.state.actor.permissions['roles.manage'], false);
});

test('unimplemented routes fail explicitly instead of pretending to save', async () => {
  await assert.rejects(createSimulation('head').request('/api/not-implemented', 'POST'), {
    code: 'UNHANDLED_DEMO_API'
  });
});

test('three identities have complete workflows and unique knowledge ownership', () => {
  assert.deepEqual(
    tutorialProfiles.map((profile) => profile.name),
    ['部长', '部员', '维修事务']
  );
  const expected = {
    head: ['attendance', 'repairs', 'configuration'],
    repair: ['duty-repair', 'shift-change'],
    affairs: ['attendance', 'reception']
  };
  for (const profile of tutorialProfiles) {
    const journeys = journeysFor(profile);
    assert.deepEqual(
      journeys.map((journey) => journey.id),
      expected[profile.id]
    );
    for (const journey of journeys) {
      for (const step of journey.steps)
        assert.ok(step.title && step.description && step.target && step.phase);
    }
    const topics = journeys.flatMap((journey) =>
      journey.steps.flatMap((step) => step.teaches || [])
    );
    assert.equal(new Set(topics).size, topics.length, `${profile.id}: duplicate knowledge`);
  }
});

test('actual capacity reflects saved templates and campus-specific suspension', async () => {
  const engine = createSimulation('director');
  const slot = engine.state.capacities.find((item) => item.campus === '南湖' && item.weekday === 1);
  await engine.request('/api/slot-capacities', 'PATCH', { items: [{ ...slot, capacity: 8 }] });
  const monday = engine.state.week;
  const read = () => engine.request(`/api/slot-capacities/actual?date=${monday}&campus=南湖`);
  assert.equal((await read()).items[0].capacity, 8);
  await engine.request('/api/service-days', 'PATCH', {
    items: [{ campusId: 'campus-hunnan', businessDate: monday, paused: true, reason: '场地维护' }]
  });
  assert.equal((await read()).paused, false);
  await engine.request('/api/service-days', 'PATCH', {
    items: [{ campusId: 'campus-nanhu', businessDate: monday, paused: true, reason: '场地维护' }]
  });
  assert.equal((await read()).items[0].capacity, 0);
  await engine.request('/api/service-days', 'PATCH', {
    items: [{ campusId: 'campus-nanhu', businessDate: monday, paused: false }]
  });
  assert.equal((await read()).items[0].capacity, 8);
});

test('onsite registration retains its own signed information without copying the previous reception', async () => {
  const engine = createSimulation('affairs');
  const previous = engine.state.orders[0];
  await engine.request(`/api/appointments/${previous.id}/receive`, 'POST', {
    revision: 1,
    frontPhotoId: 'previous-front',
    backPhotoId: 'previous-back'
  });
  const signed = JSON.stringify({ strokes: ['demo-signature'] });
  const created = await engine.request('/api/scan/onsite', 'POST', {
    name: '新机主',
    deviceModel: '新设备',
    issue: '无法启动',
    signature: signed,
    agreement: true
  });
  const order = engine.state.orders.find((item) => item.id === created.id);
  assert.equal(order.frontPhotoId, null);
  assert.equal(order.backPhotoId, null);
  assert.equal(order.receivedAt, null);
  assert.equal(order.receivedBy, null);
  assert.equal(order.assignedMemberId, null);
  assert.equal(order.original.signature, signed);
  assert.equal(order.original.name, '新机主');
  assert.deepEqual(order.repairHistory.events, []);
});

test('attendance examples, workload and reports derive from the same people and orders', async () => {
  const engine = createSimulation('head');
  prepareWorkflow(engine.state, 'attendance');
  const day = await engine.request('/api/attendance/day');
  const lu = day.people.find((item) => item.memberId === 'demo-lu');
  const chen = day.people.find((item) => item.memberId === 'demo-chen');
  assert.equal(lu.workStatus, 'idle');
  assert.equal(lu.activeRepairs, 0);
  assert.equal(chen.workStatus, 'repairing');
  assert.equal(chen.activeRepairs, 2);
  assert.equal(day.people.find((item) => item.memberId === 'demo-wen').record, undefined);
  assert.equal(day.people.find((item) => item.memberId === 'demo-xu').status, 'leave');
  const staffing = await engine.request('/api/attendance/staffing');
  assert.deepEqual(
    staffing.idle.map((item) => item.memberId),
    ['demo-lu']
  );
  assert.ok(!staffing.missing.some((item) => item.memberId === 'demo-xu'));
  const workload = await engine.request('/api/attendance/workload');
  assert.equal(workload.items.find((item) => item.memberId === 'demo-chen').monthly, 2);
  assert.equal(workload.items.find((item) => item.memberId === 'demo-lu').total, 0);
  const history = await engine.request('/api/attendance/matrix');
  assert.equal(history.rows.find((item) => item.memberId === 'demo-wen').actualCount, 0);
  assert.equal(history.rows.find((item) => item.memberId === 'demo-lu').actualCount, 1);
  assert.equal((await engine.request('/api/me/volunteer-summary')).totalHours, 0);
});

test('usual availability is initially unchecked, inherited by a week and overridden independently', async () => {
  const engine = createSimulation('repair');
  assert.deepEqual((await engine.request('/api/me/availability')).usual.windows, []);
  const usual = [{ weekday: 7, campusId: 'campus-nanhu', startAt: '19:00', endAt: '21:00' }];
  await engine.request('/api/me/availability', 'PUT', {
    dutyType: 'repair',
    weekStart: '',
    windows: usual
  });
  const scope = `/api/me/availability?dutyType=repair&weekStart=${engine.state.week}`;
  assert.deepEqual((await engine.request(scope)).effectiveWindows, usual);
  await engine.request('/api/me/availability', 'PUT', {
    dutyType: 'repair',
    weekStart: engine.state.week,
    windows: []
  });
  assert.deepEqual((await engine.request(scope)).effectiveWindows, []);
  assert.deepEqual((await engine.request(scope)).usual.windows, usual);
});

test('accepting a tutorial invitation transfers its actual existing assignment', async () => {
  const engine = createSimulation('repair');
  prepareWorkflow(engine.state, 'shift-change');
  const cover = engine.state.covers[0];
  const assignment = engine.state.assignments.find((item) => item.id === cover.assignmentId);
  assert.equal(assignment.memberId, 'demo-chen');
  await engine.request(`/api/rosters/covers/${cover.id}/response`, 'POST', {
    decision: 'accepted'
  });
  const mine = await engine.request('/api/me/roster');
  assert.equal(mine.items.find((item) => item.id === assignment.id).memberId, 'demo-self');
});

test('overview dates match service days and counts match filtered appointment records', async () => {
  const engine = createSimulation('head');
  const overview = await engine.request('/api/appointments/overview');
  assert.equal(overview.dates.length, 4);
  for (const date of overview.dates)
    assert.ok([1, 2, 3, 4].includes(new Date(`${date}T00:00:00Z`).getUTCDay()));
  const slot = overview.items.find(
    (item) => item.date === engine.state.today && item.timeSlot === engine.state.orders[0].timeSlot
  );
  const list = await engine.request(
    `/api/appointments?date=${slot.date}&timeSlot=${slot.timeSlot}&status=booked`
  );
  assert.equal(slot.booked, list.items.length);
  assert.equal(overview.campuses.length, 1);
});
