import { runModel, rejectWithoutWrite } from './fixtures/workflow-seed.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { database, seedStaff } from './helpers/database.mjs';
import { staffPlatformRepository } from '../src/db/staff-platform.js';
import { staffServices } from './fixtures/staff-services.mjs';
import { userRepository } from '../src/db/users.js';
import { activationRepository } from '../src/db/activation.js';
import { activationService } from '../src/services/activation.js';

function fixture(t, managed = false) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-10T02:00:00Z') });
  const db = database();
  if (!managed) t.after(() => db.sqlite.close());
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
  await activationModel(t);
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

async function activationModel(t) {
  const studentId = '20269908',
    name = '模型成员';
  const application = { studentId, name, homeCampus: '南湖', password: 'MemberTest!2026' };
  const submit = async (r) => {
    r.application = await r.activation.submit(application);
  };
  const review = (r, status, extra = {}) =>
    r.activation.review(
      { ids: [r.application.id], status, identityVerified: true, ...extra },
      r.leader
    );
  const edges = [
    [
      'open',
      'revoked',
      'REVOKE',
      (r) => r.activation.changeWhitelist(studentId, { status: 'revoked' }, r.leader)
    ],
    [
      'revoked',
      'open',
      'REOPEN',
      (r) => r.activation.changeWhitelist(studentId, { status: 'open' }, r.leader)
    ],
    [
      'revoked',
      'revoked',
      'REJECT_SUBMIT',
      (r) => rejectWithoutWrite(r.db, () => submit(r), { status: 400 })
    ],
    ['open', 'pending', 'SUBMIT', submit],
    ['pending', 'approved', 'APPROVE', (r) => review(r, 'approved')],
    ['pending', 'rejected', 'REJECT', (r) => review(r, 'rejected')],
    [
      'pending',
      'revoked',
      'REVOKE_PENDING',
      (r) => r.activation.changeWhitelist(studentId, { status: 'revoked' }, r.leader)
    ],
    [
      'pending',
      'pending',
      'REQUIRE_IDENTITY',
      (r) =>
        rejectWithoutWrite(r.db, () => review(r, 'approved', { identityVerified: false }), {
          status: 400
        })
    ],
    [
      'pending',
      'pending',
      'REJECT_ORDINARY_REVIEW',
      (r) =>
        rejectWithoutWrite(
          r.db,
          () =>
            r.activation.review(
              { ids: [r.application.id], status: 'approved', identityVerified: true },
              r.worker
            ),
          { status: 403 }
        )
    ],
    ['rejected', 'pending', 'RESUBMIT', submit],
    [
      'approved',
      'approved',
      'REJECT_SECOND_REVIEW',
      (r) => rejectWithoutWrite(r.db, () => review(r, 'approved'), { status: 409 })
    ],
    [
      'approved',
      'approved',
      'REJECT_REVOKE_ACTIVATED',
      (r) =>
        rejectWithoutWrite(
          r.db,
          () => r.activation.changeWhitelist(studentId, { status: 'revoked' }, r.leader),
          { status: 409 }
        )
    ]
  ].map(([from, to, event, run]) => ({ from, to, event, run }));
  await runModel({
    name: 'account-activation',
    initial: 'open',
    edges,
    setup: async () => {
      t.mock.timers.reset();
      const r = fixture(t, true);
      r.dispose = () => {
        r.db.sqlite.close();
        t.mock.timers.reset();
      };
      r.leader = await r.users.find('20261001');
      r.worker = await r.users.find('20261002');
      await r.staff.createMember(r.leader, { studentId, name, homeCampusId: 'campus-nanhu' });
      return r;
    },
    observe: async (r, state) => {
      const invitation = r.db.sqlite
        .prepare('SELECT status FROM staff_whitelist WHERE student_id=?')
        .get(studentId);
      assert.equal(
        invitation.status,
        state === 'approved' ? 'activated' : state === 'revoked' ? 'revoked' : 'open'
      );
      const account = await r.users.find(studentId);
      assert.equal(!!account, state === 'approved');
      if (account) assert.deepEqual(account.authorizedCampuses, ['南湖']);
      if (r.application && ['pending', 'approved', 'rejected', 'revoked'].includes(state)) {
        const current = await r.activation.status(r.application.id, r.application.receipt);
        assert.equal(current.status, state === 'revoked' ? 'rejected' : state);
      }
    }
  });
}
