import {test} from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {generateRoster, validateRoster} from '../src/modules/rosters/solver.js';

const slotsFor = (campus = 'a', days = 4) => Array.from({length:days},(_,day) => ({campusId:campus,businessDate:`2026-10-${19 + day}`,startAt:'19:00',endAt:'21:00'}));
const sameSlot = (a,b) => ['campusId','businessDate','startAt','endAt'].every(key => a[key] === b[key]);
const canAttend = (member,slot) => (member.available || []).some(window => window.businessDate === slot.businessDate && (!window.campusId || window.campusId === slot.campusId) && window.startAt <= slot.startAt && window.endAt >= slot.endAt);
const canLead = (member,slot) => member.leadSlots ? member.leadSlots.some(value => sameSlot(value,slot)) : member.isLead === true;
function objective(rows, slots) {
  const counts = slots.map(slot => rows.filter(row => row.leaveStatus !== 'approved' && sameSlot(row,slot)).length);
  let spread = 0, deviation = 0;
  for (const campus of new Set(slots.map(slot => slot.campusId))) {
    const values = counts.filter((_,index) => slots[index].campusId === campus);
    const mean = values.reduce((a,b) => a+b,0) / values.length;
    spread += Math.max(...values) - Math.min(...values);
    deviation += values.reduce((sum,value) => sum + (value - mean) ** 2,0);
  }
  return [-rows.filter(row => row.leaveStatus !== 'approved').length,spread,deviation];
}
const better = (a,b) => !b || a[0] < b[0] || a[0] === b[0] && (a[1] < b[1] || a[1] === b[1] && a[2] < b[2] - 1e-9);
// Independent exhaustive assignment oracle: no network, capacities, interval
// enumeration or production validator. Unassignment remains a real choice.
function exhaustive(input) {
  let best = null;
  function visit(index, rows) {
    if (index === input.members.length) {
      for (const slot of input.slots) {
        const present = rows.filter(row => row.leaveStatus !== 'approved' && sameSlot(row,slot));
        if (!present.length || (input.requireLead || slot.requireLead) && !present.some(row => canLead(input.members.find(member => member.memberId === row.memberId),slot))) return;
      }
      const value = objective(rows,input.slots);
      if (better(value,best)) best = value;
      return;
    }
    const member = input.members[index], lock = input.locked?.find(row => row.memberId === member.memberId);
    if (lock) { if (canAttend(member,lock)) visit(index+1,[...rows,lock]); return; }
    visit(index+1,rows);
    for (const slot of input.slots) if (canAttend(member,slot)) visit(index+1,[...rows,{...slot,memberId:member.memberId}]);
  }
  visit(0,[]); return best;
}
function compare(input) {
  const expected = exhaustive(input), result = generateRoster(input);
  if (!expected) { assert.equal(result.solverStatus,'needs_review'); return result; }
  assert.equal(result.solverStatus,'optimal',JSON.stringify(result.inputSnapshotRef.optimization));
  assert.equal(validateRoster(result,input).valid,true);
  const actual = objective(result.assignments,input.slots);
  assert.deepEqual(actual.slice(0,2),expected.slice(0,2));
  assert.ok(Math.abs(actual[2]-expected[2]) < 1e-8,`${actual} != ${expected}`);
  return result;
}

test('seven-person counterexample achieves the feasible 2/2/2/1 balance', () => {
  const slots = slotsFor();
  const members = [[0,1,3],[0,1],[2,3],[0,1,2],[0,1],[0,2],[0,2]].map((days,index) => ({memberId:String(index),isLead:true,available:days.map(day => slots[day])}));
  const result = compare({members,slots,requireLead:true});
  assert.deepEqual(result.inputSnapshotRef.optimization.campuses[0].counts.toSorted(),[1,2,2,2]);
  const interrupted = generateRoster({members,slots,requireLead:true,optimizationBudget:1200});
  assert.equal(interrupted.solverStatus,'feasible');
  assert.equal(interrupted.inputSnapshotRef.optimization.complete,false);
  assert.deepEqual(interrupted.assignments,result.assignments,'an interrupted proof retains its completed incumbent');
});

