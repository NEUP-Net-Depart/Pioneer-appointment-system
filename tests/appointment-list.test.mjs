import test from 'node:test';
import assert from 'node:assert/strict';
import {appointmentService} from '../src/services/appointments.js';
import {fieldWorkflow} from '../src/services/field-workflow.js';
import {createAuthorizer} from '../src/modules/authorization/public.js';
import {DatabaseSync} from 'node:sqlite';
import {listAppointments} from '../src/db/appointment-list.js';
import {appointmentAccessRules} from '../src/modules/authorization/appointment-access.js';

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
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE appointments(id TEXT PRIMARY KEY,status TEXT,campus TEXT,date TEXT,time_slot TEXT,name TEXT,student_id TEXT,device_model TEXT,repair_number TEXT,created_at TEXT,assigned_to TEXT);
    CREATE TABLE staff_accounts(account TEXT PRIMARY KEY,member_id TEXT);
    CREATE TABLE repair_receptions(appointment_id TEXT PRIMARY KEY,state TEXT,assigned_member_id TEXT);`);
  for(const row of rows) database.prepare('INSERT INTO appointments VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(row.id,row.status,row.campus,row.date,row.timeSlot,row.name,row.studentId,row.deviceModel,null,'2026-10-20T10:00:00Z','');
  const d1 = {prepare:sql=>({bind:(...args)=>{assert.ok(args.length<=100);return {sql,args};}}),batch:async statements=>statements.map(({sql,args})=>({results:database.prepare(sql).all(...args)}))};
  const repository = {
    expirePending:async () => {},
    list:async (query,scope) => {
      queries.push(query);
      return listAppointments(d1,'SELECT appointments.* FROM appointments',row=>({...row,timeSlot:row.time_slot,studentId:row.student_id,deviceModel:row.device_model,createdAt:row.created_at}),query,scope);
    }
  };
  const staff = {scopedActor:async value => value,contextFor:async () => context};
  staff.field = fieldWorkflow({staff,appointments:repository,authorizer:createAuthorizer(),enabled:true});
  const service = appointmentService(repository,{},'',() => new Date('2026-10-20T10:00:00Z'),staff);
  const expected = {all:4,booked:1,in_progress:1,completed:1,cancelled:1,expired:0};
  for (const q of ['同名学生','20269999']) for (const status of ['all','pending','completed','expired']) {
    const result = await service.list({q,status,date:'2026-10-20',timeSlot:'19:00–19:30'},actor);
    assert.deepEqual(result.filteredCounts,expected,`${q}, ${status}: facets precede status selection`);
    assert.deepEqual(result.items.map(row => row.id),status==='all'?['repair','completed','cancelled','booked']:status==='pending'?['repair','booked']:status==='completed'?['completed']:[]);
    assert.ok(result.items.every(row => row.name==='同名学生'));
  }
  const model = await service.list({q:'THINKPAD',status:'all',date:'2026-10-20',timeSlot:'19:00–19:30'},actor);
  assert.equal(model.filteredCounts.all,5,'a visible summary may match its device model without revealing identity');
  assert.equal(model.items.find(row => row.id==='redacted').name,undefined);
  const empty = await service.list({q:'no match',status:'all',date:'2026-10-20',timeSlot:'19:00–19:30'},actor);
  assert.deepEqual(empty.filteredCounts,{all:0,booked:0,in_progress:0,completed:0,cancelled:0,expired:0});
  assert.ok(queries.every(query => query.q), 'search and status reach D1 before projection');
  for (const sorts of [[],[{key:'status',direction:'asc'}],[{key:'campus',direction:'desc'},{key:'date',direction:'asc'}]]) {
    const query={q:'THINKPAD',status:'all',date:'2026-10-20',timeSlot:'19:00–19:30',limit:2,sorts};
    const ids=[]; let cursor;
    do {
      const page=await service.list({...query,cursor},actor);
      assert.equal(page.filteredCounts.all,5,'facets count all matches, not just this page');
      assert.ok(page.items.length<=2);
      ids.push(...page.items.map(item=>item.id));cursor=page.nextCursor;
    } while(cursor);
    assert.equal(new Set(ids).size,5);
    assert.equal(ids.length,5);
    assert.ok(!ids.includes('hidden'));
  }
  const manyGrants=await listAppointments(d1,'SELECT appointments.* FROM appointments',row=>row,{status:'all',limit:1},{campuses:['南湖'],summaryRules:Array.from({length:200},()=>({campus:'南湖',objectIds:['booked']}))});
  assert.equal(manyGrants.items[0].id,'booked');assert.equal(manyGrants.counts.all,1);
  for(let i=0;i<240;i++) database.prepare('INSERT INTO appointments(id,status,campus,created_at) VALUES(?,?,?,?)').run(`bulk-${i}`,'cancelled','南湖','2026-10-20T10:00:00Z');
  const defaultPage=await listAppointments(d1,'SELECT appointments.* FROM appointments',row=>row,{status:'all'},{campuses:['南湖']});
  assert.equal(defaultPage.items.length,200);assert.equal(defaultPage.counts.all,248);assert.equal(defaultPage.filteredCounts.all,248);assert.ok(defaultPage.nextCursor);
  const tail=await listAppointments(d1,'SELECT appointments.* FROM appointments',row=>row,{status:'all',cursor:defaultPage.nextCursor},{campuses:['南湖']});
  assert.equal(tail.items.length,48);assert.equal(tail.nextCursor,null);assert.equal(new Set([...defaultPage.items,...tail.items].map(row=>row.id)).size,248);
  database.close();
});

test('appointment query projections agree with complete grants for owner, date, campus, object and conditions',()=>{
  const authorizer=createAuthorizer(),actor={memberId:'manager',authorizedCampuses:['南湖','浑南']};
  const context={actor,businessDate:'2026-10-20',presence:{campusId:'campus-nanhu',businessDate:'2026-10-20'},todayDuties:[{campusId:'campus-nanhu',businessDate:'2026-10-20',roleKind:'repair_lead'}],memberships:[{departmentId:'dept-office'}],workProfiles:[{profileCode:'repair'}]};
  for(const scope of [{},{self:true},{objectIds:['allowed']},{campusIds:['campus-hunnan']},{departmentIds:['dept-office']},{campusIds:['campus-nanhu'],objectIds:['allowed'],self:true}]) for(const conditions of [[],[{code:'ownResource'}],[{code:'activeDutyRole'}],[{code:'signedDutyPresence'}],[{code:'activeDepartmentMembership',parameters:{departmentId:'dept-office'}}],[{code:'repairWorkEligible'}],[{code:'ownResource'},{code:'activeDutyRole'}]]) {
    const grant={permissionCode:'repair.summary.read',scope,conditions},current={...context,grants:[grant]};
    const rules=appointmentAccessRules(authorizer,actor,grant.permissionCode,current);
    for(const campus of ['南湖','浑南'])for(const assignedMemberId of ['manager','other',''])for(const businessDate of ['2026-10-20','2026-10-19'])for(const id of ['allowed','hidden']){
      const target={campusId:campus==='南湖'?'campus-nanhu':'campus-hunnan',assignedMemberId,businessDate,id};
      const projected=rules.some(rule=>rule.campus===campus&&(rule.memberId===undefined||rule.memberId===assignedMemberId)&&(!rule.date||rule.date===businessDate)&&(!rule.objectIds||rule.objectIds.includes(id)));
      assert.equal(projected,authorizer.evaluate(actor,grant.permissionCode,target,current,[grant]).allowed,JSON.stringify({scope,conditions,target}));
    }
  }
});
