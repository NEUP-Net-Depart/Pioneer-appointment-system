import test from 'node:test';
import assert from 'node:assert/strict';
import { database, seedStaff } from '../helpers/database.mjs';

import { readFileSync } from 'node:fs';

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
