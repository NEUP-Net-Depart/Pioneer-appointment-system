import test from 'node:test';
import assert from 'node:assert/strict';
import { database, seedStaff, seedAppointment } from './helpers/database.mjs';
import { staffPlatformRepository } from '../src/db/staff-platform.js';

test('workload counts distinct handled orders across campuses and the first handover month', async (t) => {
  const db = database();
  t.after(() => db.sqlite.close());
  for (const account of ['20261001', '20261002', '20261003']) seedStaff(db, account);
  const event = (account, id, action, at) => db.sqlite.prepare(
    'INSERT INTO audit_events(id,actor_member_id,actor_account,action,source_ref,occurred_at) VALUES(?,?,?,?,?,?)'
  ).run(crypto.randomUUID(), `member-${account}`, account, action,
    JSON.stringify({ module: 'repairs', type: 'appointment', id }), at);
  seedAppointment(db, { id: 'shared', status: 'in_progress', assigned_to: '20261002', started_at: '2026-10-31T15:59:59Z' });
  event('20261001', 'shared', 'repairs.started', '2026-10-31T15:59:59Z');
  event('20261002', 'shared', 'repairs.transferred', '2026-11-01T10:00:00Z');
  event('20261001', 'shared', 'repairs.transferred', '2026-11-02T10:00:00Z');
  event('20261002', 'shared', 'repairs.transferred', '2026-11-03T10:00:00Z');
  seedAppointment(db, { id: 'other-campus', campus: '浑南', status: 'completed', assigned_to: '20261001', started_at: '2026-10-31T16:00:00Z' });
  event('20261001', 'other-campus', 'repairs.started', '2026-10-31T16:00:00.000Z');
  event('20261001', 'other-campus', 'repairs.started', '2026-10-31T16:00:00.000Z');
  seedAppointment(db, { id: 'legacy', status: 'completed', assigned_to: '20261001', started_at: '2026-11-04T10:00:00Z' });
  seedAppointment(db, { id: 'received-only', received_by: '20261001', received_at: '2026-11-04T10:00:00Z' });
  event('20261001', 'received-only', 'repairs.received', '2026-11-04T10:00:00Z');
  seedAppointment(db, { id: 'future', status: 'in_progress', assigned_to: '20261001', started_at: '2026-12-01T10:00:00Z' });
  event('20261001', 'future', 'repairs.started', '2026-12-01T10:00:00Z');
  db.sqlite.prepare("UPDATE staff_accounts SET status='disabled' WHERE account='20261001'").run();
  const result = await staffPlatformRepository(db).memberRepairWorkload(
    ['member-20261001', 'member-20261002', 'member-20261003'],
    '2026-10-31T16:00:00.000Z', '2026-11-09T11:10:00.000Z'
  );
  assert.deepEqual(result.map((row) => ({ ...row })), [
    { memberId: 'member-20261001', total: 3, monthly: 2 },
    { memberId: 'member-20261002', total: 1, monthly: 1 },
    { memberId: 'member-20261003', total: 0, monthly: 0 }
  ]);
});
