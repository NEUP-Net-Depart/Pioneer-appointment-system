import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('G0 migration is a single replayable baseline for scan expiration and weekday half-hour schedules', async () => {
  const sql = await readFile('migrations/0007_staff_platform.sql', 'utf8');
  assert.match(sql, /G0 unified baseline/);
  assert.match(sql, /outcome='expired'/);
  assert.match(sql, /CREATE TABLE weekday_slot_capacities/);
  assert.match(sql, /CREATE TABLE booking_day_slots/);
  for (const slot of ['19:00–19:30', '19:30–20:00', '20:00–20:30', '20:30–21:00']) assert.match(sql, new RegExp(slot));
  assert.match(sql, /idx_one_pending_onsite_registration/);
});
