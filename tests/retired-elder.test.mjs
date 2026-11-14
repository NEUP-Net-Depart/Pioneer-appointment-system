import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, seedStaff } from './helpers/database.mjs';
import { staffServices } from './fixtures/staff-services.mjs';
import { staffPlatformRepository } from '../src/db/staff-platform.js';
import { userRepository } from '../src/db/users.js';
import { signToken } from '../src/lib/jwt.js';
import { handleRequest } from '../src/app.js';

const day = '2026-11-09',
  weekStart = day;
const campuses = ['campus-nanhu', 'campus-hunnan'];
const elderId = 'member-20261002';
const shift = (memberId) => ({ memberId, businessDate: day, startAt: '19:00', endAt: '21:00' });

async function setup(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${day}T11:10:00Z`) });
  const db = database();
  t.after(() => db.sqlite.close());
  db.sqlite.exec(
    "INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at,protected) VALUES('root001','系统管理员','superadmin','南湖','test','2026-01-01',1); INSERT INTO staff_campus_grants VALUES('root001','南湖'),('root001','浑南');"
  );
  for (const [id, campus] of [
    ['20261001', '南湖'],
    ['20261002', '南湖'],
    ['20261003', '南湖'],
    ['20261004', '浑南'],
    ['20261005', '南湖']
  ])
    seedStaff(db, id, campus);
  db.sqlite
    .exec(`INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,position_code,effective_from,effective_to,created_at) VALUES
    ('head','member-20261001','dept-office','primary',1,'head','2026-01-01',NULL,'2026-01-01'),
    ('former-director','${elderId}','unit-device','primary',1,'director','2026-10-01','2026-11-03','2026-10-01'),
    ('worker','member-20261003','dept-hardware','primary',1,'member','2026-01-01',NULL,'2026-01-01'),
    ('other-worker','member-20261004','dept-hardware','primary',1,'member','2026-01-01',NULL,'2026-01-01'),
    ('director','member-20261005','unit-device','primary',1,'director','2026-01-01',NULL,'2026-01-01');`);
  const users = userRepository(db),
    repository = staffPlatformRepository(db),
    staff = staffServices(db, '00'.repeat(32));
  const root = await users.find('root001'),
    elder = await users.find('20261002');
  const change = async (enabled) =>
    staff.setRetiredElder(root, elderId, {
      enabled,
      revision: (await repository.memberRow(elderId)).revision,
      requestId: crypto.randomUUID()
    });
  const env = {
    DB: { withSession: () => db },
    ATTACHMENTS: {},
    JWT_SECRET: 'retired-elder-test-secret'.repeat(2),
    PII_ENCRYPTION_KEY: '00'.repeat(32)
  };
  async function api(account, path, body, method = body ? 'PUT' : 'GET', savedToken) {
    const token = savedToken ?? signToken(await users.find(account), env.JWT_SECRET);
    const response = await handleRequest(
      new Request(`https://app.test/api/${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
      }),
      env
    );
    return { status: response.status, body: await response.json() };
  }
  const publish = async (campusId, assignments = [], office = []) => {
    const current = await staff.campusWeek(root, { campusId, weekStart });
    return staff.publishCampusWeek(root, {
      campusId,
      weekStart,
      sourceVersion: current.sourceVersion,
      requestId: crypto.randomUUID(),
      rosters: current.rosters.map((row) => ({
        dutyType: row.dutyType,
        revision: row.revision,
        assignments: row.dutyType === 'repair' ? assignments : office
      }))
    });
  };
  return { db, repository, users, staff, root, elder, change, api, publish, env };
}

