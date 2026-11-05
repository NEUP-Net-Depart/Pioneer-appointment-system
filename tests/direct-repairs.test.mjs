import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database,seedStaff,seedAppointment,seedPhoto } from './helpers/database.mjs';
import { repairScenario } from './fixtures/repair-scenario.mjs';
import { appointmentPatch } from '../src/lib/validation.js';
import { verifyStaffSchema } from '../src/db/staff-readiness.js';
function patch(input) {return appointmentPatch({requestId:crypto.randomUUID(),...input});}

test('any active staff can receive multiple orders after hours and hand over across days without attendance',async t=>{
  const {db,users,repo,staff,service,order,calendar}=repairScenario(t);
  await verifyStaffSchema(db);
  const one=await users.find('20260001'),two=await users.find('20260002'),other=await users.find('20260003');
  for(const id of ['a','b']) {
    order(id);seedPhoto(db,id+'f',id,'front','20260002');seedPhoto(db,id+'b',id,'back','20260002');
    const result=await service.update(id,patch({revision:0,status:'in_progress',frontPhotoId:id+'f',backPhotoId:id+'b'}),one);
    assert.equal(result.assignedMemberId,one.memberId);
  }
  assert.equal((await repo.inProgress('20260001')).length,2);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM attendance_records').get().n,0);
  await assert.rejects(staff.field.detail(other,'a'),{status:403});
  order('missed');
  const before=await repo.find('a');
  calendar.moveTo(calendar.nextDay,'10:00');
  await assert.rejects(service.update('missed',patch({revision:0,status:'in_progress',photosCaptured:true,uploadTimedOut:true}),one),{status:409});
  await staff.field.board(one);
  assert.equal((await repo.find('missed')).status,'expired');
  const transferred=await service.transfer('a',{revision:before.revision,requestId:crypto.randomUUID(),receivedDevice:true},two);
  assert.equal(transferred.assignedMemberId,two.memberId);
  assert.equal(transferred.frontPhotoId,before.frontPhotoId);
  assert.equal(transferred.startedAt,before.startedAt);
  assert.equal(transferred.date,calendar.serviceDay);
  assert.equal((await staff.field.detail(two,'a')).businessDate,calendar.nextDay);
  await assert.rejects(service.update('a',patch({revision:transferred.revision,status:'completed',outcome:'repaired',repairNote:'完成'}),one),{status:409});
  const finished=await service.update('a',patch({revision:transferred.revision,status:'completed',outcome:'partially_repaired',repairNote:'系统已修复，键盘仍需更换'}),two);
  assert.equal(finished.outcome,'partially_repaired');
  const corrected=await service.update('a',patch({revision:finished.revision,action:'correct',outcome:'unrepaired',repairNote:'复核后系统仍有故障'}),two);
  assert.equal(corrected.assignedMemberId,two.memberId);
  const audit=db.sqlite.prepare("SELECT before_json,after_json FROM audit_events WHERE action='repairs.corrected'").get();
  assert.equal(JSON.parse(audit.before_json).outcome,'partially_repaired');
  assert.equal(JSON.parse(audit.after_json).repairNote,'复核后系统仍有故障');
  const contacts=db.sqlite.prepare("SELECT before_json,after_json FROM audit_events WHERE action='customer.contact.read'").all();
  assert.ok(contacts.length>0);assert.ok(contacts.every(row=>row.before_json===null && row.after_json===null));
  const listing=await staff.field.projectList(one,[await repo.find('a')]);
  assert.equal(Object.hasOwn(listing[0],'social'),false);
});

