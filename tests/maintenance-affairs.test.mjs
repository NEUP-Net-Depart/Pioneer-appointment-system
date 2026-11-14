import test from 'node:test';
import assert from 'node:assert/strict';
import { database, seedStaff } from './helpers/database.mjs';
import { createAuthorizer } from '../src/modules/authorization/public.js';
import { dutyCandidateTypes } from '../shared/duty.js';
import { staffPlatformRepository } from '../src/db/staff-platform.js';
import { appointmentRepository } from '../src/db/appointments.js';
import { composeStaffPlatform } from '../src/app/compose.js';
import { staffPlatformService } from '../src/services/staff-platform.js';
import { userRepository } from '../src/db/users.js';
import { readFileSync } from 'node:fs';

const campusId = 'campus-nanhu';
const day = '2026-11-09';
const post = (assignmentType, departmentCode = 'office') => ({ assignmentType, departmentCode, isPrimary: assignmentType === 'primary', positionCode: 'member', effectiveFrom: '2026-01-01' });

test('office alone loses operations; dual additional appointments provide affairs without automatic repair duty', () => {
  const actor = { memberId: 'member', status: 'enabled', authorizedCampuses: [campusId] };
  const authorizer = createAuthorizer();
  const permitted = (memberships, code) => authorizer.evaluate(actor, code, { campusId }, { actor, memberships, authorizationDate: day }).allowed;
  const office = [post('primary')];
  const dual = [...office, post('exchange', 'hardware'), post('maintenance_affairs')];
  for (const code of ['repair.receive', 'onsite.create', 'attendance.self', 'attendance.token.issue']) {
    assert.equal(permitted(office, code), false, code);
    assert.equal(permitted(dual, code), true, code);
  }
  for (const code of ['attendance.correct', 'attendance.session.manage', 'attendance.export']) assert.equal(permitted(dual, code), false, code);
  assert.equal(permitted([post('maintenance_affairs', 'hardware')], 'repair.start'), false);
  assert.deepEqual(dutyCandidateTypes(office, day), []);
  assert.deepEqual(dutyCandidateTypes(dual, day), ['office']);
  const expired = [{ ...post('maintenance_affairs'), effectiveTo: day }];
  assert.equal(permitted(expired, 'attendance.token.issue'), false);
  assert.deepEqual(dutyCandidateTypes(expired, day), []);
});

