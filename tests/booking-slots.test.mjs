import { checkProperty, runModel } from './fixtures/workflow-seed.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookingDates, availableSlots, slotAvailability } from '../shared/booking-slots.js';

test('booking dates preserve the four-day Shanghai window and Monday to Thursday service', async () => {
  assert.deepEqual(bookingDates(new Date('2026-10-12T10:00:00+08:00')), [
    '2026-10-12',
    '2026-10-13',
    '2026-10-14',
    '2026-10-15'
  ]);
  assert.deepEqual(bookingDates(new Date('2026-10-15T10:00:00+08:00')), ['2026-10-15']);
  assert.deepEqual(bookingDates(new Date('2026-10-16T10:00:00+08:00')), ['2026-10-19']);
  assert.deepEqual(bookingDates(new Date('2026-10-18T23:30:00Z')), [
    '2026-10-19',
    '2026-10-20',
    '2026-10-21'
  ]);
  await checkProperty((fc) =>
    fc.property(
      fc.integer({ min: 0, max: 3650 }),
      fc.integer({ min: 0, max: 86399999 }),
      (day, ms) => {
        const instant = new Date(Date.UTC(2024, 0, 1) + day * 86400000 + ms);
        const today = new Date(instant.getTime() + 8 * 3600000).toISOString().slice(0, 10);
        const dates = bookingDates(instant);
        assert.deepEqual(dates, [...new Set(dates)].sort());
        for (const date of dates) {
          const offset = (Date.parse(date) - Date.parse(today)) / 86400000;
          assert.ok(offset >= 0 && offset <= 3);
          assert.ok([1, 2, 3, 4].includes(new Date(date).getUTCDay()));
        }
      }
    )
  );
});

test('new bookings close when their slot ends; reception retains the whole appointment day', () => {
  assert.deepEqual(availableSlots('2026-10-12', new Date('2026-10-12T19:59:59+08:00')), ['19:30–20:00', '20:00–20:30', '20:30–21:00']);
  assert.deepEqual(availableSlots('2026-10-12', new Date('2026-10-12T20:00:00+08:00')), ['20:00–20:30', '20:30–21:00']);
  assert.deepEqual(availableSlots('2026-10-12', new Date('2026-10-12T20:44:59.999+08:00')), ['20:30–21:00']);
  assert.deepEqual(availableSlots('2026-10-12', new Date('2026-10-12T20:45:00+08:00')), ['20:30–21:00']);
  assert.deepEqual(availableSlots('2026-10-12', new Date('2026-10-12T21:00:00+08:00')), []);
  assert.deepEqual(bookingDates(new Date('2026-10-15T21:00:00+08:00')), []);
  assert.deepEqual(bookingDates(new Date('2026-10-12T21:00:00+08:00')), ['2026-10-13', '2026-10-14', '2026-10-15']);
});

test('availability distinguishes open, paused, full, overbooked and expired slots', async () => {
  const date = '2026-10-12',
    slot = '19:30–20:00',
    now = new Date(`${date}T12:00:00+08:00`);
  const summary = (capacity, occupied) => ({
    slotCapacities: { [slot]: capacity },
    slots: { [slot]: occupied }
  });
  assert.deepEqual(slotAvailability(summary(10, 3), date, slot, now), {
    capacity: 10,
    remaining: 7,
    ended: false,
    disabled: false,
    label: '剩余 7 名'
  });
  assert.equal(slotAvailability(summary(0, 0), date, slot, now).label, '未开放名额');
  assert.equal(slotAvailability(summary(3, 3), date, slot, now).label, '预约已满');
  assert.equal(slotAvailability(summary(3, 5), date, slot, now).remaining, 0);
  assert.equal(
    slotAvailability(summary(10, 0), date, slot, new Date(`${date}T20:00:00+08:00`)).disabled,
    true
  );
  const lastSlot = '20:30–21:00',
    lastSummary = { slotCapacities: { [lastSlot]: 5 }, slots: {} };
  assert.equal(
    slotAvailability(lastSummary, date, lastSlot, new Date(`${date}T20:44:59.999+08:00`)).disabled,
    false
  );
  assert.equal(
    slotAvailability(lastSummary, date, lastSlot, new Date(`${date}T21:00:00+08:00`)).label,
    '时段已结束'
  );
  await capacityModel();
  await checkProperty((fc) =>
    fc.property(
      fc.integer({ min: 0, max: 10000 }),
      fc.integer({ min: 0, max: 10000 }),
      fc.boolean(),
      (capacity, occupied, paused) => {
        const actual = slotAvailability(
          { ...summary(capacity, occupied), paused },
          date,
          slot,
          now
        );
        assert.ok(actual.remaining >= 0 && actual.remaining <= capacity);
        assert.equal(actual.remaining + Math.min(capacity, occupied), capacity);
        assert.equal(actual.disabled, paused || occupied >= capacity);
      }
    )
  );
});

async function capacityModel() {
  const date = '2026-10-12',
    slot = '19:30–20:00';
  const edges = [
    [
      'open',
      'full',
      'FILL',
      (r) => {
        r.occupied = r.capacity;
      }
    ],
    [
      'full',
      'overbooked',
      'LOWER_CAPACITY',
      (r) => {
        r.capacity = r.occupied - 1;
      }
    ],
    [
      'overbooked',
      'open',
      'INCREASE_CAPACITY',
      (r) => {
        r.capacity = r.occupied + 3;
      }
    ],
    [
      'open',
      'paused',
      'PAUSE',
      (r) => {
        r.paused = true;
      }
    ],
    [
      'paused',
      'open',
      'RESUME',
      (r) => {
        r.paused = false;
      }
    ],
    [
      'open',
      'closed',
      'ZERO_CAPACITY',
      (r) => {
        r.capacity = 0;
      }
    ],
    [
      'closed',
      'open',
      'OPEN_CAPACITY',
      (r) => {
        r.capacity = r.occupied + 3;
      }
    ],
    [
      'open',
      'expired',
      'END_SLOT',
      (r) => {
        r.time = '20:00';
      }
    ],
    [
      'open',
      'unlocated',
      'REMOVE_LOCATION',
      (r) => {
        r.location = '';
      }
    ],
    [
      'unlocated',
      'open',
      'RESTORE_LOCATION',
      (r) => {
        r.location = '维修室';
      }
    ]
  ].map(([from, to, event, run]) => ({ from, to, event, run }));
  await runModel({
    name: 'booking-capacity',
    initial: 'open',
    edges,
    random: false,
    setup: async () => ({
      capacity: 3,
      occupied: 0,
      paused: false,
      time: '12:00',
      location: '维修室',
      dispose() {}
    }),
    observe: (r, state) => {
      const actual = slotAvailability(
        {
          slotCapacities: { [slot]: r.capacity },
          slots: { [slot]: r.occupied },
          paused: r.paused,
          location: r.location
        },
        date,
        slot,
        new Date(`${date}T${r.time}:00+08:00`)
      );
      assert.equal(actual.disabled, state !== 'open');
      assert.equal(actual.ended, state === 'expired');
      const labels = {
        full: '预约已满',
        overbooked: '预约已满',
        paused: '暂停维修',
        closed: '未开放名额',
        expired: '时段已结束',
        unlocated: '地点未配置'
      };
      if (state !== 'open') assert.equal(actual.label, labels[state]);
      else assert.ok(actual.remaining > 0);
    }
  });
}
