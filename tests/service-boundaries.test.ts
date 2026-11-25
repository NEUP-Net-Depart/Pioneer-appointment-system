import { present } from './helpers/present.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { database, seedAppointment } from './helpers/database.ts';

import { presentAppointment } from '../src/services/appointments.ts';
import { appointmentRepository } from '../src/db/appointments.ts';

test('customer projection excludes internal notes, staff identifiers, and nested operation facts', async () => {
  const db = database();
  try {
    seedAppointment(db, { id: 'history', status: 'completed', repair_note: '内部说明' });
    const repository = appointmentRepository(db);
    const item = await repository.find('history');
    const record = { ...present(item), unknownInternalField: 'secret' };
    const customer = await presentAppointment(record, '00'.repeat(32));
    assert.equal(customer.outcome, 'unrepaired');
    for (const field of ['repairNote','assignedTo','assignedMemberId','registeredBy','unknownInternalField'])
      assert.equal(Object.hasOwn(customer, field), false, field);
    const history = await repository.repairHistory(present(item).id);
    assert.equal(Object.hasOwn(history, 'events'), false);
    assert.equal(Object.hasOwn(history.items[0], 'repairNote'), false);
    const internal = await repository.repairHistory(present(item).id, { staff: true });
    assert.equal(internal.items[0].repairNote, '内部说明');
  } finally { db.sqlite.close(); }
});
