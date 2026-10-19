import test from 'node:test';
import assert from 'node:assert/strict';
import {appointmentService} from '../src/services/appointments.js';
import {fieldWorkflow} from '../src/services/field-workflow.js';
import {createAuthorizer} from '../src/modules/authorization/public.js';

test('workflow search facets share text, status, date and object/identity visibility rules', async () => {
  const actor = {account:'list-manager',role:'admin',status:'enabled',authorizedCampuses:['南湖']};
  const rows = [
    ['booked','booked'],['repair','in_progress'],['completed','completed'],['cancelled','cancelled'],
    ['hidden','completed'],['redacted','completed'],['other-date','completed'],['other-slot','completed']
  ].map(([id,status]) => ({id,status,campus:'南湖',date:id==='other-date'?'2026-10-19':'2026-10-20',
    timeSlot:id==='other-slot'?'20:00–20:30':'19:00–19:30',name:'同名学生',studentId:'20269999',deviceModel:'ThinkPad'}));
  const visibleIds = rows.filter(row => row.id!=='hidden').map(row => row.id);
  const context = {actor:{memberId:'manager'},grants:[
    {permissionCode:'repair.summary.read',scope:{campusIds:['campus-nanhu'],objectIds:visibleIds}},
    {permissionCode:'customer.identity.read',scope:{campusIds:['campus-nanhu'],objectIds:visibleIds.filter(id => id!=='redacted')}}
  ]};
  const queries = [];
  const repository = {
    expirePending:async () => {},
    list:async query => {
      queries.push(query);
      return {items:rows.filter(row => row.date===query.date && row.timeSlot===query.timeSlot &&
        (query.status==='all' || row.status===query.status)),counts:{all:rows.length},filteredCounts:{all:rows.length,completed:5}};
    }
  };
  const staff = {scopedActor:async value => value,contextFor:async () => context};
  staff.field = fieldWorkflow({staff,appointments:repository,authorizer:createAuthorizer(),enabled:true});
  const service = appointmentService(repository,{},'',() => new Date('2026-10-20T10:00:00Z'),staff);
  const expected = {all:4,booked:1,in_progress:1,completed:1,cancelled:1,expired:0};
  for (const q of ['同名学生','20269999']) for (const status of ['all','pending','completed','expired']) {
    const result = await service.list({q,status,date:'2026-10-20',timeSlot:'19:00–19:30'},actor);
    assert.deepEqual(result.filteredCounts,expected,`${q}, ${status}: facets precede status selection`);
    assert.deepEqual(result.items.map(row => row.id),status==='all'?['booked','repair','completed','cancelled']:status==='pending'?['booked','repair']:status==='completed'?['completed']:[]);
    assert.ok(result.items.every(row => row.name==='同名学生'));
  }
  const model = await service.list({q:'THINKPAD',status:'all',date:'2026-10-20',timeSlot:'19:00–19:30'},actor);
  assert.equal(model.filteredCounts.all,5,'a visible summary may match its device model without revealing identity');
  assert.equal(model.items.find(row => row.id==='redacted').name,undefined);
  const empty = await service.list({q:'no match',status:'all',date:'2026-10-20',timeSlot:'19:00–19:30'},actor);
  assert.deepEqual(empty.filteredCounts,{all:0,booked:0,in_progress:0,completed:0,cancelled:0,expired:0});
  assert.ok(queries.every(query => query.q==='' && query.status==='all'));
});
