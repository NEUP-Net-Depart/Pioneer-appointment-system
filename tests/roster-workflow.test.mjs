import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {staffPlatformRepository} from '../src/db/staff-platform.js';
import {userRepository} from '../src/db/users.js';
import {composeStaffPlatform} from '../src/app/compose.js';
import {staffPlatformService} from '../src/services/staff-platform.js';
import {dateKey,weekRange,addDays} from '../shared/time.js';
import {generateOfficeRoster} from '../src/modules/rosters/office.ts';
import {validateRoster} from '../src/modules/rosters/solver.js';
import {collectionInstant,validateRecurrence} from '../src/modules/rosters/recurrence.js';

async function migrate(db,directory){
  for(const file of (await readdir(directory)).filter(file=>file.endsWith('.sql')).sort()) {
    const statements=[];let buffer='';
    for(const line of (await readFile(`${directory}/${file}`,'utf8')).replace(/--[^\n]*/g,'').split('\n')){
      buffer=`${buffer}\n${line}`.trim();if(buffer&&(buffer.startsWith('CREATE TRIGGER')?line.trim()==='END;':line.trim().endsWith(';'))){statements.push(buffer);buffer='';}
    }
    assert.equal(buffer,'',file);await db.batch(statements.map(sql=>db.prepare(sql)));
  }
}
test('office automatic scheduling balances repeated weekly shifts and enforces daily limits and targets',()=>{
  const slots=['2027-06-07','2027-06-08','2027-06-09','2027-06-10'].flatMap(businessDate=>['campus-nanhu','campus-hunnan'].map(campusId=>({businessDate,campusId,startAt:'19:00',endAt:'21:00',dutyType:'office',ordinaryMinimum:1})));
  const members=['a','b','c'].map(memberId=>({memberId,available:slots}));
  const result=generateOfficeRoster({slots,members});
  assert.equal(result.assignments.length,8);assert.equal(validateRoster(result,{slots,members}).valid,true);
  const counts=members.map(member=>result.assignments.filter(row=>row.memberId===member.memberId).length);
  assert.ok(Math.max(...counts)-Math.min(...counts)<=1,JSON.stringify(counts));
  const shortage=generateOfficeRoster({slots,members:[members[0]]});
  assert.equal(shortage.assignments.length,4);assert.equal(validateRoster(shortage,{slots,members:[members[0]]}).valid,false);
  const locked={...slots[0],memberId:'a',locked:true};
  const regenerated=generateOfficeRoster({slots,members,locked:[locked]});
  assert.equal(regenerated.assignments.filter(row=>row.locked).length,1);
  assert.equal(validateRoster(regenerated,{slots,members,locked:[locked]}).valid,true);
  assert.equal(validateRecurrence({publishWeekday:4,publishTime:'18:00',deadlineWeekday:7,deadlineTime:'18:00'}),true);
  assert.equal(validateRecurrence({publishWeekday:7,publishTime:'18:00',deadlineWeekday:4,deadlineTime:'18:00'}),false);
  assert.equal(collectionInstant('2026-10-26',4,'18:00'),'2026-10-22T10:00:00.000Z');
});

test('historical signed assignments survive qualification changes but cannot authorize new assignments',()=>{
  const slot={businessDate:'2026-10-15',campusId:'campus-nanhu',startAt:'19:00',endAt:'21:00',dutyType:'office',ordinaryMinimum:1};
  const original={...slot,memberId:'former-member',roleKind:'coordinator'};
  const source={slots:[slot],members:[],preservedAssignments:[original]};
  assert.equal(validateRoster({assignments:[original]},source).valid,true);
  assert.equal(validateRoster({assignments:[{...original,memberId:'another-member'}]},source).valid,false);
  assert.equal(validateRoster({assignments:[{...original,roleKind:''}]},source).valid,false);
  assert.equal(validateRoster({assignments:[original]},{...source,preservedAssignments:[]}).valid,false);
});