test('deferred originals survive completion and a later-day manual supplement; partial upload retains the pending marker',async t=>{
  const {db,users,repo,service,order,calendar}=repairScenario(t);
  order('deferred');const one=await users.find('20260001'),two=await users.find('20260002');
  await assert.rejects(service.update('deferred',patch({revision:0,status:'in_progress'}),one),{status:400});
  const started=await service.update('deferred',patch({revision:0,status:'in_progress',photosCaptured:true,uploadTimedOut:true}),one);
  const finished=await service.update('deferred',patch({revision:started.revision,status:'completed',outcome:'not_needed',repairNote:'设备无需维修'}),one);
  calendar.moveTo(calendar.nextDay,'10:00');
  seedPhoto(db,'df','deferred','front','20260001');seedPhoto(db,'db','deferred','back','20260001');
  await assert.rejects(service.supplement('deferred',{revision:finished.revision,requestId:crypto.randomUUID(),frontPhotoId:'df'},two),{status:403});
  const partial=await service.supplement('deferred',{revision:finished.revision,requestId:crypto.randomUUID(),frontPhotoId:'df'},one);
  assert.equal(partial.photoDeferredBy,'20260001');
  const complete=await service.supplement('deferred',{revision:partial.revision,requestId:crypto.randomUUID(),backPhotoId:'db'},one);
  assert.equal(complete.photoDeferredBy,'');assert.equal(complete.status,'completed');assert.equal(complete.outcome,finished.outcome);
  assert.equal((await repo.pendingPhotos('20260001','南湖')).length,0);
});

test('competing starts keep one owner and receipt replay does not create a second start',async t=>{
  const {db,users,repo,service,order}=repairScenario(t);
  order('race');const one=await users.find('20260001'),two=await users.find('20260002');
  const input=patch({revision:0,status:'in_progress',photosCaptured:true,uploadTimedOut:true});
  const results=await Promise.allSettled([service.update('race',input,one),service.update('race',patch({...input.patch,revision:0,photosCaptured:true,uploadTimedOut:true}),two)]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  const owner=await repo.find('race');
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='repairs.started'").get().n,1);
  if(owner.assignedTo==='20260001')assert.equal((await service.update('race',input,one)).revision,owner.revision);
});

for(const directory of ['migrations','database/staff-migrations'])test(`${directory}: queued, assigned, in-progress and photo facts survive destructive cutover`,()=>{
  const db=database(directory,'0045_');
  try {
    seedStaff(db,'20260001');seedStaff(db,'20260002');
    seedAppointment(db,{id:'active',status:'in_progress',assigned_to:'20260001',started_at:'2026-11-05T10:00:00.000Z'});
    seedAppointment(db,{id:'waiting'});seedPhoto(db,'wf','waiting','front','20260001');seedPhoto(db,'wb','waiting','back','20260001');
    db.sqlite.exec("UPDATE appointments SET front_photo_id='wf',back_photo_id='wb' WHERE id='waiting'");
    db.sqlite.exec(`INSERT INTO repair_receptions(appointment_id,state,received_at,received_by,assigned_to,assigned_member_id,updated_at) VALUES('waiting','assigned','2026-11-05T10:00:00.000Z','20260001','20260002','member-20260002','2026-11-05T10:00:00.000Z')`);
    const photos=db.sqlite.prepare('SELECT * FROM appointment_attachments').all();
    const before=db.sqlite.prepare("SELECT * FROM appointments WHERE id='active'").get();
    db.sqlite.exec(readFileSync(`${directory}/0045_direct_repairs.sql`,'utf8'));
    assert.deepEqual(db.sqlite.prepare('SELECT * FROM appointment_attachments').all(),photos);
    const after=db.sqlite.prepare("SELECT * FROM appointments WHERE id='active'").get();
    for(const key of Object.keys(before))assert.equal(after[key],before[key],key);
    const waiting=db.sqlite.prepare("SELECT * FROM appointments WHERE id='waiting'").get();
    assert.equal(waiting.status,'booked');assert.equal(waiting.assigned_to,null);assert.equal(waiting.received_by,'20260001');
    assert.equal(waiting.front_photo_id,'wf');
    assert.ok(db.sqlite.prepare("SELECT before_json FROM audit_events WHERE action='repairs.workflow.archived' AND before_json LIKE '%assigned%'").get());
    for(const name of ['active_repairs','repair_receptions','repair_queue_tickets','idx_one_pending_onsite_registration'])assert.equal(db.sqlite.prepare('SELECT name FROM sqlite_master WHERE name=?').get(name),undefined);
    assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{db.sqlite.close();}
});
