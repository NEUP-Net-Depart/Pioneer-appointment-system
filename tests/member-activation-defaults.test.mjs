import test from 'node:test';
import assert from 'node:assert/strict';
import { database, seedStaff } from './helpers/database.mjs';
import { staffPlatformRepository } from '../src/db/staff-platform.js';
import { composeStaffPlatform } from '../src/app/compose.js';
import { staffPlatformService } from '../src/services/staff-platform.js';
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
  const platform = composeStaffPlatform({ repository });
  const staff = staffPlatformService({ repository, platform, manifests: platform.manifests });
  const users = userRepository(db);
  const activation = activationService(activationRepository(db), users, staff, repository);
  return { db, repository, staff, users, activation };
}

test('new ordinary members can apply immediately and only current scoped leaders can review', async (t) => {
  const { db, staff, users, activation } = fixture(t);
  const leader = await users.find('20261001');
  const created = await staff.createMember(leader, {
    studentId: '20269901',
    name: '自动激活测试',
    homeCampusId: 'campus-nanhu',
    configureActivation: false
  });
  const enrollment = await activation.member(created.member.memberId, leader);
  assert.equal(enrollment.status, 'open');
  assert.deepEqual(enrollment.authorizedCampuses, ['南湖']);
  const application = await activation.submit({
    studentId: '20269901',
    name: '自动激活测试',
    homeCampus: '南湖',
    password: 'MemberTest!2026'
  });
  const input = { ids: [application.id], status: 'approved', identityVerified: true };
  await assert.rejects(
    activation.review(input, await users.find('20261002')),
    (error) => error.status === 403
  );
  assert.deepEqual((await activation.review(input, leader)).applied, [application.id]);
  const account = await users.find('20269901');
  assert.equal(account.role, 'technician');
  assert.deepEqual(account.authorizedCampuses, ['南湖']);
  assert.equal((await staff.contextFor(account)).permissions['accounts.manage'], false);
  db.sqlite.exec(
    "UPDATE member_department_memberships SET effective_to='2026-11-10' WHERE id='leader'"
  );
  await assert.rejects(
    activation.requests(await users.find('20261001')),
    (error) => error.status === 403
  );
});

test('default activation preserves revoked qualifications and respects campus scope for legacy members', async (t) => {
  const { db, staff, users, activation } = fixture(t);
  const leader = await users.find('20261001');
  const created = await staff.createMember(leader, {
    studentId: '20269902',
    name: '撤销测试',
    homeCampusId: 'campus-nanhu'
  });
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
    (error) => error.status === 400
  );
  db.sqlite.exec(
    "INSERT INTO members(id,student_id,name,home_campus_id,status,created_at,updated_at) VALUES('legacy-local','20269903','旧成员','campus-nanhu','active','2026-01-01','2026-01-01'),('legacy-other','20269904','跨校区成员','campus-hunnan','active','2026-01-01','2026-01-01')"
  );
  const state = await activation.member('legacy-local', leader);
  assert.deepEqual(state.authorizedCampuses, ['南湖']);
  assert.equal(state.status, 'unset');
  assert.equal(
    (
      await activation.configureMember(
        'legacy-local',
        { authorizedCampuses: state.authorizedCampuses, stateToken: state.stateToken },
        leader
      )
    ).status,
    'open'
  );
  await assert.rejects(activation.member('legacy-other', leader), (error) => error.status === 403);
});
