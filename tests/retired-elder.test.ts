import { unusedAttachments } from './helpers/database.ts';
import type { StaffAccountDto } from '../shared/staff-types.ts';
import { present } from './helpers/present.ts';
import { runWorkflow } from './fixtures/workflow-seed.ts';
import test from 'node:test';
import assert from 'node:assert/strict';

import { database, seedStaff } from './helpers/database.ts';
import { staffServices } from './fixtures/staff-services.ts';
import { staffPlatformRepository } from '../src/db/staff-platform.ts';
import { userRepository } from '../src/db/users.ts';
import { signToken } from '../src/lib/jwt.ts';
import { handleRequest } from '../src/app.ts';

const day = '2026-11-09',
  weekStart = day;
const campuses = ['campus-nanhu', 'campus-hunnan'];
const elderId = 'member-20261002';
const shift = (memberId: string) => ({ memberId, businessDate: day, startAt: '19:00', endAt: '21:00' });

async function setup(t: import('node:test').TestContext) {
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
  const root = present(await users.find('root001')),
    elder = present(await users.find('20261002'));
  const change = async (enabled: boolean) =>
    staff.setRetiredElder(root, elderId, {
      enabled,
      revision: present((await repository.memberRow(elderId))).revision,
      requestId: crypto.randomUUID()
    });
  const env = {
    DB: { withSession: () => db },
    ATTACHMENTS: unusedAttachments,
    JWT_SECRET: 'retired-elder-test-secret'.repeat(2),
    PII_ENCRYPTION_KEY: '00'.repeat(32)
  };
  async function api<T = unknown>(account: string, path: string, body?: object | null, method = body ? 'PUT' : 'GET', savedToken?: string) {
    const token = savedToken ?? signToken(present(await users.find(account)), env.JWT_SECRET);
    const response = await handleRequest(
      new Request(`https://app.test/api/${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
      }),
      env
    );
    const payload: T = await response.json();
    return { status: response.status, body: payload };
  }
  const publish = async (campusId: string, assignments: ReturnType<typeof shift>[] = [], office: ReturnType<typeof shift>[] = []) => {
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
  type Fixture = Awaited<ReturnType<typeof setup>>;
  let db: Fixture['db'], users: Fixture['users'], repository: Fixture['repository'], staff: Fixture['staff'], root: Fixture['root'], elder: Fixture['elder'], api: Fixture['api'], env: Fixture['env'], path: string, input: { enabled: boolean; revision: number; requestId: `${string}-${string}-${string}-${string}-${string}`; }, granted: Fixture['elder'], revision: number;

  await runWorkflow(
    'retired-identity',
    'initial',
    [
      ['initial', 'REJECT_UNAUTHORIZED', 'ordinary'],
      ['ordinary', 'GRANT', 'privileged'],
      ['privileged', 'REVOKE', 'ordinary'],
      ['ordinary', 'ROLLBACK_FAILED_GRANT', 'ordinary']
    ],
    [
      {
        event: 'REJECT_UNAUTHORIZED',

        run: async () => {
          ({ db, users, repository, staff, root, elder, api, env } = await setup(t));
          path = `members/${elderId}/retired-elder`;
          input = { enabled: true, revision: 0, requestId: crypto.randomUUID() };
          assert.deepEqual((await staff.contextFor(elder)).specialIdentities, []);
          assert.equal(
            (await staff.contextFor(elder)).permissions['members.manage'],
            false,
            'past leadership does not grant this identity'
          );
          for (const account of ['20261002', '20261005']) {
            assert.equal((await api(account, path, input)).status, 403);
          }
          await assert.rejects(
            staff.setRetiredElder({ ...elder, role: 'superadmin' }, elderId, input),
            {
              status: 403
            }
          );
          assert.equal((await api('root001', path, { ...input, enabled: 'true' })).status, 400);
          await staff.updateMember(present(await users.find('20261001')), elderId, {
            revision: 0,
            specialIdentities: ['retired_elder']
          });
          await assert.rejects(staff.ownProfile(elder, { revision: 0, retiredElder: true }), {
            status: 400
          });
          assert.equal(
            present(db.sqlite.prepare('SELECT COUNT(*) n FROM member_special_identities').get()).n,
            0
          );
        }
      },
      {
        event: 'GRANT',

        run: async () => {
          const oldToken = signToken(elder, env.JWT_SECRET);
          assert.equal((await api('root001', path, input)).status, 200);
          assert.equal((await api('20261002', 'auth/me', null, 'GET', oldToken)).status, 401);
          granted = present(await users.find('20261002'));
          assert.deepEqual(granted.authorizedCampuses.slice().sort(), ['南湖', '浑南']);
          assert.equal((await api('20261005', path, { enabled: false, revision: 1 })).status, 403);
        }
      },
      {
        event: 'REVOKE',

        run: async () => {
          const activeToken = signToken(granted, env.JWT_SECRET);
          assert.equal((await api('root001', path, { enabled: false, revision: 0 })).status, 409);
          assert.equal((await api('root001', path, { enabled: false, revision: 1 })).status, 200);
          assert.equal((await api('20261002', 'auth/me', null, 'GET', activeToken)).status, 401);
          assert.deepEqual((present(await users.find('20261002'))).authorizedCampuses, ['南湖']);
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
        }
      },
      {
        event: 'ROLLBACK_FAILED_GRANT',

        run: async () => {
          revision = present(await repository.memberRow(elderId)).revision;
          const beforeFailure = present(await users.find('20261002'));
          db.sqlite.exec(
            "CREATE TRIGGER reject_identity_audit BEFORE INSERT ON audit_events WHEN NEW.action='identity.retired_elder.granted' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;"
          );
          await assert.rejects(
            staff.setRetiredElder(root, elderId, { enabled: true, revision }),
            /audit unavailable/
          );
          assert.equal(present(await repository.memberRow(elderId)).revision, revision);
          assert.deepEqual((await staff.contextFor(granted)).specialIdentities, []);
          const afterFailure = present(await users.find('20261002'));
          assert.equal(afterFailure.authVersion, beforeFailure.authVersion);
          assert.equal(afterFailure.tokenVersion, beforeFailure.tokenVersion);
        }
      }
    ]
  );
});

test('retired elders manage real personnel, accounts, booking, rosters and attendance in both campuses', async (t) => {
  const { staff, users, change, api } = await setup(t);
  await change(true);
  const elder = present(await users.find('20261002'));
  const context = await staff.contextFor(elder);
  const accounts = (await api<{ items: StaffAccountDto[] }>('20261002', 'users')).body.items;
  assert.ok(
    present(present(accounts.find((item) => item.memberId === elderId)).identities).some((item) => item.code === 'retired_elder')
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
    const detail = await api<Awaited<ReturnType<typeof staff.memberDetail>>>('20261002', `members/${memberId}`);
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
      present((await staff.attendanceDay(elder, { campusId, businessDate: day })).items.find(
        (item) => item.memberId === memberId
      )).status,
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

test('retired elders still cannot fill availability, join either duty, accept cover or receive attendance corrections', async (t) => {
  const { db, repository, staff, users, root, elder, change, publish } = await setup(t);
  db.sqlite.prepare(`INSERT INTO member_department_memberships
    (id,member_id,department_id,position_code,assignment_type,is_primary,effective_from,created_at)
    VALUES('elder-exchange',?,'dept-hardware','member','exchange',0,'2026-11-03','2026-11-03')`).run(elderId);
  const worker = present(await users.find('20261003'));
  const roster = await publish(campuses[0], [shift(worker.memberId)]);
  const assignment = present(roster.rosters.find((row) => row.dutyType === 'repair')).assignments[0];
  t.mock.timers.setTime(Date.parse('2026-11-08T12:00:00Z'));
  const invitation = await staff.requestCover(worker, assignment.id, {
    toMemberId: elderId,
    revision: assignment.revision,
    requestId: crypto.randomUUID()
  });
  t.mock.timers.setTime(Date.parse(`${day}T11:10:00Z`));
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
    staff.respondCover(present(await users.find('20261002')), invitation.id, {
      decision: 'accepted',
      revision: 0,
      requestId: crypto.randomUUID()
    }),
    { status: 409 }
  );
  await staff.directCheckIn(root, { campusId: campuses[0], requestId: crypto.randomUUID() });
  const event = await repository.dutyEvent(day, campuses[0]);
  await assert.rejects(
    staff.correctAttendance(root, {
      memberId: elderId,
      eventId: present(event).id,
      occurredAt: `${day}T11:00:00Z`,
      reason: '不能通过场次补签到'
    }),
    { status: 409 }
  );
  assert.equal(
    present(db.sqlite.prepare('SELECT COUNT(*) n FROM attendance_records WHERE member_id=?').get(elderId)).n,
    0
  );
  assert.equal((await staff.volunteerSummary(present(await users.find('20261002')))).monthHours, 0);
});

for (const campusId of campuses)
  test(`retired elders use both check-in methods in ${campusId} and earn attendance credit without leader credit`, async (t) => {
    const { db, repository, staff, users, root, change, api } = await setup(t);
    // Keep historical leader credit outside this month to isolate new attendance.
    db.sqlite.exec(
      "UPDATE member_department_memberships SET effective_to='2026-11-01' WHERE id='former-director'; UPDATE attendance_report_settings SET merge_leaders=1,count_mode='actual',hours_per_count=3"
    );
    await change(true);
    const elder = present(await users.find('20261002'));
    const before = await staff.volunteerSummary(elder);
    assert.equal(before.monthHours, 0);
    const home = (await api<Awaited<ReturnType<typeof staff.field.home>>>('20261002', `field/home?campusId=${campusId}`)).body;
    assert.equal(home.capability['attendance.self'], true);
    assert.equal(home.directAttendance.allowed, true);
    assert.equal(home.rosterParticipant, false);
    assert.deepEqual(home.todayDuties, []);
    assert.equal(home.capability['attendance.token.issue'], true);
    assert.equal((await staff.attendanceDay(elder, { campusId })).canShowCode, false);

    await staff.directCheckIn(root, { campusId });
    const event = await repository.dutyEvent(day, campusId);
    const token = await staff.issueAttendanceToken(root, present(event).id);
    const checked = await api<Awaited<ReturnType<typeof staff.checkIn>>>('20261002', 'attendance/check-ins', { token: token.token }, 'POST');
    assert.equal(checked.status, 200);
    assert.equal(checked.body.campusId, campusId);
    assert.equal(checked.body.nonScheduled, true);
    assert.equal((await staff.attendanceDay(elder, { campusId })).canShowCode, true);
    assert.ok((await staff.issueAttendanceToken(elder, present(event).id)).token);
    const duplicate = await api<Awaited<ReturnType<typeof staff.directCheckIn>>>('20261002', 'attendance/self-check-in', { campusId }, 'POST');
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.id, checked.body.id);
    assert.equal((await staff.volunteerSummary(elder)).monthHours, 3);

    t.mock.timers.setTime(new Date('2026-11-10T11:10:00Z').getTime());
    const otherCampus = campuses.find((candidate) => candidate !== campusId);
    const direct = await api<Awaited<ReturnType<typeof staff.directCheckIn>>>('20261002', 'attendance/self-check-in', { campusId: otherCampus }, 'POST');
    assert.equal(direct.status, 200);
    assert.notEqual(direct.body.id, checked.body.id);
    assert.equal(direct.body.nonScheduled, true);
    for (const countMode of ['actual', 'weekly']) {
      db.sqlite.prepare('UPDATE attendance_report_settings SET count_mode=?').run(countMode);
      const expected = countMode === 'actual' ? 6 : 3;
      const summary = await staff.volunteerSummary(elder);
      assert.equal(summary.monthHours, expected);
      assert.equal(summary.totalHours, before.totalHours + expected);
      const report = await staff.volunteerReport(root, { month: '2026-11' });
      const row = present(report.weeks
        .find((week) => week.weekStart === day))
        .campuses.flatMap((campus) => campus.rows)
        .find((row) => row.memberId === elderId);
      assert.equal(present(row).leader, false);
      assert.equal(present(row).hours, expected);
      assert.equal(present(row).campusId, 'campus-nanhu');
    }
    const report = await staff.attendanceExport(root, { weekStart, memberId: elderId, leadersOnce: '1' });
    assert.ok('weekStart' in report);
    const weekly = report.rows[0];
    assert.equal(weekly.leaderCredit, false);
    assert.equal(weekly.actualCount, 2);
    assert.equal(weekly.creditedCount, 2);
    assert.equal(weekly.campuses, '南湖');
  });

test('retirement rejects overlapping primary posts and allows manual correction and renewal', async (t) => {
  const { db, staff, root, users, repository, change } = await setup(t);
  const revision = async () => present(await repository.memberRow(elderId)).revision;
  const addPost = async (assignmentType: 'primary' | 'exchange' | 'maintenance_affairs', effectiveFrom = day) =>
    staff.addMembership(root, elderId, { assignmentType, departmentId: 'dept-hardware', effectiveFrom, revision: await revision() });
  const future = await addPost('primary', '2026-11-12');
  assert.ok('id' in future);
  await assert.rejects(change(true), { status: 409 });
  await staff.endMembership(root, elderId, future.id, { revision: future.revision, effectiveTo: '2026-11-12' });
  await change(true);
  assert.equal(present(await repository.memberRow(elderId)).retired_effective_to, '2027-11-09');
  await addPost('exchange');
  await addPost('maintenance_affairs');
  await assert.rejects(addPost('primary'), { status: 409 });
  const incoming = await addPost('primary', '2027-11-09');
  assert.ok('id' in incoming);
  await assert.rejects(staff.setRetiredElder(root, elderId, { enabled: true, revision: await revision(), effectiveTo: '2028-11-09' }), { status: 409 });
  await staff.endMembership(root, elderId, incoming.id, { revision: incoming.revision, effectiveTo: '2027-11-09' });
  await staff.setRetiredElder(root, elderId, { enabled: true, revision: await revision(), effectiveTo: '2028-11-09' });
  assert.equal(present(await repository.memberRow(elderId)).retired_effective_to, '2028-11-09');
  db.sqlite.exec("UPDATE member_special_identities SET effective_to=date('now','+8 hours')");
  const expired = present(await users.find('20261002'));
  assert.deepEqual(expired.authorizedCampuses, ['南湖']);
  assert.deepEqual((await staff.contextFor(expired)).specialIdentities, []);
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
  const weeklyReport = await staff.attendanceExport(root, { weekStart: '2026-11-02', leadersOnce: '1' });
  assert.ok('weekStart' in weeklyReport);
  const weekly = weeklyReport.rows;
  for (const enabled of [true, false]) {
    await change(enabled);
    assert.deepEqual(history(), before);
    assert.deepEqual(await staff.volunteerSummary(present(await users.find('20261002'))), summary);
    const report = await staff.volunteerReport(root, { month: '2026-11' });
    assert.ok(
      !present(report.weeks
        .find((week) => week.weekStart === day))
        .campuses.flatMap((campus) => campus.rows)
        .some((row) => row.memberId === elderId)
    );
    const afterReport = await staff.attendanceExport(root, { weekStart: '2026-11-02', leadersOnce: '1' });
    assert.ok('weekStart' in afterReport);
    const after = afterReport.rows;
    assert.equal(
      present(after.find((row) => row.memberId === elderId)).creditedCount,
      present(weekly.find((row) => row.memberId === elderId)).creditedCount
    );
  }
});
