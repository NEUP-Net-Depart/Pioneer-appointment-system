import { checkProperty } from './fixtures/workflow-seed.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { database, seedAppointment, seedStaff } from './helpers/database.mjs';
import { statsRepository } from '../src/db/stats.js';
import { appointmentRepository } from '../src/db/appointments.js';
import { statsService } from '../src/services/stats.js';
import { addDays } from '../shared/time.js';

test('recent statistics include both date boundaries, exclude future dates, and scope every aggregate', async () => {
  const db = database();
  try {
    seedStaff(db, '20260001');
    const today = '2026-11-06';
    for (const offset of [-30, -29, -7, -6, -1, 0, 1])
      seedAppointment(db, {
        id: `day${offset}`,
        date: addDays(today, offset),
        status: 'completed',
        outcome: 'repaired',
        assigned_to: '20260001',
        source: 'onsite',
        registered_by: '20260001'
      });
    seedAppointment(db, {
      id: 'other-campus',
      date: today,
      campus: '浑南',
      status: 'completed',
      source: 'onsite',
      registered_by: '20260001'
    });
    let instant = new Date('2026-11-05T16:00:00.000Z'); // Shanghai midnight, still November 5 in UTC.
    const actor = { role: 'technician', status: 'enabled', authorizedCampuses: ['南湖'] };
    const service = statsService(statsRepository(db), appointmentRepository(db), () => instant, {
      scopedActor: async (value) => value
    });
    for (const [query, total] of [
      [{ range: '7' }, 3],
      [{ range: '30' }, 5],
      [{ range: 'all' }, 7],
      [{ range: '7', day: addDays(today, 1) }, 1]
    ]) {
      const result = await service.summary(query, actor);
      assert.equal(result.total, total);
      assert.equal(result.completed, total);
      assert.equal(result.repairSuccessRate, 100);
      assert.equal(
        Object.values(result.daily).reduce((n, row) => n + row.total, 0),
        total
      );
      assert.deepEqual(result.campuses, { 南湖: total });
      assert.deepEqual(result.faults, { 系统: total });
      assert.equal(result.technicians['20260001'].started, total);
      assert.equal(result.technicians['20260001'].completed, total);
    }
    instant = new Date('2026-11-05T15:59:59.999Z');
    const beforeMidnight = await service.summary({ range: '7' }, actor);
    assert.deepEqual(Object.keys(beforeMidnight.daily), ['2026-10-30', '2026-10-31', '2026-11-05']);
    instant = new Date('2026-11-05T16:00:00.000Z');
    const afterMidnight = await service.summary({ range: '7' }, actor);
    assert.deepEqual(Object.keys(afterMidnight.daily), ['2026-10-31', '2026-11-05', '2026-11-06']);
  } finally {
    db.sqlite.close();
  }
  await checkProperty(
    (fc) =>
      fc.asyncProperty(
        fc.array(
          fc.record({
            offset: fc.integer({ min: -40, max: 2 }),
            campus: fc.constantFrom('南湖', '浑南')
          }),
          { maxLength: 20 }
        ),
        async (rows) => {
          const generated = database();
          try {
            seedStaff(generated, '20260001');
            rows.forEach((item, index) =>
              seedAppointment(generated, {
                id: `property-${index}`,
                campus: item.campus,
                date: addDays('2026-11-06', item.offset),
                status: 'completed',
                outcome: 'repaired',
                assigned_to: '20260001',
                source: 'onsite',
                registered_by: '20260001'
              })
            );
            const service = statsService(
              statsRepository(generated),
              appointmentRepository(generated),
              () => new Date('2026-11-06T02:00:00Z'),
              { scopedActor: async (actor) => actor }
            );
            const actor = { role: 'technician', status: 'enabled', authorizedCampuses: ['南湖'] };
            for (const days of [7, 30]) {
              const expected = rows.filter(
                (row) => row.campus === '南湖' && row.offset > -days && row.offset <= 0
              ).length;
              const actual = await service.summary({ range: String(days) }, actor);
              assert.equal(actual.total, expected);
              assert.equal(actual.completed, expected);
              assert.equal(
                Object.values(actual.daily).reduce((sum, row) => sum + row.total, 0),
                expected
              );
              assert.ok(!Object.hasOwn(actual.campuses, '浑南'));
            }
          } finally {
            generated.sqlite.close();
          }
        }
      ),
    30
  );
});
