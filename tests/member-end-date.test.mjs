import test from 'node:test';
import assert from 'node:assert/strict';

import { database, seedStaff } from './helpers/database.mjs';
import { staffServices } from './fixtures/staff-services.mjs';
import { userRepository } from '../src/db/users.js';

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
