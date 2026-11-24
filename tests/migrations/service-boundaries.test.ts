import { present } from '../helpers/present.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, seedAppointment } from '../helpers/database.ts';
import { expirationDeadline } from '../../shared/time.ts';

import { appointmentRepository } from '../../src/db/appointments.ts';

for (const directory of ['migrations','database/staff-migrations']) {
  test(`${directory}: day migration preserves terminal history and expires only at next Shanghai day`, async () => {
    const db = database(directory, '0044_');
    try {
      for (const status of ['booked','completed','cancelled','expired'] as const)
        seedAppointment(db, { id: status, status, repair_note: '历史内部说明' });
      const before = db.sqlite.prepare('SELECT * FROM appointments ORDER BY id').all();
      db.sqlite.exec(readFileSync(`${directory}/0044_appointment_day.sql`, 'utf8'));
      const after = db.sqlite.prepare('SELECT * FROM appointments ORDER BY id').all();
      assert.deepEqual(after.filter(row => row.status !== 'booked'), before.filter(row => row.status !== 'booked'));
      assert.equal(present(after.find(row => row.id === 'booked')).expires_at, '2026-11-05T16:00:00.000Z');
      assert.equal(expirationDeadline('2026-12-31'), '2026-12-31T16:00:00.000Z');
      db.sqlite.exec(readFileSync(`${directory}/0045_direct_repairs.sql`, 'utf8'));
      const repository = appointmentRepository(db);
      await repository.expirePending('2026-11-05T15:59:59.999Z');
      assert.equal(present((await repository.find('booked'))).status, 'booked');
      await repository.expirePending('2026-11-05T16:00:00.000Z');
      assert.equal(present((await repository.find('booked'))).status, 'expired');
      assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { db.sqlite.close(); }
  });
}
