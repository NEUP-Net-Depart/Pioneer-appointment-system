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
import {collectionInstant,validateRecurrence,recurringPeriodWeek} from '../src/modules/rosters/recurrence.js';
import {rosterCollections,preferredRosterPeriod} from '../shared/roster-collections.js';

test('one published collection follows the current calendar week and keeps independent weekly history',()=>{
  const series={deadline_weekday:7,deadline_time:'18:00'};
  assert.equal(recurringPeriodWeek(series,'2026-10-05',new Date('2026-10-25T17:59:59+08:00')),'2026-10-26');
  assert.equal(recurringPeriodWeek(series,'2026-10-05',new Date('2026-10-25T18:00:00+08:00')),'2026-11-02');
  assert.equal(recurringPeriodWeek(series,'2026-10-05',new Date('2027-01-15T18:00:00+08:00')),'2027-01-18','long absences jump to the current period without catch-up tasks');
  assert.equal(recurringPeriodWeek(series,'2026-11-02',new Date('2026-10-18T12:00:00+08:00')),'2026-11-02','the initial immediately-opened period is retained');
  const periods=[{id:'p1',seriesId:'collection',weekStart:'2026-10-19',dutyType:'office',collectionState:'closed'}, {id:'p2',seriesId:'collection',weekStart:'2026-10-26',dutyType:'office',collectionState:'open'}];
  const groups=rosterCollections(periods);assert.equal(groups.length,1);assert.equal(groups[0].id,'collection');assert.equal(groups[0].periods.length,2);
  assert.equal(preferredRosterPeriod(periods,'2026-10-23').id,'p2');
});

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
  assert.equal(validateRecurrence({publishWeekday:7,publishTime:'18:00',deadlineWeekday:8,deadlineTime:'18:00'}),false);
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

