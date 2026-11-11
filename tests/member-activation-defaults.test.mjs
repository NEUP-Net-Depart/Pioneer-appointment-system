import test from 'node:test';
import assert from 'node:assert/strict';
import { database, seedStaff } from './helpers/database.mjs';
import { staffPlatformRepository } from '../src/db/staff-platform.js';
import { staffServices } from './fixtures/staff-services.mjs';
import { userRepository } from '../src/db/users.js';
import { activationRepository } from '../src/db/activation.js';
import { activationService } from '../src/services/activation.js';

function fixture(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-10T02:00:00Z') });
  const db = database();
  t.after(() => db.sqlite.close());
  seedStaff(db, '20261001');
  seedStaff(db, '20261002');
  db.sqlite.exec(
    "INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,position_code,effective_from,created_at) VALUES('leader','member-20261001','dept-office','primary',1,'head','2026-01-01','2026-01-01'),('worker','member-20261002','dept-office','primary',1,'member','2026-01-01','2026-01-01');"
  );
  const repository = staffPlatformRepository(db);
  const staff = staffServices(db, '00'.repeat(32));
  const users = userRepository(db);
  const activation = activationService(activationRepository(db), users, staff, repository);
  return { db, staff, users, activation };
}

test('activation reviewers need a current leadership appointment', async (t) => {
  const { db, users, activation } = fixture(t);
  const input = { ids: [crypto.randomUUID()], status: 'approved', identityVerified: true };
  await assert.rejects(activation.review(input, await users.find('20261002')), { status: 403 });
  db.sqlite.exec(
    "UPDATE member_department_memberships SET effective_to='2026-11-10' WHERE id='leader'"
  );
  await assert.rejects(activation.review(input, await users.find('20261001')), { status: 403 });
});

test('default activation uses the home campus, preserves revocations and scopes legacy qualifications', async (t) => {
  const { db, staff, users, activation } = fixture(t);
  const leader = await users.find('20261001');
  const created = await staff.createMember(leader, {
    studentId: '20269902',
    name: '撤销测试',
    homeCampusId: 'campus-nanhu'
  });
  const enrollment = await activation.member(created.member.memberId, leader);
  assert.equal(enrollment.status, 'open');
  assert.deepEqual(enrollment.authorizedCampuses, ['南湖']);
  await activation.changeWhitelist('20269902', { status: 'revoked' }, leader);
  const preview = await staff.importMembers(leader, { csv: 'studentId,name\n20269902,撤销测试' });
  assert.equal(preview.summary.skipped, 1);
  assert.equal((await activation.member(created.member.memberId, leader)).status, 'revoked');
  await assert.rejects(
    activation.submit({
      studentId: '20269902',
      name: '撤销测试',
      homeCampus: '南湖',
      password: 'MemberTest!2026'
    }),
    { status: 400 }
  );
  db.sqlite.exec(
    "INSERT INTO members(id,student_id,name,home_campus_id,status,created_at,updated_at) VALUES('legacy-local','20269903','旧成员','campus-nanhu','active','2026-01-01','2026-01-01'),('legacy-other','20269904','跨校区成员','campus-hunnan','active','2026-01-01','2026-01-01')"
  );
  const state = await activation.member('legacy-local', leader);
  assert.deepEqual(state.authorizedCampuses, ['南湖']);
  assert.equal(state.status, 'unset');
  const configured = await activation.configureMember('legacy-local', {
    authorizedCampuses: state.authorizedCampuses, stateToken: state.stateToken
  }, leader);
  assert.equal(configured.status, 'open');
  await assert.rejects(activation.member('legacy-other', leader), { status: 403 });
});