test('only the current superadmin can grant or revoke; audits and session revocation commit together', async (t) => {
  const { db, users, repository, staff, root, elder, api, env } = await setup(t);
  const path = `members/${elderId}/retired-elder`;
  const input = { enabled: true, revision: 0, requestId: crypto.randomUUID() };
  assert.deepEqual((await staff.contextFor(elder)).specialIdentities, []);
  assert.equal(
    (await staff.contextFor(elder)).permissions['members.manage'],
    false,
    'past leadership does not grant this identity'
  );
  for (const account of ['20261002', '20261005']) {
    assert.equal((await api(account, path, input)).status, 403);
  }
  await assert.rejects(staff.setRetiredElder({ ...elder, role: 'superadmin' }, elderId, input), {
    status: 403
  });
  assert.equal((await api('root001', path, { ...input, enabled: 'true' })).status, 400);
  await staff.updateMember(await users.find('20261001'), elderId, {
    revision: 0,
    specialIdentities: ['retired_elder']
  });
  await assert.rejects(staff.ownProfile(elder, { revision: 0, retiredElder: true }), {
    status: 400
  });
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM member_special_identities').get().n, 0);
  const oldToken = signToken(elder, env.JWT_SECRET);
  assert.equal((await api('root001', path, input)).status, 200);
  assert.equal((await api('20261002', 'auth/me', null, 'GET', oldToken)).status, 401);
  const granted = await users.find('20261002');
  assert.deepEqual(granted.authorizedCampuses.slice().sort(), ['南湖', '浑南']);
  assert.equal((await api('20261005', path, { enabled: false, revision: 1 })).status, 403);
  const activeToken = signToken(granted, env.JWT_SECRET);
  assert.equal((await api('root001', path, { enabled: false, revision: 0 })).status, 409);
  assert.equal((await api('root001', path, { enabled: false, revision: 1 })).status, 200);
  assert.equal((await api('20261002', 'auth/me', null, 'GET', activeToken)).status, 401);
  assert.deepEqual((await users.find('20261002')).authorizedCampuses, ['南湖']);
  assert.equal(
    (await staff.contextFor(granted)).permissions['members.manage'],
    false,
    'even a cached actor loses its business permission'
  );
  const audits = (await repository.memberAudit(elderId)).filter((item) =>
    item.action.startsWith('identity.retired_elder.')
  );
  assert.deepEqual(audits.map((item) => item.action).sort(), [
    'identity.retired_elder.granted',
    'identity.retired_elder.revoked'
  ]);
  assert.ok(audits.every((item) => item.actorAccount === 'root001'));
  const revision = (await repository.memberRow(elderId)).revision;
  const beforeFailure = await users.find('20261002');
  db.sqlite.exec(
    "CREATE TRIGGER reject_identity_audit BEFORE INSERT ON audit_events WHEN NEW.action='identity.retired_elder.granted' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;"
  );
  await assert.rejects(
    staff.setRetiredElder(root, elderId, { enabled: true, revision }),
    /audit unavailable/
  );
  assert.equal((await repository.memberRow(elderId)).revision, revision);
  assert.deepEqual((await staff.contextFor(granted)).specialIdentities, []);
  const afterFailure = await users.find('20261002');
  assert.equal(afterFailure.authVersion, beforeFailure.authVersion);
  assert.equal(afterFailure.tokenVersion, beforeFailure.tokenVersion);
});