test('deployment migrations support collection, atomic weekly submissions, revisions, recurrence and preferences',async()=>{
  const mf=new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'roster-workflow',compatibilityDate:'2026-10-01',manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:'export default {fetch(){return new Response("ok");}}'}}},env:{DEV:{type:'d1',id:'workflow-dev'}}}}]});
  try{
    const binding='DEV',directory='migrations';
    const db=await mf.getD1Database(binding);await migrate(db,directory);
    for(const [account,role] of [['root001','superadmin'],['20265501','technician'],['20265502','technician'],['20265503','superadmin']]){
      await db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,protected,password_hash,created_at) VALUES(?,?,?,'南湖',?,'test','2026-01-01')").bind(account,account,role,account==='root001'?1:0).run();
      await db.batch(['南湖','浑南'].map(campus=>db.prepare('INSERT INTO staff_campus_grants VALUES(?,?)').bind(account,campus)));
      if(role==='technician')await db.prepare("INSERT INTO member_work_profiles(id,member_id,profile_code,effective_from) VALUES(?,?,'office','2026-01-01')").bind(`office-${account}`,`member-${account}`).run();
    }
    const repo=staffPlatformRepository(db),users=userRepository(db),platform=composeStaffPlatform({repository:repo}),service=staffPlatformService({repository:repo,platform,manifests:platform.manifests});
    const root=await users.find('root001'),one=await users.find('20265501'),two=await users.find('20265502');
    const week=addDays(weekRange(dateKey()).start,7),campusIds=['campus-nanhu','campus-hunnan'];
    const input={workflowVersion:1,dutyType:'office',weekStart:week,campusIds,slotStart:'19:00',slotEnd:'21:00',memberIds:[one.memberId,two.memberId],deadline:new Date(Date.now()+86400000).toISOString(),requestId:crypto.randomUUID(),recurrence:{enabled:true,publishWeekday:4,publishTime:'18:00',deadlineWeekday:7,deadlineTime:'18:00'}};
    const task=await service.createRosterTask(root,input);assert.equal((await service.createRosterTask(root,input)).id,task.id);
    await assert.rejects(service.saveAvailability(one,task.id,{businessDate:week,campusId:'campus-nanhu',startAt:'19:00',endAt:'21:00'}),error=>error.status===409,'legacy writes cannot mutate whole-week collections');
    assert.equal((await repo.availability(task.id)).length,0);
    await assert.rejects(service.generate(root,{taskId:task.id}),error=>error.status===409);
    await assert.rejects(service.createRosterTask(root,{...input,requestId:crypto.randomUUID()}),error=>error.status===409);
    const windows=Array.from({length:4},(_,i)=>addDays(week,i)).flatMap(businessDate=>campusIds.map(campusId=>({businessDate,campusId,startAt:'19:00',endAt:'21:00'})));
    const body={windows,unavailable:false,revision:-1,autoContinue:true,requestId:crypto.randomUUID()};
    await assert.rejects(service.submitAvailability(one,task.id,{...body,windows:[{...windows[0],startAt:'19:30'}],requestId:crypto.randomUUID()}),error=>error.status===400);
    assert.equal((await service.submitAvailability(one,task.id,body)).items.length,8);
    assert.equal((await service.submitAvailability(one,task.id,body)).items.length,8);
    await assert.rejects(service.submitAvailability(one,task.id,{...body,requestId:crypto.randomUUID()}),error=>error.status===409);
    await service.submitAvailability(two,task.id,{...body,autoContinue:false,requestId:crypto.randomUUID()});
    let state=await service.rosterTaskState(root,task.id);assert.equal(state.progress.submitted,2);assert.equal(state.stage,'collecting');
    const close={action:'close',revision:task.revision,requestId:crypto.randomUUID()};await service.collectionCommand(root,task.id,close);await service.collectionCommand(root,task.id,close);
    const advanced=(await repo.listRosterTasks()).filter(item=>item.seriesId===task.seriesId&&item.weekStart===addDays(week,7));
    assert.equal(advanced.length,1,'early close immediately opens exactly one next period');
    assert.equal((await repo.rosterSeries(task.seriesId)).current_week,addDays(week,7));
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
    // Opening the same ordinary collection resolves only the calendar's current
    // week. No scheduled worker, catch-up queue or separate publication occurs.
    const nextWeek=addDays(week,7),openedAt=new Date(Date.parse(collectionInstant(nextWeek,4,'18:00'))+3600000);
    const currentService=staffPlatformService({repository:repo,platform,manifests:platform.manifests,calendarClock:()=>openedAt});
    const currentList=await currentService.rosterTasks(root);
    assert.equal(currentList.collections.length,1);
    assert.equal(currentList.collections[0].id,task.seriesId);
    assert.equal(currentList.collections[0].periods.length,2);
    const next=(await repo.listRosterTasks()).find(row=>row.seriesId===task.seriesId&&row.id!==task.id);
    assert.equal(next.weekStart,nextWeek);
    await currentService.rosterTaskState(root,next.id);
    await currentService.rosterTasks(root);
    assert.equal((await repo.listRosterTasks()).length,2,'reopening does not duplicate the current week');
    assert.equal((await repo.rosterSubmissions(task.id)).length,2,'old weekly submissions remain independent');
    const submission=(await repo.rosterSubmissions(next.id)).find(row=>row.memberId===one.memberId);assert.equal(submission.source,'carried');
    const preference=(await repo.rosterPreferences(one.memberId)).find(row=>row.duty_type==='office');
    const beforeDisable=await repo.availability(next.id);
    await repo.disableRosterPreference(one.memberId,'office');
    await assert.rejects(repo.replaceRosterAvailability(next,one.memberId,{windows:[],unavailable:true,carried:true,revision:submission.revision},
      {actorMemberId:one.memberId,actorAccount:one.account,authVersion:one.authVersion,requestId:crypto.randomUUID(),preferenceRevision:preference.revision}),/constraint/i);
    assert.deepEqual(await repo.availability(next.id),beforeDisable,'in-flight automation cannot submit after continuation was disabled');
    await db.prepare("UPDATE roster_availability_preferences SET enabled=1,revision=revision+1 WHERE member_id=? AND duty_type='office'").bind(one.memberId).run();
    const nextWindows=await repo.availability(next.id);assert.equal(nextWindows.length,8);assert.equal(nextWindows[0].businessDate,addDays(week,7));
    const series=await repo.rosterSeries(task.seriesId),originalOpensAt=(await repo.rosterTaskById(next.id)).collectionOpensAt;
    const settings={enabled:true,name:'办公每周可用时间',revision:series.revision,recurrence:{publishWeekday:3,publishTime:'12:00',deadlineWeekday:7,deadlineTime:'18:00'},requestId:crypto.randomUUID()};
    await assert.rejects(service.seriesCommand(one,series.id,settings),error=>error.status===403);
    const updatedSeries=await service.seriesCommand(root,series.id,settings);
    assert.equal((await service.seriesCommand(root,series.id,settings)).revision,updatedSeries.revision,'settings retries are idempotent');
    await assert.rejects(service.seriesCommand(root,series.id,{...settings,requestId:crypto.randomUUID()}),error=>error.status===409);
    assert.equal((await repo.rosterTaskById(next.id)).collectionOpensAt,originalOpensAt,'changing future opening times never changes existing weekly snapshots');
    assert.equal((await service.rosterTasks(root)).collections[0].name,settings.name);
    // Changed hours must stay pending until the member submits again; unchanged
    // hours retain the member's existing continuation preference.
    for (const [offset,slotStart,slotEnd,compatible] of [[28,'17:00','19:00',false],[35,'20:00','22:00',false],[49,'19:00','21:00',true]]) {
      const adjusted=await service.createRosterTask(root,{...input,weekStart:addDays(week,offset),slotStart,slotEnd,recurrence:{enabled:false},requestId:crypto.randomUUID()});
      await service.rosterTaskState(root,adjusted.id);
      const carried=await repo.rosterSubmissions(adjusted.id),availability=await repo.availability(adjusted.id);
      assert.equal(carried.length,compatible?1:0,`${slotStart}–${slotEnd} must be covered by the original preference`);
      assert.equal(availability.length,compatible?8:0);
      assert.ok(availability.every(row=>row.startAt===slotStart&&row.endAt===slotEnd));
    }
    const lateWeek=addDays(week,14),lateDeadline=new Date(Date.parse(collectionInstant(lateWeek,7,'18:00'))).toISOString();
    const lateTask=await service.createRosterTask(root,{...input,weekStart:lateWeek,deadline:lateDeadline,recurrence:{enabled:false},requestId:crypto.randomUUID()});
    const afterDeadline=new Date(Date.parse(lateDeadline)+3600000);
    // Nobody visits this week. Changes made after its cutoff cannot rewrite the
    // choice that was effective during collection, or enroll another member late.
    await db.prepare("UPDATE roster_availability_preferences SET enabled=0,revision=revision+1,updated_at=? WHERE member_id=? AND duty_type='office'").bind(afterDeadline.toISOString(),one.memberId).run();
    await db.prepare("UPDATE roster_availability_preferences SET enabled=1,revision=revision+1,updated_at=? WHERE member_id=? AND duty_type='office'").bind(afterDeadline.toISOString(),two.memberId).run();
    const lateService=staffPlatformService({repository:repo,platform,manifests:platform.manifests,calendarClock:()=>afterDeadline});
    await Promise.all([lateService.rosterTaskState(root,lateTask.id),lateService.rosterTaskState(root,lateTask.id)]);
    const lateSubmissions=await repo.rosterSubmissions(lateTask.id);
    assert.equal(lateSubmissions.length,1);assert.equal(lateSubmissions[0].memberId,one.memberId);assert.equal(lateSubmissions[0].source,'carried');
    await assert.rejects(lateService.submitAvailability(two,lateTask.id,{...body,requestId:crypto.randomUUID()}),error=>error.status===409,'historical continuation never permits ordinary late submission');
    assert.equal((await repo.availability(lateTask.id)).length,8);
    const changedWeek=addDays(week,21);
    const changedTask=await service.createRosterTask(root,{...input,weekStart:changedWeek,recurrence:{enabled:false},requestId:crypto.randomUUID()});
    await db.prepare("UPDATE member_work_profiles SET effective_to=? WHERE member_id=? AND profile_code='office'").bind(changedWeek,one.memberId).run();
    await service.rosterTaskState(root,changedTask.id);
    await assert.rejects(service.taskAvailability(one,changedTask.id),error=>error.status===403);

    assert.equal((await repo.rosterSubmissions(changedTask.id)).length,0);
    await service.availabilityPreferences(one,{dutyType:'office',enabled:false});assert.equal((await service.availabilityPreferences(one)).items[0].enabled,0);
    const reopened=await service.collectionCommand(root,task.id,{action:'reopen',revision:(await repo.rosterTaskById(task.id)).revision,deadline:new Date(Date.now()+86400000).toISOString(),requestId:crypto.randomUUID()});
    assert.equal(reopened.collectionClosedAt,null);assert.equal((await repo.rosterVersionById(republished.id)).status,'published');
    const owner=await users.find('20265503'),latestSeries=await repo.rosterSeries(series.id);
    await service.seriesCommand(owner,series.id,{enabled:true,revision:latestSeries.revision,requestId:crypto.randomUUID()});
    await db.prepare("UPDATE staff_accounts SET status='disabled' WHERE account='20265503'").run();
    try{
      const stillReadable=await lateService.rosterTasks(two);
      assert.ok(stillReadable.items.some(item=>item.seriesId===task.seriesId&&item.collectionIssue),'an unavailable owner only pauses that collection and cannot break the ordinary task list');
    }finally{await db.prepare("UPDATE staff_accounts SET status='enabled' WHERE account='20265503'").run();}
    const distantWeek=addDays(week,42),distantAt=new Date(Date.parse(collectionInstant(distantWeek,3,'12:00'))+3600000);
    const distantService=staffPlatformService({repository:repo,platform,manifests:platform.manifests,calendarClock:()=>distantAt});
    await distantService.rosterTasks(two);
    const actualPeriods=(await repo.listRosterTasks()).filter(item=>item.seriesId===task.seriesId);
    assert.equal(actualPeriods.length,3,'after weeks without visits, resolve only one current period, never a backlog of published tasks');
    assert.ok(actualPeriods.some(item=>item.weekStart===distantWeek));
    const shortTask=await service.createRosterTask(root,{...input,weekStart:addDays(week,56),memberIds:[two.memberId],recurrence:{enabled:false},requestId:crypto.randomUUID()});
    await service.submitAvailability(two,shortTask.id,{windows:[],unavailable:true,revision:-1,requestId:crypto.randomUUID()});
    await service.collectionCommand(root,shortTask.id,{action:'close',revision:shortTask.revision,requestId:crypto.randomUUID()});
    const shortage=await service.generate(root,{taskId:shortTask.id,requestId:crypto.randomUUID()});
    const review=(await service.rosterTaskState(root,shortTask.id)).draft;
    assert.equal(review.validation.valid,false);assert.equal(review.validation.blocking,false);
    await assert.rejects(service.publish(root,shortage.version.id,{version:review.version}),error=>error.status===409);
    const force={version:review.version,confirmation:review.confirmation,overrideIssues:review.validation.errors.map(issue=>issue.id),overrideReason:'人员不足，经负责人确认临时发布',requestId:crypto.randomUUID()};
    assert.equal((await service.publish(root,shortage.version.id,force)).status,'published');
    assert.equal((await db.prepare('SELECT reason FROM roster_publication_overrides WHERE version_id=?').bind(shortage.version.id).first()).reason,force.overrideReason);
    const publishedRows=await repo.versionAssignments(republished.id),pausedRow=publishedRows[0];
    await repo.saveServiceDay({businessDate:pausedRow.businessDate,campusId:pausedRow.campusId,paused:true,reason:'测试暂停并保留已发布安排',revision:-1,requestId:crypto.randomUUID()},root);
    const protectedState=await service.rosterTaskState(root,task.id);
    assert.ok(protectedState.protectedAssignments.some(row=>row.memberId===pausedRow.memberId&&row.businessDate===pausedRow.businessDate));
    const pausedRevision=(await repo.rosterVersionsForTask(task.id)).find(row=>row.status==='draft')||await service.reviseRoster(root,task.id,{publishedVersionId:republished.id,requestId:crypto.randomUUID()});
    await assert.rejects(service.updateRoster(root,pausedRevision.id,{version:pausedRevision.version,assignments:publishedRows.filter(row=>row.id!==pausedRow.id),requestId:crypto.randomUUID()}),error=>error.status===409,'paused published facts cannot be silently deleted');
    const latestTask=await repo.rosterTaskById(task.id);
    await service.collectionCommand(root,task.id,{action:'close',revision:latestTask.revision,requestId:crypto.randomUUID()});
    const regenerated=await service.generate(root,{taskId:task.id,requestId:crypto.randomUUID()});
    assert.ok(regenerated.assignments.some(row=>row.memberId===pausedRow.memberId&&row.businessDate===pausedRow.businessDate&&row.campusId===pausedRow.campusId),'regeneration carries suspended published rows without assigning that slot anew');
    const pausedWeek=addDays(week,70),pausedTask=await service.createRosterTask(root,{...input,weekStart:pausedWeek,memberIds:[two.memberId],recurrence:{enabled:false},requestId:crypto.randomUUID()});
    for(let offset=0;offset<4;offset++)for(const campusId of campusIds)await repo.saveServiceDay({businessDate:addDays(pausedWeek,offset),campusId,paused:true,reason:'整周暂停',revision:-1,requestId:crypto.randomUUID()},root);
    await service.collectionCommand(root,pausedTask.id,{action:'close',revision:pausedTask.revision,requestId:crypto.randomUUID()});
    const noWork=await service.generate(root,{taskId:pausedTask.id,requestId:crypto.randomUUID()});
    assert.equal(noWork.assignments.length,0);assert.equal(noWork.validation.valid,true,'a suspended whole week creates neither assignments nor artificial shortages');
    assert.equal((await service.publish(root,noWork.version.id,{version:noWork.version.version})).status,'published');
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  }finally{await mf.dispose();}
});
