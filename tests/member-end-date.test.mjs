import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, seedStaff } from './helpers/database.mjs';
import { staffServices } from './fixtures/staff-services.mjs';
import { userRepository } from '../src/db/users.js';
import { STAFF_RELEASE, verifyStaffSchema } from '../src/db/staff-readiness.js';

test('same-day end preserves history, revokes only its permissions and allows reappointment', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-10T02:00:00Z') });
  const db = database();
  t.after(() => db.sqlite.close());
  seedStaff(db, '20261001');
  seedStaff(db, '20261002');
  const today = '2026-11-10';
  db.sqlite.exec(`
    INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,position_code,effective_from,created_at) VALUES
    ('head','member-20261001','dept-office','primary',1,'head','2026-01-01','2026-01-01'),
    ('hardware','member-20261002','dept-hardware','primary',1,'member','${today}','${today}'),
    ('affairs','member-20261002','dept-hardware','maintenance_affairs',0,'member','${today}','${today}');
  `);
  const staff = staffServices(db, '00'.repeat(32));
  const users = userRepository(db);
  const actor = await users.find('20261001');
  const allowed = async (permission) => staff.evaluate(
    await staff.contextFor(await users.find('20261002')), permission, { campusId: 'campus-nanhu' }
  ).allowed;
  const versions = () => db.sqlite.prepare(
    "SELECT token_version,auth_version FROM staff_accounts WHERE account='20261002'"
  ).get();
  assert.equal(await allowed('repair.start'), true);
  const before = versions();
  const requestId = crypto.randomUUID();
  const ended = await staff.endMembership(actor, 'member-20261002', 'hardware', {
    revision: 0, effectiveTo: today, requestId
  });
  assert.deepEqual([ended.effectiveFrom, ended.effectiveTo, ended.revision], [today, today, 1]);
  assert.deepEqual({ ...versions() }, {
    token_version: before.token_version + 1, auth_version: before.auth_version + 1
  });
  assert.equal(await allowed('repair.start'), false);
  assert.equal(await allowed('repair.receive'), true);
  const audit = db.sqlite.prepare(
    'SELECT action,before_json,after_json FROM audit_events WHERE request_id=?'
  ).get(requestId);
  assert.equal(audit.action, 'organization.membership.ended');
  assert.equal(JSON.parse(audit.before_json).effectiveTo, null);
  assert.equal(JSON.parse(audit.after_json).effectiveTo, today);

  const preview = await staff.importMembers(actor, {
    csv: 'studentId,name\n20261002,20261002',
    defaults: { homeCampusId: 'campus-nanhu', departmentId: 'dept-network', effectiveFrom: today }
  });
  assert.deepEqual(preview.items[0].conflicts, []);
  assert.equal(preview.items[0].changes.filter((item) => item.field === 'membership').length, 1);
  await staff.addMembership(actor, 'member-20261002', {
    revision: (await staff.memberDetail(actor, 'member-20261002')).member.revision,
    assignmentType: 'primary', departmentId: 'dept-hardware', effectiveFrom: today,
    requestId: crypto.randomUUID()
  });
  assert.equal(await allowed('repair.start'), true);
});

for (const directory of ['migrations', 'database/staff-migrations']) {
  test(`${directory}: migration preserves data and enforces nonempty interval overlap`, async (t) => {
    const db = database(directory, '0052_');
    t.after(() => db.sqlite.close());
    seedStaff(db, '20261001');
    const insert = db.sqlite.prepare(
      "INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,position_code,effective_from,effective_to,created_at) VALUES(?,'member-20261001','dept-hardware','primary',1,'member',?,?,'2026-01-01')"
    );
    insert.run('real', '2026-11-01', '2026-12-01');
    const snapshot = () => ({
      memberships: db.sqlite.prepare('SELECT * FROM member_department_memberships ORDER BY id').all(),
      accounts: db.sqlite.prepare('SELECT * FROM staff_accounts ORDER BY account').all()
    });
    const before = snapshot();
    await assert.rejects(verifyStaffSchema(db), /Staff cutover migration is incomplete/);
    db.sqlite.exec(readFileSync(`${directory}/0052_same_day_membership_end.sql`, 'utf8'));
    assert.equal(await verifyStaffSchema(db), STAFF_RELEASE);
    assert.deepEqual(snapshot(), before);
    assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
    insert.run('empty', '2026-11-10', '2026-11-10');
    assert.throws(() => insert.run('overlap', '2026-11-10', '2026-11-20'), /PRIMARY_MEMBERSHIP_OVERLAP/);
    assert.throws(() => insert.run('backwards', '2026-12-02', '2026-12-01'), /CHECK constraint failed/);
    assert.throws(() => db.sqlite.exec(
      "UPDATE member_department_memberships SET effective_to='2026-11-16' WHERE id='empty'"
    ), /PRIMARY_MEMBERSHIP_OVERLAP/);
    db.sqlite.exec("UPDATE member_department_memberships SET effective_to='2026-11-01' WHERE id='real'");
    insert.run('replacement', '2026-11-01', null);
  });
}
