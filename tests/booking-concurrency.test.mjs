import { signatureFixture } from './fixtures/signature.mjs';
import {randomBytes} from 'node:crypto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {repairScenario} from './fixtures/repair-scenario.mjs';
import {bookingInput} from '../src/lib/validation.js';
import {AGREEMENT_VERSION} from '../shared/student-booking.js';

test('competing online bookings cannot exceed capacity; onsite orders do not consume the online pool',async t=>{
  const {db,users,staff,service,calendar,clock}=repairScenario(t,{time:'10:00'});
  const date=calendar.serviceDay,timeSlot='19:00–19:30';
  db.sqlite.prepare('UPDATE weekday_slot_capacities SET capacity=1 WHERE campus=? AND time_slot=?').run('南湖',timeSlot);
  db.sqlite.prepare('INSERT INTO service_locations(campus,date,location,updated_at) VALUES(?,?,?,?)').run('南湖',date,'容量测试地点',date);
  const data=id=>bookingInput({studentId:id,name:'容量测试',college:'计算机科学与工程学院',campus:'南湖',deviceType:'笔记本',brand:'联想',deviceModel:'',warranty:'否',liquidMetal:'不清楚',faultType:'蓝屏',date,timeSlot,contactType:'qq',contactValue:'123456789',agreementAccepted:true,agreementVersion:AGREEMENT_VERSION,agreementAt:clock().toISOString(),signature:signatureFixture()});
  const outcomes=await Promise.allSettled(Array.from({length:8},(_,i)=>service.create(data(String(20269001+i)),undefined,randomBytes(32).toString('base64url'))));
  assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,1,outcomes.map(row=>row.reason?.message).join('; '));
  assert.ok(outcomes.filter(row=>row.status==='rejected').every(row=>/SLOT_FULL/.test(row.reason.message)));
  const actor=await users.find('20260001');
  const context=await staff.contextFor(actor);
  await service.create(data('20269999'),{actor:actor.account,authVersion:context.authVersion,campuses:actor.authorizedCampuses,requestId:crypto.randomUUID()},randomBytes(32).toString('base64url'));
  const counts=db.sqlite.prepare('SELECT source,COUNT(*) n FROM appointments GROUP BY source ORDER BY source').all();assert.deepEqual(counts.map(row=>[row.source,row.n]),[['booking',1],['onsite',1]]);
  await assert.rejects(service.create(data('20269998'),undefined,randomBytes(32).toString('base64url')),/SLOT_FULL/);
  assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
});
