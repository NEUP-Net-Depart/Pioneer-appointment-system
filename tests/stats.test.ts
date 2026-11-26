import { staffActor } from './fixtures/staff-services.ts';
import { checkProperty } from './fixtures/workflow-seed.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { database, seedAppointment, seedStaff } from './helpers/database.ts';
import { statsRepository } from '../src/db/stats.ts';
import { appointmentRepository } from '../src/db/appointments.ts';
import { statsService } from '../src/services/stats.ts';
import { addDays } from '../shared/time.ts';

test('recent statistics include both date boundaries, exclude future dates, and scope every aggregate', async () => {
  const db = database();
  try {
    seedStaff(db, '20260001');
    const today = '2026-11-06';
    const addMembership = db.sqlite.prepare(`
      INSERT INTO member_department_memberships
        (id,member_id,department_id,assignment_type,is_primary,position_code,effective_from,effective_to,created_at)
      VALUES (?,'member-20260001','dept-hardware',?,?,?,?,?,'2026-01-01')
    `);
    addMembership.run('previous', 'primary', 1, 'head', '2026-01-01', today);
    addMembership.run('current', 'primary', 1, 'member', today, null);
    addMembership.run('exchange', 'exchange', 0, 'member', today, null);
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
    const actor = staffActor();
    const service = statsService(statsRepository(db), appointmentRepository(db), () => instant, {
      scopedActor: async (value) => value
    });
    for (const [query, total] of [
      [{ range: '7' }, 3],
      [{ range: '30' }, 5],
      [{ range: 'all' }, 7],
      [{ range: '7', day: addDays(today, 1) }, 1]
    ] as const) {
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
      assert.deepEqual(result.technicians['20260001'], {
        assignedToName: '20260001',
        studentId: '20260001',
        identity: { code: 'member', label: '硬件部部员' },
        started: total,
        completed: total
      });
    }
    instant = new Date('2026-11-05T15:59:59.999Z');
    const beforeMidnight = await service.summary({ range: '7' }, actor);
    assert.deepEqual(Object.keys(beforeMidnight.daily), ['2026-10-30', '2026-10-31', '2026-11-05']);
    assert.deepEqual(beforeMidnight.technicians['20260001'].identity, {
      code: 'head',
      label: '硬件部部长'
    });
    instant = new Date('2026-11-05T16:00:00.000Z');
    const afterMidnight = await service.summary({ range: '7' }, actor);
    assert.deepEqual(Object.keys(afterMidnight.daily), ['2026-10-31', '2026-11-05', '2026-11-06']);
    db.sqlite.prepare("UPDATE member_department_memberships SET effective_to=? WHERE id='current'").run(today);
    db.sqlite.prepare("INSERT INTO member_special_identities VALUES ('member-20260001','retired_elder',?,date('now','+8 hours','+1 year'))").run(instant.toISOString());
    const afterRetirement = await service.summary({ range: '7' }, actor);
    assert.deepEqual(afterRetirement.technicians['20260001'].identity, {
      code: 'retired_elder',
      label: '退休老登'
    });
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
            rows.forEach((item, index: number) =>
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
            const actor = staffActor();
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
