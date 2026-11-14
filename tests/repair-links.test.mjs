import { signatureFixture } from './fixtures/signature.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {database,seedAppointment,seedStaff} from './helpers/database.mjs';
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

for (const directory of ['migrations', 'database/staff-migrations']) test(`${directory}: link expansion preserves populated rows and database guards`, () => {
  const db = database(directory, '0054_');
  try {
    seedStaff(db, '20260001');
    seedAppointment(db, {id:'original',date:'2026-11-02',student_id:'20260009',status:'completed'});
    seedAppointment(db, {id:'existing',date:'2026-11-03',student_id:'20260009',parent_appointment_id:'original',link_kind:'continuation',linked_by:'20260001'});
    const before = db.sqlite.prepare('SELECT * FROM appointments ORDER BY id').all();
    db.sqlite.exec(readFileSync(`${directory}/0054_repair_induced_link.sql`, 'utf8'));
    assert.deepEqual(db.sqlite.prepare('SELECT * FROM appointments ORDER BY id').all(), before);
    seedAppointment(db, {id:'new-fault',student_id:'20260009',parent_appointment_id:'original',link_kind:'repair_induced',linked_by:'20260001'});
    assert.throws(() => seedAppointment(db, {id:'wrong-owner',student_id:'20269999',parent_appointment_id:'original',link_kind:'repair_induced',linked_by:'20260001'}), /REPAIR_LINK_INVALID/);
    assert.throws(() => db.sqlite.prepare("UPDATE appointments SET link_kind='recurrence' WHERE id='new-fault'").run(), /REPAIR_LINK_INVALID/);
    assert.equal(db.sqlite.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { db.sqlite.close(); }
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
for(const directory of ['migrations','database/staff-migrations'])test(`${directory}: every retired request is archived and scheduled appointments are linked without inventing service`,()=>{
 const db=database(directory,'0046_');
 try{
  seedStaff(db,'20260001');seedAppointment(db,{id:'original',student_id:'20260009',status:'completed'});seedAppointment(db,{id:'child',student_id:'20260009',source:'onsite',registration_flow:'repair_followup',registered_by:'20260001'});
  for(const [id,status] of [['pending','pending'],['scheduled','scheduled'],['rejected','rejected']]){
   db.sqlite.prepare(`INSERT INTO repair_followups(id,parent_appointment_id,status,reason,request_id,request_hash,requested_at,scheduled_appointment_id,scheduled_by,scheduled_at,resolved_by,resolved_at,resolution_note)
    VALUES(?,'original',?,'old reason',?,?,'2026-11-01',?,?,?,?,?,'old decision')`).run(id,status,id,'a'.repeat(64),status==='scheduled'?'child':null,status==='scheduled'?'20260001':null,status==='scheduled'?'2026-11-02':null,status==='pending'?null:'20260001',status==='pending'?null:'2026-11-02');
  }
  const requests=db.sqlite.prepare('SELECT * FROM repair_followups ORDER BY id').all(),original=db.sqlite.prepare("SELECT * FROM appointments WHERE id='original'").get();
  db.sqlite.exec(readFileSync(`${directory}/0046_repair_links.sql`,'utf8'));
  const archived=db.sqlite.prepare("SELECT before_json,after_json FROM audit_events WHERE action='repairs.followup.migrated' ORDER BY id").all();
  assert.equal(archived.length,requests.length);
  for(const row of requests){const record=archived.find(x=>JSON.parse(x.before_json).id===row.id);const saved=JSON.parse(record.before_json);
   for(const [field,value] of Object.entries(row))assert.deepEqual(saved[field.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase())],value,field);
  }
  const after=db.sqlite.prepare("SELECT * FROM appointments WHERE id='original'").get();
  for(const [field,value] of Object.entries(original))assert.equal(after[field],value,field);
  const child=db.sqlite.prepare("SELECT * FROM appointments WHERE id='child'").get();
  assert.equal(child.parent_appointment_id,'original');assert.equal(child.link_kind,'historical');assert.equal(child.status,'booked');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM appointments').get().n,2);
  assert.equal(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='repair_followups'").get(),undefined);
  assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.sqlite.close();}
});
