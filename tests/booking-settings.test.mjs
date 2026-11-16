import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bookingWindow, validReleaseTime } from '../shared/booking-settings.js';
import { bookingDates } from '../shared/booking-slots.js';
import { database, seedStaff } from './helpers/database.mjs';
import { userRepository } from '../src/db/users.js';
import { signToken } from '../src/lib/jwt.js';
import { handleRequest } from '../src/app.js';

test('booking configuration APIs share the leadership campus boundary through actual database writes', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-09T03:00:00Z') });
  const db = database();
  t.after(() => db.sqlite.close());
  for (const account of ['20261001','20261002','20261003']) seedStaff(db, account);
  db.sqlite.exec(`INSERT INTO staff_campus_grants VALUES('20261001','浑南');
    INSERT INTO member_department_memberships(id,member_id,department_id,position_code,assignment_type,is_primary,effective_from,created_at)
      VALUES('booking-leader','member-20261001','dept-network','deputy_head','primary',1,'2026-01-01','2026-01-01');
    INSERT INTO member_roles(id,member_id,role_id,effective_from) VALUES('settings-only','member-20261003','role-superadmin','2026-01-01');`);
  const users = userRepository(db);
  const env = { DB: { withSession: () => db }, ATTACHMENTS: {}, JWT_SECRET: 'booking-test-secret'.repeat(2), PII_ENCRYPTION_KEY: '00'.repeat(32) };
  async function api(account, path, body, method = body ? 'PATCH' : 'GET') {
    const actor = await users.find(account);
    const response = await handleRequest(new Request(`https://app.test/api/${path}`, {
      method, headers: { Authorization: `Bearer ${signToken(actor, env.JWT_SECRET)}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    }), env);
    return { status: response.status, body: await response.json() };
  }
  const profile = (await api('20261001','auth/me')).body;
  assert.ok(!profile.permissions['settings.manage']);
  const settingsOnly = (await api('20261003','auth/me')).body;
  assert.equal(settingsOnly.permissions['settings.manage'], true);
  assert.equal(settingsOnly.permissions['booking.manage'], false);
  const capacities = await api('20261001','slot-capacities');
  assert.equal(capacities.status, 200);
  assert.deepEqual([...new Set(capacities.body.items.map(item => item.campus))], ['南湖']);
  const locations = await api('20261001','service-locations?dateFrom=2026-11-10&dateTo=2026-11-10');
  assert.equal(locations.status, 200);
  assert.deepEqual(locations.body.campuses, ['南湖']);
  for (const campus of ['南湖','浑南']) {
    for (const path of [
      `booking-settings/manage?campus=${campus}`,
      `slot-capacities/actual?campus=${campus}&date=2026-11-10`,
      `service-days?campus=${campus}&date=2026-11-10`,
      `service-locations/history?campus=${campus}&date=2026-11-10`
    ]) assert.equal((await api('20261001',path)).status, campus === '南湖' ? 200 : 403, path);
  }
  const capacity = capacities.body.items[0];
  const changes = [
    ['slot-capacities', campus => ({ ...capacity, campus, capacity: 7 })],
    ['booking-settings', campus => ({ campus, releaseTime: '09:30', revision: 0, requestId: crypto.randomUUID() })],
    ['booking-notices', campus => ({ campus, id: crypto.randomUUID(), revision: -1, requestId: crypto.randomUUID(),
      title: '维修公告', content: '预约配置权限验证', important: false, enabled: true, displayMode: 'inline',
      startsAt: '2026-11-09T00:00:00Z', endsAt: '2026-11-12T00:00:00Z' })],
    ['service-days', campus => ({ requestId: crypto.randomUUID(), items: [{ campusId: campus === '南湖' ? 'campus-nanhu' : 'campus-hunnan',
      businessDate: '2026-11-10', paused: true, reason: '测试暂停', revision: -1 }] })],
    ['service-locations', campus => ({ campus, date: '2026-11-10', location: '新维修地点', revision: 0 })]
  ];
  for (const [path, input] of changes) {
    for (const account of ['20261002','20261003'])
      assert.equal((await api(account,path,input('南湖'))).status, 403, `${account}: ${path}`);
    assert.equal((await api('20261001',path,input('浑南'))).status, 403, path);
    const saved = await api('20261001',path,input('南湖'));
    assert.equal(saved.status, 200, `${path}: ${JSON.stringify(saved.body)}`);
  }
  assert.equal(db.sqlite.prepare('SELECT capacity FROM weekday_slot_capacities WHERE campus=? AND weekday=? AND time_slot=?').get('南湖',capacity.weekday,capacity.timeSlot).capacity, 7);
  const saved = (await api('20261001','booking-settings/manage?campus=南湖')).body;
  assert.equal(saved.settings.releaseTime, '09:30');
  assert.ok(saved.notices.some(item => item.title === '维修公告'));
  assert.ok(saved.suspensions.some(item => item.businessDate === '2026-11-10'));
  assert.equal(db.sqlite.prepare("SELECT location FROM service_locations WHERE campus='南湖' AND date='2026-11-10'").get().location, '新维修地点');
  db.sqlite.exec("UPDATE member_department_memberships SET effective_to='2026-11-09' WHERE id='booking-leader'");
  assert.equal((await api('20261001','auth/me')).body.permissions['booking.manage'], false);
  assert.equal((await api('20261001','slot-capacities')).status, 403);
  assert.equal((await api('20261001','booking-settings',changes[1][1]('南湖'))).status, 403);
});

test('release time advances only the booking horizon, with midnight and Shanghai boundaries', () => {
  assert.deepEqual(bookingDates(new Date('2026-10-12T09:59:59+08:00')), ['2026-10-12','2026-10-13','2026-10-14']);
  assert.deepEqual(bookingDates(new Date('2026-10-12T10:00:00+08:00')), ['2026-10-12','2026-10-13','2026-10-14','2026-10-15']);
  assert.deepEqual(bookingDates(new Date('2026-10-12T10:00:00+08:00'),'11:30'), ['2026-10-12','2026-10-13','2026-10-14']);
  assert.deepEqual(bookingDates(new Date('2026-10-12T00:00:00+08:00'),'00:00'), ['2026-10-12','2026-10-13','2026-10-14','2026-10-15']);
  assert.deepEqual(bookingDates(new Date('2026-10-16T09:59:59+08:00')), []);
  assert.deepEqual(bookingDates(new Date('2026-10-16T10:00:00+08:00')), ['2026-10-19']);
  assert.deepEqual(bookingDates(new Date('2026-10-18T16:00:00Z')), ['2026-10-19','2026-10-20','2026-10-21']);
  assert.equal(bookingWindow(new Date('2026-12-31T09:59:59+08:00')).end,'2027-01-02');
  assert.equal(bookingWindow(new Date('2026-12-31T10:00:00+08:00')).nextReleaseAt,'2027-01-01T02:00:00.000Z');
  for(const value of ['24:00','10:60','1:00',null,'10:00:00']) assert.equal(validReleaseTime(value),false);
});
