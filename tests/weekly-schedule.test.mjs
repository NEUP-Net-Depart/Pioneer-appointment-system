import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, seedStaff } from './helpers/database.mjs';
import { staffServices } from './fixtures/staff-services.mjs';
import { userRepository } from '../src/db/users.js';
const weekStart='2026-11-02',campusId='campus-nanhu',dutyType='repair';
const query={weekStart,campusId,dutyType};
const request=()=>crypto.randomUUID();
async function setup(){
 const db=database();for(const id of ['20261001','20261002','20261003'])seedStaff(db,id);seedStaff(db,'20261004','浑南');
 db.sqlite.exec("INSERT INTO member_department_memberships(id,member_id,department_id,position_code,assignment_type,is_primary,effective_from,created_at) VALUES('head','member-20261001','dept-network','head','primary',1,'2026-01-01','2026-01-01')");
 const users=userRepository(db),staff=staffServices(db,'00'.repeat(32));
 return {db,staff,head:await users.find('20261001'),one:await users.find('20261002'),two:await users.find('20261003'),outside:await users.find('20261004')};
}
function shift(memberId,date=weekStart){return {memberId,businessDate:date,startAt:'19:00',endAt:'21:00'};}
test('usual availability carries without weekly confirmation; exceptions apply to one week and can be removed',async()=>{
 const {db,staff,one}=await setup();try{
 const windows=[{weekday:7,campusId,startAt:'19:00',endAt:'21:00'}];
 await staff.saveAvailability(one,{dutyType,weekStart:'',revision:-1,windows,requestId:request()});
 const carried=await staff.availability(one,{dutyType,weekStart});assert.equal(carried.source,'usual');assert.equal(carried.updatedThisWeek,false);assert.deepEqual(carried.effectiveWindows,windows);
 const input={dutyType,weekStart,revision:-1,windows:[],requestId:request()};
 await Promise.all([staff.saveAvailability(one,input),staff.saveAvailability(one,input)]);
 assert.equal((await staff.availability(one,{dutyType,weekStart})).source,'exception');
 assert.deepEqual((await staff.availability(one,{dutyType,weekStart:'2026-11-09'})).effectiveWindows,windows);
 const restored=await staff.saveAvailability(one,{dutyType,weekStart,revision:0,useUsual:true,requestId:request()});
 assert.equal(restored.updatedThisWeek,false);
 assert.equal(restored.exception.revision,1);
 }finally{db.sqlite.close();}
});
test('publish without weekly questionnaires, direct leave, recipient takeover, scoped edits and revision conflicts',async()=>{
 const {db,staff,head,one,two,outside}=await setup();try{
 const input={...query,revision:-1,assignments:[shift(one.memberId),shift(two.memberId,'2026-11-03')],requestId:request()};
 const published=await staff.saveRosterWeek(head,input);assert.equal(published.assignments.length,2);
 await staff.saveRosterWeek(head,input);assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='rosters.week.published'").get().n,1);
 await assert.rejects(staff.saveRosterWeek(head,{...input,requestId:request()}),{status:409});
 await assert.rejects(staff.saveRosterWeek(one,{...input,revision:0,requestId:request()}),{status:403});
 await assert.rejects(staff.saveRosterWeek(head,{...input,campusId:'campus-hunnan',assignments:[shift(outside.memberId)],requestId:request()}),{status:403});
 assert.equal((await staff.rosterWeek(one,query)).assignments.length,1);
 const first=published.assignments.find(row=>row.memberId===one.memberId);
 const leave={revision:first.revision,reason:'临时有课',requestId:request()};await staff.leave(one,first.id,leave);await staff.leave(one,first.id,leave);
 let item=(await staff.rosterMine(one,{weekStart})).items[0];assert.equal(item.leaveStatus,'recorded');
 const invite=await staff.requestCover(one,item.id,{revision:item.revision,toMemberId:two.memberId,note:'已沟通',requestId:request()});
 await assert.rejects(staff.respondCover(one,invite.id,{revision:0,decision:'accepted',requestId:request()}),{status:403});
 const accepted={revision:0,decision:'accepted',requestId:request()};
 await Promise.all([staff.respondCover(two,invite.id,accepted),staff.respondCover(two,invite.id,accepted)]);
 assert.equal((await staff.rosterMine(two,{weekStart})).items.length,2);
 assert.equal(db.sqlite.prepare('SELECT member_id FROM duty_assignments WHERE id=?').get(first.id).member_id,two.memberId);
 assert.equal(db.sqlite.prepare('SELECT member_id FROM roster_leaves').get().member_id,one.memberId);
 assert.equal((await staff.rosterWeek(head,query)).assignments.find(row=>row.id===first.id).leaveStatus,'');
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM attendance_records').get().n,0);
 const current=await staff.rosterWeek(head,query);
 const changes={...query,revision:current.revision,assignments:current.assignments.map(row=>({...row,startAt:'18:30'})),requestId:request()};
 const results=await Promise.allSettled([staff.saveRosterWeek(head,changes),staff.saveRosterWeek(head,{...changes,requestId:request()})]);
 assert.equal(results.filter(row=>row.status==='fulfilled').length,1);
 assert.equal(db.sqlite.prepare('SELECT active FROM duty_assignments WHERE id=?').get(first.id).active,0,'old shift IDs remain in history');
 assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.sqlite.close();}
});
test('request IDs bind the assignment, and competing cover/time edits cannot overwrite each other',async()=>{
 const {db,staff,head,one,two}=await setup();try{
 const published=await staff.saveRosterWeek(head,{...query,revision:-1,assignments:[shift(one.memberId),shift(one.memberId,'2026-11-03'),shift(two.memberId)],requestId:request()});
 const mine=published.assignments.filter(row=>row.memberId===one.memberId);
 const input={revision:0,reason:'个人原因',requestId:request()};await staff.leave(one,mine[0].id,input);
 await assert.rejects(staff.leave(one,mine[1].id,input),{status:409});
 const invite=await staff.requestCover(one,mine[0].id,{revision:1,toMemberId:two.memberId,requestId:request()});
 await assert.rejects(staff.respondCover(two,invite.id,{revision:0,decision:'accepted',requestId:request()}),{status:409},'overlapping recipient assignment blocks takeover');
 assert.equal(db.sqlite.prepare('SELECT member_id FROM duty_assignments WHERE id=?').get(mine[0].id).member_id,one.memberId);
 await assert.rejects(staff.withdrawLeave(one,mine[0].id,{revision:0,requestId:request()}),{status:409});
 await staff.withdrawLeave(one,mine[0].id,{revision:1,requestId:request()});
 assert.equal((await staff.rosterMine(one,{weekStart})).items[0].leaveStatus,'');
 }finally{db.sqlite.close();}
});
for(const directory of ['migrations','database/staff-migrations'])test(`${directory}: roster cutover retains every shift and raw workflow fact, preserves pending leave and exchange`,async()=>{
 const db=database(directory,'0048_');try{
 seedStaff(db,'20261001');seedStaff(db,'20261002');
 db.sqlite.exec(`INSERT INTO roster_tasks(id,week_start,campus_scope,slot_start,slot_end,deadline,created_at) VALUES('task','2026-11-02','{"campusIds":["campus-nanhu"]}','19:00','21:00','2026-11-01','2026-10-30');
 INSERT INTO roster_versions(id,task_id,status,version,rule_version,algorithm_version,published_at,created_at) VALUES('past','task','superseded',1,'1','old','2026-11-01','2026-10-30'),('live','task','published',2,'1','old','2026-11-01','2026-10-30'),('draft','task','draft',3,'1','old',NULL,'2026-11-02');
 INSERT INTO duty_assignments(id,version_id,member_id,business_date,campus_id,duty_type,start_at,end_at,origin_assignment_id,previous_assignment_id) VALUES
 ('old','past','member-20261001','2026-11-02','campus-nanhu','repair','19:00','21:00','old',NULL),
 ('one','live','member-20261001','2026-11-02','campus-nanhu','repair','19:00','21:00','old','old'),
 ('two','live','member-20261002','2026-11-03','campus-nanhu','repair','19:00','21:00','two',NULL),
 ('draft-one','draft','member-20261001','2026-11-04','campus-nanhu','repair','19:00','21:00','draft-one',NULL);
 INSERT INTO leave_requests(id,assignment_id,member_id,reason,status,created_at) VALUES('leave','old','member-20261001','原请假原因','pending','2026-11-01');
 INSERT INTO swap_requests(id,from_assignment_id,to_assignment_id,from_member_id,to_member_id,from_revision,to_revision,note,created_at) VALUES('swap','one','two','member-20261001','member-20261002',0,0,'互换约定','2026-11-01');
 INSERT INTO roster_submissions(task_id,member_id,submitted_at,source) VALUES('task','member-20261001','2026-11-01','manual'),('task','member-20261002','2026-11-01','carried');
 INSERT INTO availability(id,task_id,member_id,business_date,start_at,end_at,campus_id) VALUES('availability','task','member-20261001','2026-11-08','19:00','21:00','campus-nanhu');
 INSERT INTO roster_availability_preferences(member_id,duty_type,windows,source_task_id,updated_at) VALUES('member-20261002','repair','[{"weekday":1,"campusId":"campus-nanhu","startAt":"19:00","endAt":"21:00"}]','task','2026-11-01');`);
 const assignments=db.sqlite.prepare('SELECT * FROM duty_assignments ORDER BY id').all();
 db.sqlite.exec(readFileSync(`${directory}/0048_weekly_schedule.sql`,'utf8'));
 assert.deepEqual(db.sqlite.prepare('SELECT id FROM duty_assignments ORDER BY id').all().map(row=>row.id),assignments.map(row=>row.id));
 for(const original of assignments){const archived=db.sqlite.prepare("SELECT before_json FROM audit_events WHERE action='rosters.model.migrated' AND json_extract(source_ref,'$.type')='duty_assignments' AND json_extract(before_json,'$.id')=?").get(original.id);assert.deepEqual(JSON.parse(archived.before_json),{...original});}
 assert.deepEqual(db.sqlite.prepare('SELECT id FROM duty_assignments WHERE active=1 ORDER BY id').all().map(row=>row.id),['one','two']);
 assert.equal(db.sqlite.prepare('SELECT assignment_id FROM roster_leaves').get().assignment_id,'one');
 assert.equal(db.sqlite.prepare('SELECT exchange_assignment_id FROM roster_covers').get().exchange_assignment_id,'two');
 const availability=db.sqlite.prepare('SELECT * FROM member_availability ORDER BY member_id').all();assert.equal(availability.length,2);assert.equal(JSON.parse(availability[0].windows)[0].weekday,7);assert.equal(availability[1].week_start,'');
 assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 const staff=staffServices(db,'00'.repeat(32)),two=await userRepository(db).find('20261002');await staff.respondCover(two,'swap',{revision:0,decision:'accepted',requestId:request()});
 assert.equal(db.sqlite.prepare("SELECT member_id FROM duty_assignments WHERE id='one'").get().member_id,two.memberId);
 assert.equal(db.sqlite.prepare("SELECT member_id FROM duty_assignments WHERE id='two'").get().member_id,'member-20261001');
 }finally{db.sqlite.close();}
});
