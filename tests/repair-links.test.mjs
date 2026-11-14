import { signatureFixture } from './fixtures/signature.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

import {repairScenario} from './fixtures/repair-scenario.mjs';
import {addDays} from '../shared/time.js';
const request=(values)=>({revision:0,requestId:crypto.randomUUID(),sameDeviceAndFault:true,linkKind:'continuation',...values});

test('repair-induced links require a separate confirmation and retain the original result', async t => {
  const {db, users, repo, service, order, calendar} = repairScenario(t, {studentId:'20260009'});
  const actor = await users.find('20260001');
  order('original', {date:calendar.previousServiceDay, status:'completed', repair_note:'原故障已解决'});
  order('new-fault');
  const before = await repo.find('original');
  const input = request({parentAppointmentId:'original', linkKind:'repair_induced'});
  await assert.rejects(service.link('new-fault', input, actor), {status:400});
  const linked = await service.link('new-fault', {...input, sameDeviceAndRepairRelated:true}, actor);
  assert.equal(linked.linkKind, 'repair_induced');
  assert.equal(linked.parentAppointmentId, 'original');
  assert.deepEqual(await repo.find('original'), before);
  const event = db.sqlite.prepare("SELECT after_json FROM audit_events WHERE action='repairs.linked'").get();
  assert.equal(JSON.parse(event.after_json).linkKind, 'repair_induced');
});

test('onsite repair-induced service requires confirmation and preserves idempotency', async t => {
  const {users, scan, order, calendar} = repairScenario(t, {studentId:'20260009'});
  const actor = await users.find('20260001');
  order('original', {status:'completed'});
  calendar.moveTo(calendar.nextDay, '10:00');
  const input = {studentId:'20260009',name:'测试客户',campus:'南湖',social:'customer-contact',deviceType:'笔记本',brand:'Lenovo',deviceModel:'',warranty:'不清楚',faultType:'系统',agreement:true,signature:signatureFixture(),requestId:crypto.randomUUID(),parentAppointmentId:'original',linkKind:'repair_induced',sameDeviceAndFault:true};
  await assert.rejects(scan.onsite(input, actor), {status:409});
  const accepted = {...input, requestId:crypto.randomUUID(), sameDeviceAndRepairRelated:true};
  const linked = await scan.onsite(accepted, actor);
  assert.equal(linked.linkKind, 'repair_induced');
  assert.equal(linked.parentAppointmentId, 'original');
  assert.equal((await scan.onsite(accepted, actor)).id, linked.id);
});

test('linking an existing booking preserves its capacity, original result, and student privacy; campuses remain scoped',async t=>{
  const {db,users,repo,staff,service,order,calendar}=repairScenario(t,{studentId:'20260009'});
  const actor=await users.find('20260001');
  order('original',{date:calendar.previousServiceDay,status:'completed',repair_note:'internal original',assigned_to:'20260001'});
  const token='A'.repeat(43);order('return',{access_token_hash:createHash('sha256').update(token).digest('hex')});order('other-campus',{date:addDays(calendar.previousServiceDay,-7),status:'completed',campus:'浑南',repair_note:'hidden campus note'});
  const before=await repo.find('original'),n=db.sqlite.prepare('SELECT COUNT(*) n FROM appointments').get().n;
  await assert.rejects(service.link('return',request({parentAppointmentId:'original',sameDeviceAndFault:false}),actor),{status:400});
  await assert.rejects(service.link('return',request({parentAppointmentId:'other-campus'}),actor),{status:403});
  const linked=await service.link('return',request({parentAppointmentId:'original'}),actor);
  assert.equal(linked.source,'booking');assert.equal(linked.parentAppointmentId,'original');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM appointments').get().n,n);
  assert.deepEqual(await repo.find('original'),before);
  await assert.rejects(service.link('return',request({revision:1,parentAppointmentId:'original'}),actor),{status:409});
  const publicItem=await service.lookup('return',token);
  assert.equal(publicItem.repairHistory.items.length,2);
  assert.equal(Object.hasOwn(publicItem.repairHistory,'events'),false);
  assert.ok(publicItem.repairHistory.items.every(row=>!Object.hasOwn(row,'repairNote') && !Object.hasOwn(row,'assignedToName')));
  const detail=await staff.field.detail(actor,'return');
  assert.ok((await repo.repairHistory('return',{staff:true,campuses:actor.authorizedCampuses})).events.some(row=>row.action==='repairs.linked'));
  assert.equal(detail.customerHistory.some(row=>row.id==='other-campus'),false);
  await assert.rejects(service.link('return',request({revision:1,parentAppointmentId:'original'}),await users.find('20260003')),{status:403});
});

test('onsite linked service is created once, does not consume online slots, and requires new receipt evidence',async t=>{
  const {db,users,scan,order,calendar}=repairScenario(t,{studentId:'20260009'});
  const actor=await users.find('20260001');order('original',{status:'completed'});
  db.sqlite.exec('UPDATE slot_capacities SET capacity=0; UPDATE weekday_slot_capacities SET capacity=0;');
  calendar.moveTo(calendar.nextDay,'10:00');
  const input={studentId:'20260009',name:'测试客户',campus:'南湖',social:'customer-contact',deviceType:'笔记本',brand:'Lenovo',deviceModel:'',warranty:'不清楚',faultType:'系统',agreement:true,signature:signatureFixture(),requestId:crypto.randomUUID(),parentAppointmentId:'original',linkKind:'recurrence',sameDeviceAndFault:true};
  const created=await scan.onsite(input,actor),again=await scan.onsite(input,actor);
  assert.equal(again.id,created.id);assert.equal(again.accessToken,created.accessToken);
  assert.equal(created.source,'onsite');assert.equal(created.parentAppointmentId,'original');
  assert.equal(created.date,calendar.nextDay);
  assert.equal(created.receivedAt,'');assert.equal(created.frontPhotoId,null);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM appointments').get().n,2);
  const denied={...input,requestId:crypto.randomUUID(),studentId:'20268888'};
  await assert.rejects(scan.onsite(denied,actor),{status:409});
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM appointments').get().n,2);
});

test('information edits preserve repair responsibility and encrypt contact history',async t=>{
  const {db,users,repo,service,order}=repairScenario(t,{studentId:'20260009'});
  const actor=await users.find('20260001');order('edit',{status:'in_progress',assigned_to:'20260001',social:'old-private-contact'});
  const item=await service.edit('edit',request({social:'new-private-contact',faultType:'屏幕',deviceModel:''}),actor);
  assert.equal(item.social,'new-private-contact');assert.equal(item.assignedMemberId,actor.memberId);
  assert.equal(item.status,'in_progress');assert.equal(item.faultType,'屏幕');
  const audit=db.sqlite.prepare("SELECT before_json,after_json FROM audit_events WHERE action='repairs.information.updated'").get();
  assert.ok(!JSON.stringify(audit).includes('private-contact'));
  assert.ok(!(await repo.find('edit')).social.includes('private-contact'));
});
