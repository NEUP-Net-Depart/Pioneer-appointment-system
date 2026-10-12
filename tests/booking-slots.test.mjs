import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookingDates, availableSlots, slotAvailability } from '../shared/booking-slots.js';

test('booking dates preserve the four-day Shanghai window and Monday to Thursday service', () => {
  assert.deepEqual(bookingDates(new Date('2026-10-12T10:00:00+08:00')), ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']);
  assert.deepEqual(bookingDates(new Date('2026-10-15T10:00:00+08:00')), ['2026-10-15']);
  assert.deepEqual(bookingDates(new Date('2026-10-16T10:00:00+08:00')), ['2026-10-19']);
  assert.deepEqual(bookingDates(new Date('2026-10-18T23:30:00Z')), ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22']);
});

test('slots disappear at their existing end deadline, and fully ended days disappear', () => {
  assert.deepEqual(availableSlots('2026-10-12', new Date('2026-10-12T19:59:59+08:00')), ['19:00–20:00', '20:00–21:00']);
  assert.deepEqual(availableSlots('2026-10-12', new Date('2026-10-12T20:00:00+08:00')), ['20:00–21:00']);
  assert.deepEqual(availableSlots('2026-10-12', new Date('2026-10-12T21:00:00+08:00')), []);
  assert.deepEqual(bookingDates(new Date('2026-10-15T21:00:00+08:00')), []);
});

test('availability distinguishes open, paused, full, overbooked and expired slots', () => {
  const date = '2026-10-12', slot = '19:00–20:00', now = new Date(`${date}T12:00:00+08:00`);
  const summary = (capacity, occupied) => ({ slotCapacities: { [slot]: capacity }, slots: { [slot]: occupied } });
  assert.deepEqual(slotAvailability(summary(10, 3), date, slot, now), { capacity: 10, remaining: 7, ended: false, disabled: false, label: '剩余 7 名' });
  assert.equal(slotAvailability(summary(0, 0), date, slot, now).label, '暂停预约');
  assert.equal(slotAvailability(summary(3, 3), date, slot, now).label, '预约已满');
  assert.equal(slotAvailability(summary(3, 5), date, slot, now).remaining, 0);
  assert.equal(slotAvailability(summary(10, 0), date, slot, new Date(`${date}T20:00:00+08:00`)).disabled, true);
});
