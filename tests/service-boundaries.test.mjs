import { test } from 'node:test';
import assert from 'node:assert/strict';

import { database, seedAppointment } from './helpers/database.mjs';

import { presentAppointment } from '../src/services/appointments.js';
import { appointmentRepository } from '../src/db/appointments.js';

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