test('retired elders manage real personnel, accounts, booking, rosters and attendance in both campuses', async (t) => {
  const { staff, users, change, api } = await setup(t);
  await change(true);
  const elder = await users.find('20261002');
  const context = await staff.contextFor(elder);
  const accounts = (await api('20261002', 'users')).body.items;
  assert.ok(
    accounts
      .find((item) => item.memberId === elderId)
      .identities.some((item) => item.code === 'retired_elder')
  );
  for (const [account, campusId, campus] of [
    ['20261003', campuses[0], '南湖'],
    ['20261004', campuses[1], '浑南']
  ]) {
    for (const code of [
      'statistics.read',
      'repair.correct',
      'attendance.session.manage',
      'attendance.export'
    ]) {
      assert.equal(
        staff.evaluate(context, code, { campusId }).allowed,
        true,
        `${code}: ${campusId}`
      );
    }
    const memberId = `member-${account}`;
    const detail = await api('20261002', `members/${memberId}`);
    assert.equal(detail.status, 200);
    assert.equal(
      (
        await api(
          '20261002',
          `members/${memberId}`,
          { revision: detail.body.member.revision, college: '软件学院' },
          'PATCH'
        )
      ).status,
      200
    );
    assert.equal(
      (await api('20261002', `users/${account}`, { name: `管理测试${campus}` }, 'PATCH')).status,
      200
    );
    assert.equal(
      (
        await api(
          '20261002',
          'booking-settings',
          { campus, revision: 0, releaseTime: '10:00', requestId: crypto.randomUUID() },
          'PATCH'
        )
      ).status,
      200
    );
    const roster = await staff.rosterWeek(elder, { campusId, weekStart, dutyType: 'repair' });
    await staff.saveRosterWeek(elder, {
      campusId,
      weekStart,
      dutyType: 'repair',
      revision: roster.revision,
      assignments: [shift(memberId)],
      requestId: crypto.randomUUID()
    });
    await staff.correctAttendance(elder, {
      memberId,
      campusId,
      businessDate: day,
      timeMode: 'duty_start',
      reason: '核实到岗后补记',
      requestId: crypto.randomUUID()
    });
    assert.equal(
      (await staff.attendanceDay(elder, { campusId, businessDate: day })).items.find(
        (item) => item.memberId === memberId
      ).status,
      'arrived'
    );
  }
  for (const path of ['roles', 'audit'])
    assert.equal((await api('20261002', path)).status, 403, path);
  assert.equal(
    (
      await api('20261002', 'attendance/report-settings', {
        countMode: 'actual',
        hoursPerCount: 3,
        mergeLeaders: true,
        revision: 0
      })
    ).status,
    403
  );
  assert.equal(
    (await api('20261002', 'users/root001', { status: 'disabled' }, 'PATCH')).status,
    403
  );
  assert.equal(
    (await api('20261002', 'users/20261002', { role: 'superadmin' }, 'PATCH')).status,
    403
  );
});

test('retired elders cannot fill availability, join either duty, accept cover, check in or receive attendance corrections', async (t) => {
  const { db, repository, staff, users, root, elder, change, publish } = await setup(t);
  const worker = await users.find('20261003');
  const roster = await publish(campuses[0], [shift(worker.memberId)]);
  const assignment = roster.rosters.find((row) => row.dutyType === 'repair').assignments[0];
  const invitation = await staff.requestCover(worker, assignment.id, {
    toMemberId: elderId,
    revision: assignment.revision,
    requestId: crypto.randomUUID()
  });
  await change(true);
  const campusId = campuses[0];
  assert.ok(
    !(await staff.campusWeek(root, { campusId, weekStart })).people.some(
      (person) => person.memberId === elderId
    )
  );
  for (const dutyType of ['repair', 'office']) {
    await assert.rejects(
      staff.saveAvailability(elder, {
        dutyType,
        revision: -1,
        windows: [{ weekday: 1, campusId, startAt: '19:00', endAt: '21:00' }],
        requestId: crypto.randomUUID()
      }),
      { status: 403 }
    );
    const week = await staff.rosterWeek(root, { campusId, weekStart, dutyType });
    await assert.rejects(
      staff.saveRosterWeek(root, {
        campusId,
        weekStart,
        dutyType,
        revision: week.revision,
        assignments: [shift(elderId)],
        requestId: crypto.randomUUID()
      }),
      { status: 403 }
    );
  }
  await assert.rejects(publish(campusId, [shift(elderId)]), { status: 403 });
  await assert.rejects(
    staff.directCheckIn(await users.find('20261002'), {
      campusId,
      requestId: crypto.randomUUID()
    }),
    { status: 403 }
  );
  await assert.rejects(
    staff.correctAttendance(root, {
      memberId: elderId,
      campusId,
      businessDate: day,
      timeMode: 'duty_start',
      reason: '不能代签到',
      requestId: crypto.randomUUID()
    }),
    { status: 409 }
  );
  await assert.rejects(
    staff.requestCover(worker, assignment.id, {
      toMemberId: elderId,
      revision: assignment.revision,
      requestId: crypto.randomUUID()
    }),
    { status: 400 }
  );
  await assert.rejects(
    staff.respondCover(await users.find('20261002'), invitation.id, {
      decision: 'accepted',
      revision: 0,
      requestId: crypto.randomUUID()
    }),
    { status: 409 }
  );
  await staff.directCheckIn(root, { campusId: campuses[0], requestId: crypto.randomUUID() });
  const event = await repository.dutyEvent(day, campuses[0]);
  const token = await staff.issueAttendanceToken(root, event.id);
  await assert.rejects(
    staff.checkIn(await users.find('20261002'), {
      token: token.token,
      requestId: crypto.randomUUID()
    }),
    { status: 403 }
  );
  await assert.rejects(
    staff.correctAttendance(root, {
      memberId: elderId,
      eventId: event.id,
      occurredAt: `${day}T11:00:00Z`,
      reason: '不能通过场次补签到'
    }),
    { status: 409 }
  );
  assert.equal(
    db.sqlite.prepare('SELECT COUNT(*) n FROM attendance_records WHERE member_id=?').get(elderId).n,
    0
  );
  assert.equal((await staff.volunteerSummary(await users.find('20261002'))).monthHours, 0);
});

