import { test } from 'node:test';
import assert from 'node:assert/strict';

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
 const changes={...query,revision:current.revision,assignments:current.assignments.map((row,index)=>({...row,businessDate:index?'2026-11-05':'2026-11-04'})),requestId:request()};
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
