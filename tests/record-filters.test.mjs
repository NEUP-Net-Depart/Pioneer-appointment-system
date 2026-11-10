import test from 'node:test';
import assert from 'node:assert/strict';
import { recordServiceDate } from '../shared/record-filters.js';
import { database } from './helpers/database.mjs';
import { appointmentRepository } from '../src/db/appointments.js';
import { appointmentService } from '../src/services/appointments.js';

test('record defaults choose today when service is scheduled, including full and ended slots', () => {
  assert.equal(recordServiceDate({ items: [{ date: '2026-11-09', capacity: 3, remaining: 0, ended: true }, { date: '2026-11-10', capacity: 2 }] }, '2026-11-09'), '2026-11-09');
});

test('overview finds the next service beyond the display window, respecting campus scope and zero snapshots', async () => {
  const db = database();
  try {
    const repository = appointmentRepository(db);
    const campusId = db.sqlite.prepare("SELECT id FROM campuses WHERE name='南湖'").get().id;
    for (const date of ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']) {
      db.sqlite.prepare("INSERT INTO service_day_overrides(business_date,campus_id,paused,reason,revision,updated_at) VALUES(?,?,1,'停服',0,'2026-11-08')").run(date, campusId);
    }
    db.sqlite.prepare("INSERT INTO booking_day_slots(campus,date,time_slot,capacity) VALUES('南湖','2026-11-16','19:00–19:30',0)").run();
    const data = await repository.overview('2026-11-08', '2026-11-14', ['南湖']);
    assert.equal(data.nextServiceDate, '2026-11-17');
    assert.equal((await repository.overview('2026-11-08', '2026-11-14', ['浑南'])).nextServiceDate, '2026-11-09');
    assert.equal((await repository.overview('2026-11-08', '2026-11-14', [])).nextServiceDate, null);
    const service = appointmentService(repository, {}, '', () => new Date('2026-11-08T04:00:00Z'), { scopedActor: async (actor) => actor });
    const overview = await service.overview({ account: 'staff', role: 'technician', status: 'enabled', authorizedCampuses: ['南湖'] });
    assert.equal(recordServiceDate(overview, '2026-11-08'), '2026-11-17');
    assert.ok(overview.dates.includes('2026-11-17'));
    assert.ok(overview.items.some((row) => row.date === '2026-11-17' && row.capacity > 0));
    db.sqlite.exec('UPDATE weekday_slot_capacities SET capacity=0');
    assert.equal((await repository.overview('2026-11-08', '2026-11-14', ['南湖'])).nextServiceDate, null);
  } finally { db.sqlite.close(); }
});

test('record defaults skip suspended and zero-capacity days but keep another campus serving today', () => {
  const items = [{ date: '2026-11-08', capacity: 3 }, { date: '2026-11-09', capacity: 3, paused: true }, { date: '2026-11-10', capacity: 0 }, { date: '2026-11-12', capacity: 3 }, { date: '2026-11-11', capacity: 2 }];
  assert.equal(recordServiceDate({ items }, '2026-11-09'), '2026-11-11');
  assert.equal(recordServiceDate({ items: [...items, { date: '2026-11-09', capacity: 1 }] }, '2026-11-09'), '2026-11-09');
  assert.equal(recordServiceDate({ items: [] }, '2026-11-09'), null);
});
