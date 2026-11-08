import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database,seedStaff,seedAppointment,seedPhoto } from './helpers/database.mjs';
import { repairScenario } from './fixtures/repair-scenario.mjs';
import { appointmentPatch } from '../src/lib/validation.js';
import { verifyStaffSchema } from '../src/db/staff-readiness.js';
import { encryptText } from '../src/lib/privacy.js';
import { staffSceneAllowed } from '../shared/staff-access.js';
function patch(input) {return appointmentPatch({requestId:crypto.randomUUID(),...input});}

test('field attendance follows the actual member, day and campus without live presence',async t=>{
  const {db,users,staff,calendar}=repairScenario(t,{time:'19:10'});
  db.sqlite.prepare("UPDATE member_department_memberships SET position_code='head' WHERE member_id='member-20260002'").run();
  db.sqlite.prepare("INSERT INTO staff_campus_grants(account,campus) VALUES('20260001','浑南')").run();
  const worker=await users.find('20260001'),head=await users.find('20260002');
  const before=await staff.field.home(worker,{campusId:'campus-nanhu'});
  assert.equal(before.attendance,null);
  const event=await staff.createAttendanceEvent(head,{campusId:'campus-nanhu',businessDate:calendar.serviceDay});
  const token=await staff.issueAttendanceToken(head,event.id,{revision:event.revision});
  const record=await staff.checkIn(worker,{token:token.token,method:'qr',requestId:crypto.randomUUID()});
  db.sqlite.prepare('DELETE FROM staff_presence WHERE member_id=?').run(worker.memberId);
  assert.equal((await staff.field.home(worker,{campusId:'campus-nanhu'})).attendance.id,record.id);
  assert.equal((await staff.field.board(worker,{campusId:'campus-nanhu'})).attendance.id,record.id);
  assert.equal((await staff.field.home(worker,{campusId:'campus-hunnan'})).attendance,null);
  assert.equal((await staff.field.home(head,{campusId:'campus-nanhu'})).attendance,null);
  calendar.moveTo(calendar.nextDay,'19:10');
  assert.equal((await staff.field.home(worker,{campusId:'campus-nanhu'})).attendance,null);
});

test('full student ID finds authorized current and historical orders through records and scan search',async t=>{
  const studentId='01234567';
  const {users,service,scan,order,calendar}=repairScenario(t,{studentId});
  const actor=await users.find('20260001');
  const current='reserve020261105-01', history='reserve020261029-01';
  order(current);
  order(history,{date:calendar.previousServiceDay,status:'completed'});
  order('reserve120261029-01',{campus:'浑南',date:calendar.previousServiceDay,status:'expired'});
  order('reserve020261105-02',{student_id:'101234567'});
  const records=await service.list({q:studentId},actor);
  assert.deepEqual(records.items.map(item=>item.id),[current,history]);
  assert.equal((await service.list({q:studentId.slice(0,-1)},actor)).filteredCounts.all,0);
  const candidates=await scan.search({q:' '+studentId+' ',campusId:'campus-nanhu'},actor);
  assert.deepEqual(candidates.items.map(item=>item.id),[current,history]);
  assert.deepEqual(Object.keys(candidates.items[0]),['id','campus','date','timeSlot','status']);
  assert.equal((await scan.search({q:studentId,mode:'number'},actor)).items.length,0);
  assert.equal((await scan.search({q:'reserve'+studentId},actor)).items.length,0);
  await assert.rejects(scan.search({q:studentId,campusId:'campus-hunnan'},actor),{status:403});
});

