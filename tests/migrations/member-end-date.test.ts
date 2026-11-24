import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, seedStaff } from '../helpers/database.ts';

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
    db.sqlite.exec(readFileSync(`${directory}/0052_same_day_membership_end.sql`, 'utf8'));
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
