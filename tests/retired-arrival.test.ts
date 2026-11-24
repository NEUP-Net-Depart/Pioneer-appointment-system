import { database, testRequestContext } from './helpers/database.ts';
import { staffActor } from './fixtures/staff-services.ts';
import { HttpError } from '../src/lib/http.ts';
import { present } from './helpers/present.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { staffPlatformRoutes } from '../src/routes/staff-platform.ts';

test('retired arrival endpoint authenticates and rejects without calling attendance writes', async (t) => {
  const db = database();
  t.after(() => db.sqlite.close());
  const context = testRequestContext(new Request('https://retired.test'), db);
  const route = staffPlatformRoutes.find(([method, path]) => method === 'POST' && path.test('/api/attendance/arrivals'));
  let authenticated = false;
  await assert.rejects(Promise.resolve(present(route)[2]({
    ...context,
    role: async role => { assert.equal(role, 'technician'); authenticated = true; return staffActor(); },
    services: { ...context.services, staffPlatform: Object.assign(context.services.staffPlatform, { confirmArrival: () => assert.fail('Retired route must not write attendance') }) }
  }, [''])), error => error instanceof HttpError && error.status === 410 && error.message.includes('本人签到'));
  assert.equal(authenticated, true);
});

test('retired review endpoint cannot manually override automatic absence', async (t) => {
  const db = database();
  t.after(() => db.sqlite.close());
  const context = testRequestContext(new Request('https://retired.test'), db);
  const route = staffPlatformRoutes.find(([method, path]) => method === 'PUT' && path.test('/api/attendance/reviews'));
  await assert.rejects(Promise.resolve(present(route)[2]({
    ...context,
    role: async () => staffActor(),
    services: { ...context.services, staffPlatform: Object.assign(context.services.staffPlatform, { reviewAttendance: () => assert.fail('Retired review must not write') }) }
  }, [''])), error => error instanceof HttpError && error.status === 410);
});