test('hardware staff can receive multiple orders after hours and hand over across days without attendance',async t=>{
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

test('office reception leaves the order unassigned; hardware starts it across days without replacing reception evidence',async t=>{
  const {db,users,staff,service,order,calendar}=repairScenario(t);
  db.sqlite.exec("UPDATE member_department_memberships SET department_id='dept-office' WHERE id='post-20260001'");
  const office=await users.find('20260001'),hardware=await users.find('20260002');
  order('joint');
  seedPhoto(db,'joint-front','joint','front',office.account);
  seedPhoto(db,'joint-back','joint','back',office.account);
  await assert.rejects(service.update('joint',patch({revision:0,status:'in_progress',frontPhotoId:'joint-front',backPhotoId:'joint-back'}),office),{status:403});
  const input={revision:0,requestId:crypto.randomUUID(),frontPhotoId:'joint-front',backPhotoId:'joint-back'};
  const received=await service.receive('joint',input,office);
  assert.equal(received.status,'booked');assert.equal(received.assignedMemberId,'');assert.equal(received.startedAt,null);
  assert.equal(received.receivedBy,office.account);
  assert.equal((await service.receive('joint',input,office)).revision,received.revision);
  await assert.rejects(service.update('joint',patch({revision:received.revision,status:'cancelled'}),office),{status:409});
  calendar.moveTo(calendar.nextDay,'10:00');
  const board=await staff.field.board(hardware);
  assert.ok(board.appointments.some(row=>row.id==='joint' && row.status==='booked'));
  const started=await service.update('joint',patch({revision:received.revision,status:'in_progress',verification:{brand:'不应覆盖',model:'',warranty:'unknown',liquidMetal:'unknown'}}),hardware);
  for(const key of ['receivedAt','receivedBy','frontPhotoId','backPhotoId','brand'])assert.equal(started[key],received[key]);
  assert.equal(started.assignedMemberId,hardware.memberId);
  await assert.rejects(service.transfer('joint',{revision:started.revision,requestId:crypto.randomUUID(),receivedDevice:true},office),{status:403});
  await assert.rejects(service.update('joint',patch({revision:started.revision,status:'completed',outcome:'repaired',repairNote:'越权结束'}),office),{status:403});
  const finished=await service.update('joint',patch({revision:started.revision,status:'completed',outcome:'repaired',repairNote:'维修完成'}),hardware);
  assert.equal(finished.receivedBy,office.account);assert.equal(finished.assignedMemberId,hardware.memberId);
  const actions=db.sqlite.prepare("SELECT action,actor_account,before_json,after_json FROM audit_events WHERE json_extract(source_ref,'$.id')=? AND action IN ('repairs.received','repairs.started','repairs.completed') ORDER BY rowid").all('joint');
  assert.deepEqual(actions.map(row=>[row.action,row.actor_account]),[['repairs.received',office.account],['repairs.started',hardware.account],['repairs.completed',hardware.account]]);
  assert.equal(JSON.parse(actions[0].after_json).assignedTo,'');
  assert.equal(JSON.parse(actions[1].before_json).receivedBy,office.account);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM repair_intake_records WHERE appointment_id=?').get('joint').n,1);
});

test('current memberships and campuses enforce reception and repair capabilities, including office members with a hardware exchange post',async t=>{
  const {db,users,repo,staff,service,order,calendar}=repairScenario(t);
  const actor=await users.find('20260001');order('permissions');
  const start=()=>service.update('permissions',patch({revision:0,status:'in_progress',photosCaptured:true,uploadTimedOut:true}),actor);
  const receive=()=>service.receive('permissions',{revision:0,requestId:crypto.randomUUID(),photosCaptured:true,uploadTimedOut:true},actor);
  db.sqlite.exec("UPDATE member_department_memberships SET department_id='dept-network' WHERE id='post-20260001'");
  await assert.rejects(start(),{status:403});await assert.rejects(receive(),{status:403});
  await assert.rejects(staff.field.requireIntake(actor,await repo.find('permissions')),{status:403});
  db.sqlite.exec("UPDATE member_department_memberships SET department_id='dept-office' WHERE id='post-20260001'");
  db.sqlite.exec("INSERT INTO member_department_memberships(id,member_id,department_id,position_code,assignment_type,is_primary,effective_from,created_at) VALUES('secondary-hardware','member-20260001','dept-hardware','member','exchange',0,'2026-01-01','2026-01-01')");
  order('exchange');
  const received=await service.receive('exchange',{revision:0,requestId:crypto.randomUUID(),photosCaptured:true,uploadTimedOut:true},actor);
  const started=await service.update('exchange',patch({revision:received.revision,status:'in_progress'}),actor);
  assert.equal(started.assignedMemberId,actor.memberId);
  db.sqlite.prepare("UPDATE member_department_memberships SET effective_to=? WHERE id='secondary-hardware'").run(calendar.serviceDay);
  await assert.rejects(start(),{status:403});
  db.sqlite.prepare("UPDATE member_department_memberships SET effective_to=NULL,effective_from=? WHERE id='secondary-hardware'").run(calendar.nextDay);
  await assert.rejects(start(),{status:403});
  db.sqlite.exec("UPDATE member_department_memberships SET effective_from='2026-01-01',assignment_type='exchange' WHERE id='secondary-hardware'");
  order('elsewhere',{campus:'浑南'});
  await assert.rejects(service.receive('elsewhere',{revision:0,requestId:crypto.randomUUID(),photosCaptured:true,uploadTimedOut:true},actor),{status:403});
  db.sqlite.exec("UPDATE departments SET enabled=0 WHERE id='dept-hardware'");
  await assert.rejects(start(),{status:403});
  db.sqlite.exec("UPDATE departments SET enabled=1 WHERE id='dept-hardware'; UPDATE staff_accounts SET status='disabled' WHERE account='20260001'");
  await assert.rejects(start(),{status:401});
});

test('staff with read access, including administrators, can open today work within campus without receiving or starting repairs',async t=>{
  const {db,users,staff,service,order}=repairScenario(t);
  db.sqlite.exec("UPDATE member_department_memberships SET department_id='dept-network' WHERE id='post-20260001'");
  db.sqlite.exec("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at,protected) VALUES('root001','系统管理员','superadmin','南湖','test','2026-01-01',1); INSERT INTO staff_campus_grants VALUES('root001','南湖')");
  order('visible');order('elsewhere',{campus:'浑南'});
  for(const account of ['20260001','root001']) {
    const actor=await users.find(account),board=await staff.field.board(actor);
    assert.ok(board.contexts.some(context=>context.id==='today'));
    assert.ok(board.navigation.some(entry=>entry.id==='workbench'));
    assert.equal(staffSceneAllowed({permissions:board.permissions},board,'today'),true);
    assert.deepEqual(board.appointments.map(row=>row.id),['visible']);
    await assert.rejects(staff.field.board(actor,{campusId:'campus-hunnan'}),{status:403});
    const input={revision:0,requestId:crypto.randomUUID(),photosCaptured:true,uploadTimedOut:true};
    await assert.rejects(service.receive('visible',input,actor),{status:403});
    await assert.rejects(service.update('visible',patch({...input,status:'in_progress'}),actor),{status:403});
  }
});

test('ordinary members receive current repair facts while original evidence and operation history stay scoped to managers',async t=>{
  const {db,users,staff,service,order}=repairScenario(t);
  db.sqlite.exec("UPDATE member_department_memberships SET department_id='dept-office' WHERE id='post-20260002'");
  const hardware=await users.find('20260001'),office=await users.find('20260002');
  order('evidence',{signature:'private-signature',note:'private-registration-note'});
  order('elsewhere',{campus:'浑南'});
  await service.update('evidence',patch({revision:0,status:'in_progress',photosCaptured:true,uploadTimedOut:true}),hardware);
  const assertNoEvidence=item=>{
    assert.ok(item,'the expected repair must be returned before checking its visible fields');
    for(const key of ['original','repairHistory','signature','note','agreementAt','agreementVersion'])assert.equal(Object.hasOwn(item,key),false,key);
  };
  for(const actor of [hardware,office]) {
    const detail=await staff.field.detail(actor,'evidence');
    assertNoEvidence(detail);
    assert.equal(detail.assignedMemberId,hardware.memberId);
    assertNoEvidence((await staff.field.board(actor)).appointments.find(row=>row.id==='evidence'));
    assertNoEvidence((await service.list({},actor)).items.find(row=>row.id==='evidence'));
  }
  assertNoEvidence((await staff.workbench(hardware)).repairs.find(row=>row.id==='evidence'));
  db.sqlite.exec("UPDATE member_department_memberships SET position_code='head' WHERE id='post-20260002'");
  db.sqlite.exec("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at,protected) VALUES('root001','系统管理员','superadmin','南湖','test','2026-01-01',1); INSERT INTO staff_campus_grants VALUES('root001','南湖')");
  for(const actor of [await users.find(office.account),await users.find('root001')]) {
    const detail=await staff.field.detail(actor,'evidence');
    assert.equal(detail.original.signature,'private-signature');
    assert.equal(detail.original.note,'private-registration-note');
    assert.ok(detail.repairHistory.events.some(event=>event.action==='repairs.started'));
    await assert.rejects(staff.field.detail(actor,'elsewhere'),{status:403});
  }
});

test('unified lookup reuses identity and exact contact search without returning contacts or leaking other campuses',async t=>{
  const {users,scan,order,calendar}=repairScenario(t);
  const actor=await users.find('20260001');
  const social=await encryptText('wechat_exact','00'.repeat(32));
  order('reserve020261105-91',{student_id:'20269918',name:'张三',social});
  order('reserve020261029-92',{date:calendar.previousServiceDay,student_id:'20269919',name:'张三',social,status:'completed'});
  for(let i=0;i<12;i++)order('reserve120261105-'+i,{campus:'浑南',student_id:'20269918',name:'张三',social,source:'onsite'});
  for(const query of ['20261105-91','20269918','张三','wechat_exact']) {
    const result=await scan.search({q:query,campusId:'campus-nanhu'},actor);
    assert.ok(result.items.some(row=>row.id==='reserve020261105-91'),query);
    assert.ok(result.items.every(row=>row.campus==='南湖'));
    assert.equal(result.hasMore,false);
    assert.ok(result.items.every(row=>!['phone','social','email','contactValue'].some(key=>Object.hasOwn(row,key))));
  }
  assert.equal((await scan.search({q:'wechat_exac'},actor)).items.length,0);
  assert.ok((await scan.search({q:'张三'},actor)).items.some(row=>row.date===calendar.previousServiceDay));
  await assert.rejects(scan.search({q:'张三',campusId:'campus-hunnan'},actor),{status:403});
});

test('deferred originals stay with the receiver across repair ownership, completion and partial supplements',async t=>{
  const {db,users,repo,staff,service,order,calendar}=repairScenario(t);
  db.sqlite.exec("UPDATE member_department_memberships SET department_id='dept-office' WHERE id='post-20260001'");
  order('deferred');const receiver=await users.find('20260001'),repairer=await users.find('20260002');
  await assert.rejects(service.receive('deferred',{revision:0,requestId:crypto.randomUUID()},receiver),{status:400});
  const received=await service.receive('deferred',{revision:0,requestId:crypto.randomUUID(),photosCaptured:true,uploadTimedOut:true},receiver);
  const started=await service.update('deferred',patch({revision:received.revision,status:'in_progress'}),repairer);
  const finished=await service.update('deferred',patch({revision:started.revision,status:'completed',outcome:'not_needed',repairNote:'设备无需维修'}),repairer);
  calendar.moveTo(calendar.nextDay,'10:00');
  assert.ok((await staff.field.board(receiver)).pendingPhotos.some(row=>row.id==='deferred'));
  await staff.field.requireIntake(receiver,await repo.find('deferred'));
  seedPhoto(db,'df','deferred','front',receiver.account);seedPhoto(db,'db','deferred','back',receiver.account);
  await assert.rejects(service.supplement('deferred',{revision:finished.revision,requestId:crypto.randomUUID(),frontPhotoId:'df'},repairer),{status:403});
  const partial=await service.supplement('deferred',{revision:finished.revision,requestId:crypto.randomUUID(),frontPhotoId:'df'},receiver);
  assert.equal(partial.photoDeferredBy,receiver.account);
  const complete=await service.supplement('deferred',{revision:partial.revision,requestId:crypto.randomUUID(),backPhotoId:'db'},receiver);
  assert.equal(complete.photoDeferredBy,'');assert.equal(complete.status,'completed');assert.equal(complete.outcome,finished.outcome);
  assert.equal(complete.receivedBy,receiver.account);assert.equal(complete.assignedMemberId,repairer.memberId);
  assert.equal((await repo.pendingPhotos(receiver.account,'南湖')).length,0);
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