test('affairs can check in without a roster; independent issuers and private immutable check-in provenance', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${day}T11:10:00Z`) });
  const db = database();
  t.after(() => db.sqlite.close());
  for (const account of ['20261001', '20261002', '20261003']) {
    seedStaff(db, account);
    db.sqlite.prepare("INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,position_code,effective_from,created_at) VALUES(?,?,'dept-office','maintenance_affairs',0,'member','2026-01-01','2026-01-01')").run(`affairs-${account}`, `member-${account}`);
  }
  const repository = staffPlatformRepository(db);
  const platform = composeStaffPlatform({ repository, repairs: appointmentRepository(db) });
  const staff = staffPlatformService({ repository, platform, manifests: platform.manifests });
  const users = userRepository(db);
  const first = await users.find('20261001');
  const second = await users.find('20261002');
  const visitor = await users.find('20261003');
  const event = await staff.createAttendanceEvent(first, { type: 'duty', campusId, businessDate: day });
  await assert.rejects(staff.issueAttendanceToken(first, event.id), error => error.status === 403 && error.message.includes('请先完成'));
  await staff.directCheckIn(first, { campusId, requestId: crypto.randomUUID() });
  await staff.directCheckIn(second, { campusId, requestId: crypto.randomUUID() });
  const firstCode = await staff.issueAttendanceToken(first, event.id);
  const secondCode = await staff.issueAttendanceToken(second, event.id);
  const refreshed = await staff.issueAttendanceToken(first, event.id);
  await assert.rejects(staff.checkIn(visitor, { token: firstCode.token, method: 'qr' }), error => error.status === 404);
  const checked = await staff.checkIn(visitor, { token: secondCode.token, method: 'qr' });
  assert.equal(checked.checkinSource, undefined);
  const again = await staff.checkIn(visitor, { token: refreshed.token, method: 'qr' });
  assert.equal(again.id, checked.id);
  const stored = JSON.parse(db.sqlite.prepare('SELECT checkin_source FROM attendance_records WHERE id=?').get(checked.id).checkin_source);
  assert.equal(stored.issuerMemberId, second.memberId);
  assert.equal(stored.tokenId, secondCode.tokenId);
  const readOnlyDay = await staff.attendanceDay(second, { campusId, businessDate: day });
  const workload = await staff.attendanceWorkload(second, { campusId, businessDate: day });
  assert.deepEqual(new Set(workload.items.map(row => row.memberId)), new Set([...readOnlyDay.items, ...readOnlyDay.temporary].map(row => row.memberId)));
  assert.equal(readOnlyDay.canManage, false);
  assert.deepEqual(readOnlyDay.people, []);
  for (const person of [...readOnlyDay.items, ...readOnlyDay.temporary]) {
    assert.equal(person.canCorrect, false);
    assert.equal(person.record?.checkinSource, undefined);
    if (person.record) assert.equal(person.workStatus, 'idle');
  }
  const own = await staff.attendanceList(visitor, { businessDate: day });
  assert.equal(own.items[0].checkinSource, undefined);
  await assert.rejects(staff.attendanceList(visitor, { all: '1', businessDate: day }), error => error.status === 403);
  const direct = await staff.directCheckIn(first, { campusId, requestId: crypto.randomUUID() });
  assert.equal(direct.checkinSource, undefined);
  assert.equal(JSON.parse(db.sqlite.prepare('SELECT checkin_source FROM attendance_records WHERE id=?').get(direct.id).checkin_source).kind, 'direct');
  db.sqlite.prepare("INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,position_code,effective_from,created_at) VALUES('head',?,'dept-office','primary',1,'head','2026-01-01','2026-01-01')").run(first.memberId);
  const manager = await users.find(first.account);
  const created = await staff.createMember(manager, { studentId: '20261009', name: '双任职测试', homeCampusId: campusId, departmentId: 'dept-network', exchangeParticipation: true, maintenanceParticipation: true, effectiveFrom: day });
  assert.deepEqual((await repository.memberships(created.member.memberId, day)).map(row => row.assignmentType).sort(), ['exchange', 'maintenance_affairs', 'primary']);
  const managed = await staff.attendanceList(manager, { all: '1', businessDate: day });
  assert.equal(managed.items.find(row => row.id === checked.id).checkinSource.issuerMemberId, second.memberId);
  const attendanceDay = await staff.attendanceDay(manager, { campusId, businessDate: day });
  assert.deepEqual(attendanceDay.temporary.find(row => row.record.id === checked.id).record.checkinSource, stored);
  assert.deepEqual(attendanceDay.temporary.find(row => row.record.id === direct.id).record.checkinSource, { kind: 'direct' });
  await assert.rejects(staff.createAttendanceEvent(second, { type: 'meeting', businessDate: day, campusId }), error => error.status === 403);
  db.sqlite.prepare("UPDATE member_department_memberships SET effective_to=? WHERE id=?").run(day, `affairs-${second.account}`);
  await assert.rejects(staff.issueAttendanceToken(await users.find(second.account), event.id), error => error.status === 403);
});

for (const directory of ['migrations', 'database/staff-migrations']) test(`${directory}: affairs migration preserves populated membership facts and does not grant office staff a new appointment`, () => {
  const db = database(directory, '0051');
  try {
    seedStaff(db, '20261001');
    db.sqlite.exec("INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,position_code,effective_from,created_at) VALUES('old-office','member-20261001','dept-office','primary',1,'member','2026-01-01','2026-01-01')");
    const before = db.sqlite.prepare('SELECT * FROM member_department_memberships').all();
    db.sqlite.exec(readFileSync(`${directory}/0051_maintenance_affairs.sql`, 'utf8'));
    assert.deepEqual(db.sqlite.prepare('SELECT * FROM member_department_memberships').all(), before);
    assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
    assert.throws(() => db.sqlite.exec("INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,position_code,effective_from,created_at) VALUES('overlap','member-20261001','dept-office','primary',1,'member','2026-01-01','2026-01-01')"), /PRIMARY_MEMBERSHIP_OVERLAP/);
  } finally { db.sqlite.close(); }
});