test('forced concentration, empty availability, scarce leaders and locked placement match exhaustive optima', () => {
  const slots = slotsFor();
  compare({slots,requireLead:true,members:Array.from({length:8},(_,i) => ({memberId:String(i),isLead:true,available:[slots[i < 5 ? 0 : i-4]]}))});
  compare({slots:slots.slice(0,2),requireLead:true,members:[
    {memberId:'a',available:slots,isLead:true},{memberId:'b',available:[slots[0]],isLead:true},
    {memberId:'c',available:slots},{memberId:'d',available:[]}
  ]});
  compare({slots:slots.slice(0,2),requireLead:true,locked:[{memberId:'a',...slots[0],roleKind:''}],members:[
    {memberId:'a',available:slots,isLead:true},{memberId:'b',available:slots,isLead:true},
    {memberId:'c',available:slots},{memberId:'d',available:slots}
  ]});
  compare({slots,requireLead:true,members:[{memberId:'a',available:slots,isLead:true}]});
});

test('small seeded inputs match an independent exhaustive oracle across campuses and qualifications', () => {
  let state = 82691;
  const random = () => {state = (Math.imul(state,1664525) + 1013904223) >>> 0; return state / 2 ** 32;};
  for (let run = 0; run < 90; run++) {
    const slots = run % 2 ? [...slotsFor('a',2),...slotsFor('b',2)] : slotsFor();
    const members = Array.from({length:6},(_,i) => ({memberId:`m${i}`,available:slots.filter(() => random() < .65),leadSlots:slots.filter(() => random() < .6)}));
    const locked = run % 3 === 0 && members[0].available.length ? [{memberId:'m0',...members[0].available[0]}] : [];
    compare({members,slots,locked,requireLead:run % 4 !== 0});
  }
});

test('campus-local balance does not redistribute a larger campus merely to equalize global counts', () => {
  const slots = [...slotsFor('a',2),...slotsFor('b',2)];
  const members = Array.from({length:8},(_,i) => ({memberId:String(i),isLead:true,available:slots.filter(slot => slot.campusId === (i < 6 ? 'a' : 'b'))}));
  const result = compare({slots,members,requireLead:true});
  assert.deepEqual(result.inputSnapshotRef.optimization.campuses.map(row => row.counts),[[3,3],[1,1]]);
});

test('stable ordering, invalid locks and budget exhaustion have honest recoverable results', () => {
  const slots = slotsFor(), members = Array.from({length:8},(_,i) => ({memberId:String(i),available:slots,isLead:true}));
  const input = {slots,members,requireLead:true};
  assert.deepEqual(generateRoster(input).assignments,generateRoster({...input,slots:[...slots].reverse(),members:[...members].reverse()}).assignments);
  const locked = [{memberId:'0',...slots[0]},{memberId:'1',...slots[1]}];
  assert.deepEqual(generateRoster({...input,locked}).assignments,generateRoster({...input,locked:[...locked].reverse()}).assignments);
  const limited = generateRoster({...input,optimizationBudget:1});
  assert.equal(limited.inputSnapshotRef.optimization.reason,'budget_exhausted');
  assert.equal(limited.solverStatus,'feasible');
  assert.equal(validateRoster(limited,input).valid,true);
  const invalid = generateRoster({...input,locked:[{memberId:'missing',...slots[0]}]});
  assert.equal(invalid.solverStatus,'needs_review');
  assert.equal(invalid.inputSnapshotRef.optimization.complete,false);
  const leave = compare({...input,locked:[{memberId:'0',...slots[0],leaveStatus:'approved'}]});
  assert.equal(leave.inputSnapshotRef.optimization.objective.assigned,7);
});

test('200 members across two campuses and four days produce an independently valid bounded result', t => {
  const slots = [...slotsFor('a'),...slotsFor('b')];
  for (const restricted of [false,true]) {
    const members = Array.from({length:200},(_,i) => ({memberId:`m${String(i).padStart(3,'0')}`,isLead:i % 5 === 0,
      available:slots.filter((slot,index) => !restricted || slot.campusId === (i < 75 ? 'a' : 'b') && (i % 3 !== 0 || index % 4 === i % 4))}));
    const start = performance.now(), result = generateRoster({members,slots,requireLead:true});
    const elapsed = performance.now()-start, metadata = result.inputSnapshotRef.optimization;
    t.diagnostic(JSON.stringify({restricted,milliseconds:Math.round(elapsed),status:result.solverStatus,...metadata}));
    assert.equal(validateRoster(result,{members,slots,requireLead:true}).valid,true);
    assert.equal(result.assignments.length,200);
    assert.ok(metadata.work <= 8_000_001);
    assert.equal(result.solverStatus,'optimal','both representative loads must complete within the default budget');
  }
});
