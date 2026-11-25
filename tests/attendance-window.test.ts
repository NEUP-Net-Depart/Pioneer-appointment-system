import { HttpError } from '../src/lib/http.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {staffPlatformService} from '../src/services/staff-platform.ts';
import { appointmentRepository } from '../src/db/appointments.ts';
import { staffPlatformRepository } from '../src/db/staff-platform.ts';
import { composeStaffPlatform } from '../src/app/compose.ts';
import { database } from './helpers/database.ts';
import { staffActor } from './fixtures/staff-services.ts';

const actor = staffActor({ account: 'root001', memberId: 'member-root001', role: 'superadmin' });
const validEvent = {id:'window-event',type:'duty',businessDate:'2026-10-20',campusId:'campus-nanhu',
  startsAt:'2026-10-20T18:30:00+08:00',endsAt:'2026-10-20T21:30:00+08:00'};

function setup(t: import('node:test').TestContext) {
  const db = database();
  t.after(() => db.sqlite.close());
  db.sqlite.exec(`INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at,protected)
    VALUES('root001','测试管理员','superadmin','南湖','test','2026-01-01',1);
    INSERT INTO staff_campus_grants VALUES('root001','南湖');`);
  const repository = staffPlatformRepository(db);
  const writes: Parameters<typeof repository.createEvent>[0][] = [];
  repository.createEvent = async value => {
    writes.push(value);
    return { ...value, id: validEvent.id, ruleSnapshot: {}, sourceRef: {}, revision: 0, createdAt: value.startsAt };
  };
  const platform = composeStaffPlatform({ repository, repairs: appointmentRepository(db) });
  return { service: staffPlatformService({ repository, platform, manifests: platform.manifests }), writes };
}

test('duty creation matches the Shanghai business date without imposing a new duration limit', async (t) => {
  const {service,writes} = setup(t);
  for (const input of [
    {...validEvent,businessDate:'2026-10-12',startsAt:'2026-10-12T18:30:00+08:00',endsAt:'2026-10-20T23:00:00+08:00'},
    {...validEvent,businessDate:'2026-10-19'},
    {...validEvent,startsAt:'2026-10-20T23:00:00+08:00',endsAt:'2026-10-21T01:00:00+08:00'}
  ]) await assert.rejects(service.createAttendanceEvent(actor,input),error => error instanceof HttpError && error.status === 400);
  assert.equal(writes.length,0);
  const created = await service.createAttendanceEvent(actor,{...validEvent,startsAt:'2026-10-20T00:00:00+08:00',endsAt:'2026-10-20T23:59:59+08:00'});
  assert.equal(created.businessDate,'2026-10-20');
  assert.equal(writes.length,1,'existing same-day windows remain valid');
  const early = await service.createAttendanceEvent(actor,{...validEvent,startsAt:'2026-10-19T16:30:00Z',endsAt:'2026-10-19T18:30:00Z'});
  assert.equal(early.businessDate,'2026-10-20');
  await service.createAttendanceEvent(actor,{...validEvent,type:'meeting',endsAt:'2026-10-21T01:00:00+08:00'});
  assert.equal(writes.length,3,'meeting attendance keeps its own event policy');
});
