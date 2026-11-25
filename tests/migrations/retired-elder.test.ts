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