test('both migration chains support collection, atomic weekly submissions, revisions, recurrence and preferences',async()=>{
  const mf=new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'roster-workflow',compatibilityDate:'2026-10-01',manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:'export default {fetch(){return new Response("ok");}}'}}},env:{DEV:{type:'d1',id:'workflow-dev'},STAFF:{type:'d1',id:'workflow-staff'}}}}]});
  try{for(const [binding,directory] of [['DEV','migrations'],['STAFF','database/staff-migrations']]){
    const db=await mf.getD1Database(binding);await migrate(db,directory);
    for(const [account,role] of [['root001','superadmin'],['20265501','technician'],['20265502','technician']]){
      await db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,protected,password_hash,created_at) VALUES(?,?,?,'南湖',?,'test','2026-01-01')").bind(account,account,role,account==='root001'?1:0).run();
      await db.batch(['南湖','浑南'].map(campus=>db.prepare('INSERT INTO staff_campus_grants VALUES(?,?)').bind(account,campus)));
      if(role==='technician')await db.prepare("INSERT INTO member_work_profiles(id,member_id,profile_code,effective_from) VALUES(?,?,'office','2026-01-01')").bind(`office-${account}`,`member-${account}`).run();
    }
    const repo=staffPlatformRepository(db),users=userRepository(db),platform=composeStaffPlatform({repository:repo}),service=staffPlatformService({repository:repo,platform,manifests:platform.manifests});
    const root=await users.find('root001'),one=await users.find('20265501'),two=await users.find('20265502');
    const week=addDays(weekRange(dateKey()).start,7),campusIds=['campus-nanhu','campus-hunnan'];
    const input={workflowVersion:1,dutyType:'office',weekStart:week,campusIds,slotStart:'19:00',slotEnd:'21:00',memberIds:[one.memberId,two.memberId],deadline:new Date(Date.now()+86400000).toISOString(),requestId:crypto.randomUUID(),recurrence:{enabled:true,publishWeekday:4,publishTime:'18:00',deadlineWeekday:7,deadlineTime:'18:00'}};
    const task=await service.createRosterTask(root,input);assert.equal((await service.createRosterTask(root,input)).id,task.id);
    await assert.rejects(service.generate(root,{taskId:task.id}),error=>error.status===409);
    await assert.rejects(service.createRosterTask(root,{...input,requestId:crypto.randomUUID()}),error=>error.status===409);
    const windows=Array.from({length:4},(_,i)=>addDays(week,i)).flatMap(businessDate=>campusIds.map(campusId=>({businessDate,campusId,startAt:'19:00',endAt:'21:00'})));
    const body={windows,unavailable:false,revision:-1,autoContinue:true,requestId:crypto.randomUUID()};
    assert.equal((await service.submitAvailability(one,task.id,body)).items.length,8);
    assert.equal((await service.submitAvailability(one,task.id,body)).items.length,8);
    await assert.rejects(service.submitAvailability(one,task.id,{...body,requestId:crypto.randomUUID()}),error=>error.status===409);
    await service.submitAvailability(two,task.id,{...body,autoContinue:false,requestId:crypto.randomUUID()});
    let state=await service.rosterTaskState(root,task.id);assert.equal(state.progress.submitted,2);assert.equal(state.stage,'collecting');
    const close={action:'close',revision:task.revision,requestId:crypto.randomUUID()};await service.collectionCommand(root,task.id,close);await service.collectionCommand(root,task.id,close);
    await assert.rejects(service.submitAvailability(one,task.id,{...body,revision:0,requestId:crypto.randomUUID()}),error=>error.status===409);
    let generated=await service.generate(root,{taskId:task.id,requestId:crypto.randomUUID()});assert.equal(generated.validation.valid,true,JSON.stringify(generated.validation));
    const firstDraft=generated.version;
    generated=await service.generate(root,{taskId:task.id,requestId:crypto.randomUUID()});
    assert.equal((await repo.rosterVersionById(firstDraft.id)).status,'superseded');
    const beforeSave=await repo.versionAssignments(generated.version.id);
    beforeSave[0].locked=true;
    const saved=await service.updateRoster(root,generated.version.id,{version:generated.version.version,assignments:beforeSave,requestId:crypto.randomUUID()});
    assert.equal((await repo.versionAssignments(saved.id)).filter(row=>row.locked).length,1,'locking one office shift must not lock every shift of that member');
    await assert.rejects(service.updateRoster(root,generated.version.id,{version:generated.version.version,assignments:[],requestId:crypto.randomUUID()}),error=>error.status===409);
    assert.equal((await repo.versionAssignments(saved.id)).length,8,'a stale save must roll back all assignments');
    generated.version=saved;
    const published=await service.publish(root,generated.version.id,{version:generated.version.version});
    const revision=await service.reviseRoster(root,task.id,{publishedVersionId:published.id,requestId:crypto.randomUUID()});
    assert.deepEqual((await repo.versionAssignments(revision.id)).map(row=>[row.memberId,row.businessDate,row.campusId]),(await repo.versionAssignments(published.id)).map(row=>[row.memberId,row.businessDate,row.campusId]));
    assert.equal((await repo.rosterVersionById(published.id)).status,'published');
    const republished=await service.publish(root,revision.id,{version:revision.version});
    assert.equal((await repo.rosterVersionById(published.id)).status,'superseded');
    const secondRevision=await service.reviseRoster(root,task.id,{publishedVersionId:republished.id,requestId:crypto.randomUUID()});
    assert.equal(secondRevision.status,'draft','old drafts must not block the next revision');
    // A forced due tick models the scheduler; next week's deadline remains in the future.
    await db.prepare("UPDATE roster_collection_series SET next_publish_at='2020-01-01' WHERE id=?").bind(task.seriesId).run();
    const result=await service.processRosterAutomation();assert.equal(result.published,1,JSON.stringify(result));assert.equal(result.carried,1,JSON.stringify(result));
    assert.equal((await service.processRosterAutomation()).published,0);
    const next=(await repo.listRosterTasks()).find(row=>row.seriesId===task.seriesId&&row.id!==task.id);
    const submission=(await repo.rosterSubmissions(next.id)).find(row=>row.memberId===one.memberId);assert.equal(submission.source,'carried');
    const nextWindows=await repo.availability(next.id);assert.equal(nextWindows.length,8);assert.equal(nextWindows[0].businessDate,addDays(week,7));
    const changedWeek=addDays(week,21);
    const changedTask=await service.createRosterTask(root,{...input,weekStart:changedWeek,recurrence:{enabled:false},requestId:crypto.randomUUID()});
    await db.prepare("UPDATE member_work_profiles SET effective_to=? WHERE member_id=? AND profile_code='office'").bind(changedWeek,one.memberId).run();
    const afterRevocation=await service.processRosterAutomation();
    assert.ok(afterRevocation.skipped>0,'a qualification revoked after collection creation must stop automatic submission');
    assert.equal(afterRevocation.errors.length,0,'expected eligibility changes are not scheduler failures');
    assert.equal((await repo.rosterSubmissions(changedTask.id)).length,0);
    await service.availabilityPreferences(one,{dutyType:'office',enabled:false});assert.equal((await service.availabilityPreferences(one)).items[0].enabled,0);
    const reopened=await service.collectionCommand(root,task.id,{action:'reopen',revision:(await repo.rosterTaskById(task.id)).revision,deadline:new Date(Date.now()+86400000).toISOString(),requestId:crypto.randomUUID()});
    assert.equal(reopened.collectionClosedAt,null);assert.equal((await repo.rosterVersionById(republished.id)).status,'published');
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  }}finally{await mf.dispose();}
});
