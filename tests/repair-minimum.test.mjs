import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optimizeRepairMinimum } from '../src/modules/rosters/repair-minimum.ts';
import {generateRoster,validateRoster} from '../src/modules/rosters/solver.js';
import {repairRosterPool,rosterFactContext} from '../src/modules/rosters/qualification.js';
import {createAuthorizer} from '../src/modules/authorization/public.js';
import {staffIdentities} from '../shared/staff-identities.js';

const slots = Array.from({length:4},(_,i)=>({businessDate:`2026-10-${19+i}`,campusId:'nanhu',startAt:'19:00',endAt:'21:00',ordinaryMinimum:2}));
const person = (id,pool,available=slots) => ({memberId:id,pool,available,leadSlots:pool==='lead'?available:[]});
const people = () => [...Array.from({length:5},(_,i)=>person(`l${i}`,'lead')),...Array.from({length:9},(_,i)=>person(`r${i}`,'ordinary'))];
test('separate pools schedule exactly one leader and at least N ordinary staff, with optional spare leaders and surplus staff',()=>{
  const result=optimizeRepairMinimum({slots,members:people()});
  assert.equal(result.complete,true);
  assert.equal(result.assignments.length,13);
  assert.equal(new Set(result.assignments.map(row=>row.memberId)).size,13);
  for(const slot of slots){
    const rows=result.assignments.filter(row=>row.businessDate===slot.businessDate);
    assert.equal(rows.filter(row=>row.roleKind==='repair_lead').length,1);
    assert.ok(rows.filter(row=>!row.roleKind).length>=2);
  }
});
test('scarce availability uses augmenting paths; unavailable ordinary members remain explicit in the caller validation',()=>{
  const members=[person('lead-flex','lead',slots),...slots.slice(0,3).map((slot,i)=>person(`lead${i}`,'lead',[slot])),
    ...slots.flatMap((slot,i)=>[person(`one${i}`,'ordinary',[slot]),person(`two${i}`,'ordinary',[slot])]),person('none','ordinary',[])];
  const result=optimizeRepairMinimum({slots,members});
  assert.equal(result.complete,true);
  assert.equal(result.assignments.find(row=>row.memberId==='lead-flex').businessDate,slots[3].businessDate);
  assert.equal(result.assignments.some(row=>row.memberId==='none'),false);
});
test('shortages produce useful partial assignments without extra leaders or invented people',()=>{
  const members=[person('lead','lead'),person('repair','ordinary')];
  const result=optimizeRepairMinimum({slots,members});
  assert.equal(result.complete,false);
  assert.equal(result.reason,'coverage_infeasible');
  assert.equal(result.assignments.length,2);
  assert.ok(result.assignments.every(row=>members.some(member=>member.memberId===row.memberId)));
});
test('locked leader cannot consume an ordinary place and two locked leaders cannot cover one day',()=>{
  const members=people();
  const lock={...slots[0],memberId:'l0',roleKind:'repair_lead'};
  assert.equal(optimizeRepairMinimum({slots,members,locked:[lock]}).complete,true);
  assert.equal(optimizeRepairMinimum({slots,members,locked:[{...lock,roleKind:''}]}).reason,'invalid_locks_or_slots');
  assert.equal(optimizeRepairMinimum({slots,members,locked:[lock,{...lock,memberId:'l1'}]}).reason,'invalid_locks_or_slots');
});
test('generation and manual validation agree on pools, weekly obligations and surplus leaders',()=>{
  const input={ruleVersion:'repair-minimum-v2',requireLead:true,slots,members:people()};
  const result=generateRoster(input);
  assert.equal(validateRoster(result,input).valid,true);
  assert.equal(result.optionalUnassigned.length,1);
  assert.deepEqual(result.unassigned,[]);
  const wrong={assignments:[...result.assignments,{...slots[0],memberId:result.optionalUnassigned[0],roleKind:'repair_lead'}]};
  assert.ok(validateRoster(wrong,input).errors.some(error=>error.code==='LEAD_SURPLUS'));
  const removed={assignments:result.assignments.filter(row=>row.memberId!=='r0')};
  assert.ok(validateRoster(removed,input).errors.some(error=>error.code==='MEMBER_WEEK_MISSING'));
  const unavailable=generateRoster({...input,members:[...input.members,person('unavailable','ordinary',[])]});
  assert.equal(unavailable.solverStatus,'needs_review');
  assert.deepEqual(unavailable.unassigned,['unavailable']);
});
test('scheduling leaders are derived from effective scoped authorization; exchange never enters either pool',()=>{
  const fact={memberId:'lead',active:true,campuses:['campus-nanhu'],profiles:[],grants:[{roleCode:'repair_lead',permissionCode:'repair.transfer',scope:{campusIds:['campus-nanhu']},conditions:[{code:'signedDutyPresence',version:1}],validity:{effectiveTo:'2026-10-21'}}]};
  const authorizer=createAuthorizer();
  assert.equal(repairRosterPool(fact,authorizer,'2026-10-19',{campusId:'campus-nanhu'}),'lead');
  assert.equal(repairRosterPool(fact,authorizer,'2026-10-19',{campusId:'campus-hunnan'}),'');
  assert.equal(repairRosterPool(fact,authorizer,'2026-10-21',{campusId:'campus-nanhu'}),'');
  assert.equal(repairRosterPool({...fact,profiles:[{profileCode:'exchange',effectiveFrom:'2026-01-01'}]},authorizer,'2026-10-19',{campusId:'campus-nanhu'}),'');
  assert.equal(repairRosterPool({...fact,grants:[],profiles:[{profileCode:'repair_lead',effectiveFrom:'2026-01-01'}]},authorizer,'2026-10-19',{campusId:'campus-nanhu'}),'');
  assert.equal(repairRosterPool({...fact,grants:fact.grants.map(grant=>({...grant,roleCode:'custom_coordinator'}))},authorizer,'2026-10-19',{campusId:'campus-nanhu'}),'');
  assert.equal(repairRosterPool({...fact,grants:[],profiles:[{profileCode:'repair'}],assignments:[{roleKind:'repair_lead',businessDate:'2026-10-19'}]},authorizer,'2026-10-19',{campusId:'campus-nanhu'}),'ordinary');
});
test('combined office and repair leader identities stay unique and respect each campus scope',()=>{
  const authorizer=createAuthorizer();
  const repairGrant={roleCode:'repair_lead',permissionCode:'repair.transfer',scope:{campusIds:['campus-nanhu']},conditions:[{code:'signedDutyPresence',version:1}]};
  const fact={memberId:'multi',active:true,campuses:['campus-nanhu','campus-hunnan'],profiles:[{profileCode:'repair',effectiveFrom:'2026-01-01'},{profileCode:'office',effectiveFrom:'2026-01-01'}],grants:[repairGrant,{...repairGrant},{roleCode:'office_lead',permissionCode:'roster.office.manage',scope:{campusIds:['campus-hunnan']}}]};
  assert.deepEqual(staffIdentities(rosterFactContext(fact,'2026-10-19'),authorizer).map(item=>item.code),['repair','office','repair_lead','office_lead']);
  assert.equal(repairRosterPool(fact,authorizer,'2026-10-19',{campusId:'campus-nanhu'}),'lead');
  assert.equal(repairRosterPool(fact,authorizer,'2026-10-19',{campusId:'campus-hunnan'}),'ordinary','office leadership does not grant repair leadership');
  assert.equal(repairRosterPool({...fact,profiles:[...fact.profiles,{profileCode:'exchange',effectiveFrom:'2026-01-01'}]},authorizer,'2026-10-19',{campusId:'campus-nanhu'}),'','exchange qualification excludes scheduled repair shifts');
});
test('a dual-role member cannot be assigned overlapping office and repair shifts',()=>{
  const slot={...slots[0],dutyType:'repair',ordinaryMinimum:1};
  const members=[{...person('multi','lead',[slot]),existingAssignments:[{businessDate:slot.businessDate,startAt:'20:00',endAt:'21:00',dutyType:'office'}]},person('ordinary','ordinary',[slot])];
  const input={ruleVersion:'repair-minimum-v2',slots:[slot],members,requireLead:true};
  const assignments=[{...slot,memberId:'multi',roleKind:'repair_lead'},{...slot,memberId:'ordinary',roleKind:''}];
  assert.ok(validateRoster({assignments},input).errors.some(error=>error.code==='TIME_CONFLICT'));
  assert.equal(validateRoster({assignments},{...input,members:[{...members[0],existingAssignments:[{businessDate:slot.businessDate,startAt:'17:00',endAt:'19:00',dutyType:'office'}]},members[1]]}).errors.some(error=>error.code==='TIME_CONFLICT'),false);
});
