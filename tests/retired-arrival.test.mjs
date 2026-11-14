import test from 'node:test';
import assert from 'node:assert/strict';
import { staffPlatformRoutes } from '../src/routes/staff-platform.js';

test('retired arrival endpoint authenticates and rejects without calling attendance writes', async () => {
  const route = staffPlatformRoutes.find(([method, path]) => method === 'POST' && path.test('/api/attendance/arrivals'));
  let authenticated = false;
  await assert.rejects(route[2]({
    role: async role => { assert.equal(role, 'technician'); authenticated = true; return {}; },
    services: { staffPlatform: { confirmArrival: () => assert.fail('Retired route must not write attendance') } }
  }), error => error.status === 410 && error.message.includes('本人签到'));
  assert.equal(authenticated, true);
});

test('retired review endpoint cannot manually override automatic absence', async () => {
  const route = staffPlatformRoutes.find(([method, path]) => method === 'PUT' && path.test('/api/attendance/reviews'));
  await assert.rejects(route[2]({ role: async () => ({}), services: { staffPlatform: { reviewAttendance: () => assert.fail('Retired review must not write') } } }), error => error.status === 410);
});
