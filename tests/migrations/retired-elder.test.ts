import { present } from '../helpers/present.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, seedStaff } from '../helpers/database.ts';

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
    present(db.sqlite.prepare('SELECT COUNT(*) n FROM member_special_identities').get()).n,
    0,
    'migration must not automatically grant past leaders an identity'
  );
});

test('lifecycle migration preserves role-independent assignments and pending activation', (t) => {
  const db = database('migrations', '0058_');
  t.after(() => db.sqlite.close());
  seedStaff(db, '20261002');
  db.sqlite.exec(`
    UPDATE staff_accounts SET role='admin' WHERE account='20261002';
    INSERT INTO member_special_identities VALUES('member-20261002','retired_elder','2024-02-28T17:00:00Z');
    INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,position_code,effective_from,created_at)
      VALUES('former-post','member-20261002','unit-device','primary',1,'director','2026-01-01','2026-01-01');
    INSERT INTO members(id,name,student_id,home_campus_id,status,created_at,updated_at)
      VALUES('pending-member','待激活','20261003','campus-nanhu','active','2026-01-01','2026-01-01');
    INSERT INTO staff_whitelist(student_id,expected_name,expected_role,created_by,created_at)
      VALUES('20261003','待激活','admin','20261002','2026-01-01');
    INSERT INTO activation_member_bindings VALUES('20261003','pending-member');
    INSERT INTO whitelist_campus_grants VALUES('20261003','南湖');
    INSERT INTO activation_requests(id,student_id,name,home_campus,contact,password_hash,receipt_hash,created_at)
      VALUES('pending-test','20261003','待激活','南湖','test','test',printf('%064d',1),'2026-01-01');
  `);
  const unchanged = () => ['member_department_memberships', 'staff_campus_grants', 'audit_events', 'activation_requests'].map(table => db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  const before = unchanged();
  db.sqlite.exec(readFileSync('migrations/0058_staff_identity_lifecycle.sql', 'utf8'));
  assert.deepEqual(unchanged(), before);
  assert.equal(present(db.sqlite.prepare('SELECT effective_to FROM member_special_identities').get()).effective_to, '2025-02-28');
  assert.throws(() => db.sqlite.exec("UPDATE staff_accounts SET role='admin'"), /OBSOLETE_STAFF_ROLE/);
  db.sqlite.exec("UPDATE activation_requests SET status='approved',reviewed_at='2026-11-24',reviewed_by='20261002' WHERE id='pending-test'");
  assert.equal(present(db.sqlite.prepare("SELECT role FROM staff_accounts WHERE member_id='pending-member'").get()).role, 'technician');
  assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
});