test('grant and revoke preserve historical appointments, check-ins and calculated volunteer hours without adding current leader credit', async (t) => {
  const { db, staff, users, root, elder, change } = await setup(t);
  await staff.correctAttendance(root, {
    memberId: elderId,
    campusId: campuses[0],
    businessDate: '2026-11-02',
    timeMode: 'duty_start',
    reason: '原有签到事实',
    requestId: crypto.randomUUID()
  });
  db.sqlite.exec("UPDATE attendance_report_settings SET merge_leaders=1,count_mode='actual'");
  const history = () => ({
    posts: db.sqlite
      .prepare('SELECT * FROM member_department_memberships WHERE member_id=?')
      .all(elderId),
    records: db.sqlite.prepare('SELECT * FROM attendance_records WHERE member_id=?').all(elderId)
  });
  const before = history(),
    summary = await staff.volunteerSummary(elder);
  assert.ok(summary.totalHours > 0);
  const weekly = (await staff.attendanceExport(root, { weekStart: '2026-11-02', leadersOnce: '1' }))
    .rows;
  for (const enabled of [true, false]) {
    await change(enabled);
    assert.deepEqual(history(), before);
    assert.deepEqual(await staff.volunteerSummary(await users.find('20261002')), summary);
    const report = await staff.volunteerReport(root, { month: '2026-11' });
    assert.ok(
      !report.weeks
        .find((week) => week.weekStart === day)
        .campuses.flatMap((campus) => campus.rows)
        .some((row) => row.memberId === elderId)
    );
    const after = (
      await staff.attendanceExport(root, { weekStart: '2026-11-02', leadersOnce: '1' })
    ).rows;
    assert.equal(
      after.find((row) => row.memberId === elderId).creditedCount,
      weekly.find((row) => row.memberId === elderId).creditedCount
    );
  }
});

test('retired identity migration preserves existing data without granting past leaders an identity', async (t) => {
  const directory = 'migrations';
  const db = database(directory, '0054_');
  t.after(() => db.sqlite.close());
  seedStaff(db, '20261002');
  db.sqlite.exec(
    "INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,position_code,effective_from,effective_to,created_at) VALUES('former-director','member-20261002','unit-device','primary',1,'director','2026-01-01','2026-11-01','2026-01-01')"
  );
  const snapshot = () =>
    ['members', 'staff_accounts', 'member_department_memberships', 'audit_events'].map((table) =>
      db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
    );
  const before = snapshot();
  db.sqlite.exec(readFileSync(`${directory}/0054_retired_elder.sql`, 'utf8'));
  assert.deepEqual(snapshot(), before);
  assert.equal(
    db.sqlite.prepare('SELECT COUNT(*) n FROM member_special_identities').get().n,
    0,
    'migration must not automatically grant past leaders an identity'
  );
});
