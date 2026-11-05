import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, seedAppointment } from './helpers/database.mjs';
import { expirationDeadline } from '../shared/time.js';
import { presentAppointment } from '../src/services/appointments.js';
import { appointmentRepository } from '../src/db/appointments.js';

for (const directory of ['migrations','database/staff-migrations']) {
  test(`${directory}: day migration preserves terminal history and expires only at next Shanghai day`, async () => {
    const db = database(directory, '0044_');
    try {
      for (const status of ['booked','completed','cancelled','expired'])
        seedAppointment(db, { id: status, status, repair_note: '历史内部说明' });
      const before = db.sqlite.prepare('SELECT * FROM appointments ORDER BY id').all();
      db.sqlite.exec(readFileSync(`${directory}/0044_appointment_day.sql`, 'utf8'));
      const after = db.sqlite.prepare('SELECT * FROM appointments ORDER BY id').all();
      assert.deepEqual(after.filter(row => row.status !== 'booked'), before.filter(row => row.status !== 'booked'));
      assert.equal(after.find(row => row.id === 'booked').expires_at, '2026-11-05T16:00:00.000Z');
      assert.equal(expirationDeadline('2026-12-31'), '2026-12-31T16:00:00.000Z');
      const repository = appointmentRepository(db);
      await repository.expirePending('2026-11-05T15:59:59.999Z');
      assert.equal((await repository.find('booked')).status, 'booked');
      await repository.expirePending('2026-11-05T16:00:00.000Z');
      assert.equal((await repository.find('booked')).status, 'expired');
      assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { db.sqlite.close(); }
  });
}

test('customer projection excludes internal notes, staff identifiers, and nested operation facts', async () => {
  const db = database();
  try {
    seedAppointment(db, { id: 'history', status: 'completed', repair_note: '内部说明' });
    const repository = appointmentRepository(db);
    const item = await repository.find('history');
    const customer = await presentAppointment({ ...item, unknownInternalField: 'secret' }, '00'.repeat(32));
    assert.equal(customer.outcome, 'unrepaired');
    for (const field of ['repairNote','assignedTo','assignedMemberId','registeredBy','unknownInternalField'])
      assert.equal(Object.hasOwn(customer, field), false, field);
    const history = await repository.repairHistory(item.id);
    assert.equal(Object.hasOwn(history, 'events'), false);
    assert.equal(Object.hasOwn(history.items[0], 'repairNote'), false);
    const internal = await repository.repairHistory(item.id, { staff: true });
    assert.equal(internal.items[0].repairNote, '内部说明');
  } finally { db.sqlite.close(); }
});
