import test from 'node:test';
import assert from 'node:assert/strict';
import { database, seedStaff } from './helpers/database.mjs';
import { calculateVolunteerReport } from '../src/modules/attendance/volunteer-report.js';
import { weeklyAttendanceRows } from '../src/modules/attendance/weekly-export.js';
import { staffServices } from './fixtures/staff-services.mjs';
import { userRepository } from '../src/db/users.js';

const day = '2026-11-18';
const campusId = 'campus-hunnan';

async function setup(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${day}T11:10:00Z`) });
  const db = database();
  t.after(() => db.sqlite.close());
  seedStaff(db, '20261001', '浑南');
  seedStaff(db, '20261003', '南湖');
  db.sqlite.exec(`
    INSERT INTO member_department_memberships
      (id,member_id,department_id,assignment_type,is_primary,position_code,effective_from,created_at)
    VALUES
      ('issuer-post','member-20261001','dept-hardware','primary',1,'head','2026-01-01','2026-01-01'),
      ('worker-post','member-20261003','dept-hardware','primary',1,'member','2026-01-01','2026-01-01');
  `);
  const staff = staffServices(db, '00'.repeat(32));
  const users = userRepository(db);
  const issuer = await users.find('20261001');
  const worker = await users.find('20261003');
  const event = await staff.createAttendanceEvent(issuer, { campusId });
  await staff.directCheckIn(issuer, { campusId, requestId: crypto.randomUUID() });
  const credential = await staff.issueAttendanceToken(issuer, event.id);
  return { db, staff, issuer, worker, event, credential };
}

test('cross-campus QR support persists once, appears in own history and hours, without expanding business access', async (t) => {
  const { db, staff, issuer, worker, credential } = await setup(t);
  const before = await staff.volunteerSummary(worker);
  const preview = await staff.previewAttendance(worker, { token: credential.token });
  assert.equal(preview.campusId, campusId);
  assert.equal(preview.campusName, '浑南');
  const record = await staff.checkIn(worker, {
    token: credential.token,
    memberId: issuer.memberId,
    campusId: 'campus-nanhu',
    method: 'qr',
    requestId: crypto.randomUUID()
  });
  assert.equal(record.memberId, worker.memberId);
  assert.equal(record.campusId, campusId);
  assert.equal(record.businessDate, day);
  assert.equal(record.nonScheduled, true);
  assert.equal(record.identitySnapshot.homeCampusId, 'campus-nanhu');
  const again = await staff.checkIn(worker, { token: credential.token });
  assert.equal(again.id, record.id);
  assert.equal(again.isExisting, true);
  for (const query of [{}, { campusId }]) {
    const own = await staff.attendanceList(worker, query);
    assert.deepEqual(own.items.map((item) => item.id), [record.id]);
    assert.equal(own.items[0].checkinSource, undefined);
  }
  assert.ok((await staff.volunteerSummary(worker)).totalHours > before.totalHours);
  const ownCampusReport = await staff.volunteerReport(issuer, { month: '2026-11', campusId });
  assert.equal(ownCampusReport.weeks.flatMap((week) => week.campuses.flatMap((campus) => campus.rows)).some((row) => row.memberId === worker.memberId), false);
  db.sqlite.prepare('INSERT INTO staff_campus_grants(account,campus) VALUES(?,?)').run(issuer.account, '南湖');
  const homeReport = await staff.volunteerReport(issuer, { month: '2026-11', campusId: 'campus-nanhu' });
  const homeRows = homeReport.weeks.flatMap((week) => week.campuses.flatMap((campus) => campus.rows)).filter((row) => row.memberId === worker.memberId);
  assert.deepEqual(homeRows.map((row) => [row.campusId, row.hours]), [['campus-nanhu', 4]]);
  const weekly = await staff.attendanceExport(issuer, { weekStart: '2026-11-16', campusId: 'campus-nanhu' });
  assert.equal(weekly.rows.find((row) => row.memberId === worker.memberId).campuses, '南湖');
  const home = await staff.field.home(worker, { campusId: 'campus-nanhu' });
  assert.equal(home.attendance.id, record.id);
  assert.deepEqual(home.actor.authorizedCampuses, ['南湖']);
  await assert.rejects(staff.field.home(worker, { campusId }), { status: 403 });
  await assert.rejects(staff.attendanceList(worker, { all: '1' }), { status: 403 });
  await assert.rejects(staff.attendanceList(worker, { memberId: issuer.memberId }), { status: 403 });
  await assert.rejects(staff.attendanceDay(worker, { campusId, businessDate: day }), { status: 403 });
  await assert.rejects(staff.createAttendanceEvent(worker, { campusId }), { status: 403 });
});

test('support cannot be followed by a second campus check-in and does not cover the original shift', async (t) => {
  const { db, staff, issuer, worker, credential } = await setup(t);
  const home = 'campus-nanhu';
  db.sqlite.prepare('INSERT INTO staff_campus_grants(account,campus) VALUES(?,?)').run(issuer.account, '南湖');
  db.sqlite.exec("INSERT INTO roster_weeks(id,week_start,campus_id,duty_type,updated_at) VALUES('home-week','2026-11-16','campus-nanhu','office','2026-11-18')");
  db.sqlite.prepare(`INSERT INTO duty_assignments(id,week_id,member_id,campus_id,business_date,start_at,end_at,duty_type,active,revision,created_at,updated_at)
    VALUES('home-shift','home-week',?,? ,?,'19:00','21:00','office',1,0,?,?)`).run(worker.memberId, home, day, day, day);
  const preview = () => staff.previewAttendance(worker, { token: credential.token });
  assert.deepEqual((await preview()).otherDutyCampusNames, ['南湖']);
  db.sqlite.exec("UPDATE duty_assignments SET active=0 WHERE id='home-shift'");
  assert.deepEqual((await preview()).otherDutyCampusNames, []);
  db.sqlite.exec("UPDATE duty_assignments SET active=1 WHERE id='home-shift'");
  await staff.checkIn(worker, { token: credential.token });
  const conflict = { status: 409, code: 'ATTENDANCE_OTHER_CAMPUS' };
  await assert.rejects(staff.previewAttendance(worker, { campusId: home }), conflict);
  await assert.rejects(staff.directCheckIn(worker, { campusId: home }), conflict);
  assert.equal((await staff.attendanceList(worker, {})).items.length, 1);
  t.mock.timers.setTime(new Date(`${day}T13:10:00Z`).getTime());
  const original = await staff.attendanceDay(issuer, { campusId: home, businessDate: day });
  assert.equal(original.items.find(person => person.memberId === worker.memberId).status, 'absent');
  const support = await staff.attendanceDay(issuer, { campusId, businessDate: day });
  assert.equal(support.temporary.find(person => person.memberId === worker.memberId).status, 'arrived');
});

test('volunteer monthly and weekly credits belong to home campus while suspension follows actual attendance campus', () => {
  const member = { memberId: 'worker', name: '支援成员', homeCampusId: 'campus-nanhu' };
  const record = { id: 'support', memberId: member.memberId, campusId, businessDate: day, identitySnapshot: { name: member.name, homeCampusId: member.homeCampusId } };
  const input = {
    month: '2026-11', weeks: ['2026-11-16'], today: day,
    settings: { mergeLeaders: false, countMode: 'weekly', hoursPerCount: 4 },
    data: { members: [member], records: [record] }, facts: [], paused: [], canRead: () => true
  };
  const rows = (report) => report.weeks.flatMap((week) => week.campuses.flatMap((campus) => campus.rows));
  const credited = rows(calculateVolunteerReport(input));
  assert.deepEqual(credited.map((row) => [row.campusId, row.hours]), [['campus-nanhu', 4]]);
  const weekly = weeklyAttendanceRows({ week: '2026-11-16', records: [record], members: [member], facts: [], paused: [], canExport: (target) => target.campusId === 'campus-nanhu' });
  assert.equal(weekly[0].campuses, '南湖');
  assert.equal(weekly[0].creditedCount, 1);
  assert.equal(rows(calculateVolunteerReport({ ...input, paused: [{ businessDate: day, campusId, paused: true }] })).length, 0);
  assert.equal(rows(calculateVolunteerReport({ ...input, paused: [{ businessDate: day, campusId: 'campus-nanhu', paused: true }] }))[0].hours, 4);
  const legacy = { ...record, identitySnapshot: { name: member.name } };
  assert.equal(rows(calculateVolunteerReport({ ...input, data: { members: [member], records: [legacy] } }))[0].campusId, member.homeCampusId);
});

test('QR preview and commit reject missing identity, paused service, revoked and expired credentials without writes', async (t) => {
  const { db, staff, issuer, worker, event, credential } = await setup(t);
  const rejectBoth = async (token, expected) => {
    for (const operation of ['previewAttendance', 'checkIn'])
      await assert.rejects(staff[operation](worker, { token }), expected);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) total FROM attendance_records WHERE member_id=?').get(worker.memberId).total, 0);
  };
  db.sqlite.prepare('UPDATE member_department_memberships SET effective_to=? WHERE id=?').run(day, 'worker-post');
  await rejectBoth(credential.token, { status: 403, code: 'ATTENDANCE_IDENTITY_DENIED' });
  db.sqlite.exec("UPDATE member_department_memberships SET effective_to=NULL WHERE id='worker-post'");
  db.sqlite.prepare('INSERT INTO service_day_overrides(business_date,campus_id,paused,updated_at) VALUES(?,?,1,?)').run(day, campusId, day);
  await rejectBoth(credential.token, { status: 409, code: 'SERVICE_DAY_PAUSED' });
  db.sqlite.exec('DELETE FROM service_day_overrides');
  const refreshed = await staff.issueAttendanceToken(issuer, event.id);
  await rejectBoth(credential.token, { status: 404 });
  for (const token of ['', null, 123, 'pioneer:attendance:v1:'])
    await rejectBoth(token, { status: 400 });
  t.mock.timers.setTime(new Date(`${day}T14:00:00Z`).getTime());
  await rejectBoth(refreshed.token, { status: 404 });
});

test('manually scheduled office members can check in, while invalid direct campuses fail before creating events', async (t) => {
  const { db, staff, worker } = await setup(t);
  db.sqlite.exec("UPDATE member_department_memberships SET department_id='dept-network' WHERE id='worker-post'");
  await assert.rejects(staff.previewAttendance(worker, { campusId: 'campus-nanhu' }), { status: 403 });
  db.sqlite.exec("INSERT INTO roster_weeks(id,week_start,campus_id,duty_type,updated_at) VALUES('manual-week','2026-11-16','campus-nanhu','office','2026-11-18')");
  db.sqlite.prepare(`INSERT INTO duty_assignments
    (id,week_id,member_id,campus_id,business_date,start_at,end_at,duty_type,active,revision,created_at,updated_at)
    VALUES('manual-office','manual-week',?,'campus-nanhu',?,'19:00','21:00','office',1,0,?,?)`).run(worker.memberId, day, day, day);
  const preview = await staff.previewAttendance(worker, { campusId: 'campus-nanhu' });
  assert.equal(preview.memberName, worker.name);
  const record = await staff.directCheckIn(worker, { campusId: 'campus-nanhu' });
  assert.equal(record.memberId, worker.memberId);
  const count = db.sqlite.prepare('SELECT COUNT(*) total FROM attendance_events').get().total;
  for (const invalid of [undefined, '', 'unknown-campus']) {
    await assert.rejects(staff.previewAttendance(worker, { campusId: invalid }), { status: 400 });
    await assert.rejects(staff.directCheckIn(worker, { campusId: invalid }), { status: 400 });
  }
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) total FROM attendance_events').get().total, count);
});
