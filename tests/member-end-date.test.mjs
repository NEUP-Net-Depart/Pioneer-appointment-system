import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, seedStaff } from './helpers/database.mjs';
import { staffServices } from './fixtures/staff-services.mjs';
import { userRepository } from '../src/db/users.js';
import { dateKey, addDays } from '../shared/time.js';

for (const directory of ['migrations', 'database/staff-migrations']) {
  test(`${directory}: same-day end preserves history and invalidates only the ended appointment`, async (t) => {
    const db = database(directory, '0052_');
    t.after(() => db.sqlite.close());
    seedStaff(db, '20261001');
    seedStaff(db, '20261002');
    const today = dateKey();
    const insert = db.sqlite.prepare(
      'INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,position_code,effective_from,created_at) VALUES(?,?,?,?,?,?,?,?)'
    );
    insert.run('head', 'member-20261001', 'dept-office', 'primary', 1, 'head', '2026-01-01', today);
    insert.run(
      'hardware',
      'member-20261002',
      'dept-hardware',
      'primary',
      1,
      'member',
      today,
      today
    );
    insert.run(
      'affairs',
      'member-20261002',
      'dept-hardware',
      'maintenance_affairs',
      0,
      'member',
      today,
      today
    );
    const before = db.sqlite
      .prepare('SELECT * FROM member_department_memberships ORDER BY id')
      .all();
    const accounts = db.sqlite.prepare('SELECT * FROM staff_accounts ORDER BY account').all();
    db.sqlite.exec(readFileSync(`${directory}/0052_same_day_membership_end.sql`, 'utf8'));
    assert.deepEqual(
      db.sqlite.prepare('SELECT * FROM member_department_memberships ORDER BY id').all(),
      before
    );
    assert.deepEqual(
      db.sqlite.prepare('SELECT * FROM staff_accounts ORDER BY account').all(),
      accounts
    );
    const staff = staffServices(db, '00'.repeat(32));
    const users = userRepository(db);
    const actor = await users.find('20261001');
    const worker = await users.find('20261002');
    const contextBefore = await staff.contextFor(worker);
    assert.equal(
      staff.evaluate(contextBefore, 'repair.start', { campusId: 'campus-nanhu' }).allowed,
      true
    );
    const accountBefore = db.sqlite
      .prepare("SELECT token_version,auth_version FROM staff_accounts WHERE account='20261002'")
      .get();
    const requestId = crypto.randomUUID();
    const ended = await staff.endMembership(actor, 'member-20261002', 'hardware', {
      revision: 0,
      effectiveTo: today,
      requestId
    });
    assert.equal(ended.effectiveFrom, today);
    assert.equal(ended.effectiveTo, today);
    assert.equal(ended.revision, 1);
    const accountAfter = db.sqlite
      .prepare("SELECT token_version,auth_version FROM staff_accounts WHERE account='20261002'")
      .get();
    assert.equal(accountAfter.token_version, accountBefore.token_version + 1);
    assert.equal(accountAfter.auth_version, accountBefore.auth_version + 1);
    const contextAfter = await staff.contextFor(await users.find('20261002'));
    assert.equal(
      staff.evaluate(contextAfter, 'repair.start', { campusId: 'campus-nanhu' }).allowed,
      false
    );
    assert.equal(
      staff.evaluate(contextAfter, 'repair.receive', { campusId: 'campus-nanhu' }).allowed,
      true
    );
    const audit = db.sqlite
      .prepare('SELECT action,before_json,after_json FROM audit_events WHERE request_id=?')
      .get(requestId);
    assert.equal(audit.action, 'organization.membership.ended');
    assert.equal(JSON.parse(audit.before_json).effectiveTo, null);
    assert.equal(JSON.parse(audit.after_json).effectiveTo, today);
    await assert.rejects(
      staff.endMembership(actor, 'member-20261002', 'affairs', {
        revision: 0,
        effectiveTo: addDays(today, -1),
        requestId: crypto.randomUUID()
      }),
      { status: 400 }
    );
    await assert.rejects(
      staff.endMembership(actor, 'member-20261002', 'hardware', {
        revision: 0,
        effectiveTo: today,
        requestId: crypto.randomUUID()
      }),
      { status: 409 }
    );
    await staff.endMembership(actor, 'member-20261002', 'affairs', {
      revision: 0,
      effectiveTo: today,
      requestId: crypto.randomUUID()
    });
    for (const assignmentType of ['primary', 'maintenance_affairs']) {
      const detail = await staff.memberDetail(actor, 'member-20261002');
      await staff.addMembership(actor, 'member-20261002', {
        revision: detail.member.revision,
        assignmentType,
        departmentId: 'dept-network',
        effectiveFrom: addDays(today, -1),
        requestId: crypto.randomUUID()
      });
    }
    await assert.rejects(
      staff.addMembership(actor, 'member-20261002', {
        revision: (await staff.memberDetail(actor, 'member-20261002')).member.revision,
        assignmentType: 'primary',
        departmentId: 'dept-art',
        effectiveFrom: today,
        requestId: crypto.randomUUID()
      }),
      { status: 409 }
    );
    db.sqlite
      .prepare(
        "DELETE FROM member_department_memberships WHERE member_id='member-20261002' AND effective_to IS NULL"
      )
      .run();
    const preview = await staff.importMembers(actor, {
      csv: 'studentId,name\n20261002,20261002',
      defaults: {
        homeCampusId: 'campus-nanhu',
        departmentId: 'dept-network',
        maintenanceParticipation: true,
        effectiveFrom: addDays(today, -1)
      }
    });
    assert.deepEqual(preview.items[0].conflicts, []);
    assert.equal(preview.items[0].changes.filter((item) => item.field === 'membership').length, 2);
    assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  });

  test(`${directory}: empty membership intervals neither block nor bypass real overlap guards`, (t) => {
    const db = database(directory);
    t.after(() => db.sqlite.close());
    seedStaff(db, '20261001');
    const insert = db.sqlite.prepare(
      "INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,position_code,effective_from,effective_to,created_at) VALUES(?,'member-20261001','dept-hardware','primary',1,'member',?,?,'2026-01-01')"
    );
    insert.run('empty', '2026-11-10', '2026-11-10');
    insert.run('real', '2026-11-01', '2026-12-01');
    insert.run('empty-inside', '2026-11-15', '2026-11-15');
    assert.throws(
      () => insert.run('overlap', '2026-11-10', '2026-11-20'),
      /PRIMARY_MEMBERSHIP_OVERLAP/
    );
    assert.throws(
      () => insert.run('backwards', '2026-12-02', '2026-12-01'),
      /CHECK constraint failed/
    );
    assert.throws(
      () =>
        db.sqlite.exec(
          "UPDATE member_department_memberships SET effective_to='2026-11-16' WHERE id='empty-inside'"
        ),
      /PRIMARY_MEMBERSHIP_OVERLAP/
    );
    db.sqlite.exec(
      "UPDATE member_department_memberships SET effective_to='2026-11-01' WHERE id='real'"
    );
    insert.run('replacement', '2026-11-01', null);
  });
}
