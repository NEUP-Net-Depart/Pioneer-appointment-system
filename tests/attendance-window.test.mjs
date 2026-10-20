import test from 'node:test';
import assert from 'node:assert/strict';
import {staffPlatformService} from '../src/services/staff-platform.js';
import {createAuthorizer} from '../src/modules/authorization/public.js';

const actor = {account:'window-manager',memberId:'manager',role:'superadmin',authorizedCampuses:['南湖']};
const validEvent = {id:'window-event',type:'duty',businessDate:'2026-10-20',campusId:'campus-nanhu',
  startsAt:'2026-10-20T18:30:00+08:00',endsAt:'2026-10-20T21:30:00+08:00'};

function setup(event = {...validEvent}) {
  const writes = [];
  const context = {actor:{memberId:actor.memberId},grants:['attendance.self','attendance.session.manage'].map(permissionCode => ({permissionCode,scope:{all:true}})),memberships:[],todayDuties:[]};
  const repository = {
    createEvent:async value => {writes.push(value);return {...value,id:event.id};},
    findEventByToken:async () => ({event,token:{id:'valid-token'}}),
    dutyEvent:async () => event,serviceDay:async () => null,
    findAttendanceByDedupe:async () => null,
    insertAttendance:async value => {writes.push(value);return value;}
  };
  const platform = {authorizer:createAuthorizer(),authContext:async () => context};
  return {service:staffPlatformService({repository,platform,manifests:[]}),writes};
}

test('duty creation matches the Shanghai business date without imposing a new duration limit', async () => {
  const {service,writes} = setup();
  for (const input of [
    {...validEvent,businessDate:'2026-10-12',startsAt:'2026-10-12T18:30:00+08:00',endsAt:'2026-10-20T23:00:00+08:00'},
    {...validEvent,businessDate:'2026-10-19'},
    {...validEvent,startsAt:'2026-10-20T23:00:00+08:00',endsAt:'2026-10-21T01:00:00+08:00'}
  ]) await assert.rejects(service.createAttendanceEvent(actor,input),error => error.status === 400);
  assert.equal(writes.length,0);
  const created = await service.createAttendanceEvent(actor,{...validEvent,startsAt:'2026-10-20T00:00:00+08:00',endsAt:'2026-10-20T23:59:59+08:00'});
  assert.equal(created.businessDate,'2026-10-20');
  assert.equal(writes.length,1,'existing same-day windows remain valid');
  const early = await service.createAttendanceEvent(actor,{...validEvent,startsAt:'2026-10-19T16:30:00Z',endsAt:'2026-10-19T18:30:00Z'});
  assert.equal(early.businessDate,'2026-10-20');
  await service.createAttendanceEvent(actor,{...validEvent,type:'meeting',endsAt:'2026-10-21T01:00:00+08:00'});
  assert.equal(writes.length,3,'meeting attendance keeps its own event policy');
});

test('preview, QR confirmation and direct confirmation reject malformed existing duty events', async t => {
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-20T20:00:00+08:00')});
  for (const event of [
    {...validEvent,businessDate:'2026-10-12',startsAt:'2026-10-12T18:30:00+08:00'},
    {...validEvent,businessDate:'2026-10-19'},
    {...validEvent,endsAt:'2026-10-21T00:30:00+08:00'}
  ]) {
    const {service,writes} = setup(event);
    for (const action of ['previewAttendance','checkIn']) {
      await assert.rejects(service[action](actor,{token:'valid-token'}),error => error.status === 409);
    }
    await assert.rejects(service.directCheckIn(actor,{campusId:'campus-nanhu'}),error => error.status === 409);
    assert.equal(writes.length,0,'invalid historical events cannot create attendance or presence');
  }
  const {service,writes} = setup();
  await service.previewAttendance(actor,{token:'valid-token'});
  assert.equal(writes.length,0);
  const record = await service.checkIn(actor,{token:'valid-token'});
  assert.equal(record.businessDate,'2026-10-20');
  assert.equal(writes.length,1);
});
