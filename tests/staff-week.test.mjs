import {test} from 'node:test';
import assert from 'node:assert/strict';
import {weekRange, calendarWeekRange, rosterWeekKey} from '../shared/time.js';
import {appointmentService} from '../src/services/appointments.js';

test('week boundaries use Monday through Sunday across weekends and years',()=>{
  assert.deepEqual(weekRange('2026-10-12'),{start:'2026-10-12',end:'2026-10-18'});
  assert.deepEqual(weekRange('2026-10-18'),{start:'2026-10-12',end:'2026-10-18'});
  assert.deepEqual(weekRange('2027-01-01'),{start:'2026-12-28',end:'2027-01-03'});
});

test('calendar weeks begin on Sunday while roster keys retain their Monday identifier',()=>{
  assert.deepEqual(calendarWeekRange('2026-11-15'),{start:'2026-11-15',end:'2026-11-21'});
  assert.deepEqual(calendarWeekRange('2026-11-21'),{start:'2026-11-15',end:'2026-11-21'});
  assert.deepEqual(calendarWeekRange('2027-01-01'),{start:'2026-12-27',end:'2027-01-02'});
  assert.equal(rosterWeekKey('2026-11-15'),'2026-11-16');
  assert.equal(rosterWeekKey('2026-11-21'),'2026-11-16');
  assert.equal(rosterWeekKey('2026-11-22'),'2026-11-23');
});

test('Sunday weekly overview starts the new week and excludes the prior service week',async()=>{
  let range;
  const repository={expirePending:async()=>{},overview:async(start,end,campuses)=>{
    range={start,end,campuses};
    return {totals:[{campus:'南湖',date:'2026-10-12',time_slot:'19:00–20:00',occupied:3,booked:0,in_progress:1}],capacities:[{campus:'南湖',date:'2026-10-12',time_slot:'19:00–20:00',capacity:10}]};
  }};
  const service=appointmentService(repository,{},'',()=>new Date('2026-10-18T04:00:00Z'),{scopedActor:async actor=>actor});
  const result=await service.overview({account:'staff',role:'technician',status:'enabled',authorizedCampuses:['南湖']});
  assert.deepEqual(range,{start:'2026-10-18',end:'2026-10-24',campuses:['南湖']});
  assert.deepEqual(result.dates,['2026-10-19','2026-10-20','2026-10-21','2026-10-22']);
  assert.deepEqual(result.week.dates,['2026-10-19','2026-10-20','2026-10-21','2026-10-22']);
  assert.equal(result.week.start,'2026-10-18');
  assert.equal(result.week.end,'2026-10-24');
  assert.equal(result.week.items.length,0);
});
