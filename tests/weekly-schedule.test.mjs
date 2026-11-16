import { runModel, rejectWithoutWrite } from './fixtures/workflow-seed.mjs';
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
  await availabilityModel();
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
  await rosterModel();
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

async function availabilityModel() {
  const windows = [{ weekday: 7, campusId, startAt: '19:00', endAt: '21:00' }];
  const save = async (r, useUsual) => {
    const current = await r.staff.availability(r.one, { dutyType, weekStart });
    await r.staff.saveAvailability(r.one, {
      dutyType,
      weekStart,
      revision: current.exception?.revision ?? -1,
      windows: [],
      useUsual,
      requestId: request()
    });
  };
  await runModel({
    name: 'availability',
    initial: 'usual',
    edges: [
      { from: 'usual', to: 'exception', event: 'OVERRIDE', run: (r) => save(r, false) },
      { from: 'exception', to: 'usual', event: 'RESTORE', run: (r) => save(r, true) }
    ],
    setup: async () => {
      const r = await setup();
      r.dispose = () => r.db.sqlite.close();
      await r.staff.saveAvailability(r.one, {
        dutyType,
        weekStart: '',
        revision: -1,
        windows,
        requestId: request()
      });
      return r;
    },
    observe: async (r, state) => {
      const result = await r.staff.availability(r.one, { dutyType, weekStart });
      assert.equal(result.source, state);
      assert.deepEqual(result.effectiveWindows, state === 'usual' ? windows : []);
      assert.deepEqual(
        (await r.staff.availability(r.one, { dutyType, weekStart: '2026-11-09' })).effectiveWindows,
        windows
      );
    }
  });
}
async function rosterModel() {
  const assignment = async (r) => (await r.staff.rosterWeek(r.head, query)).assignments[0];
  const leave = async (r) => {
    const a = await assignment(r);
    await r.staff.leave(r.one, a.id, {
      revision: a.revision,
      reason: '有课',
      requestId: request()
    });
  };
  const invite = async (r) => {
    const a = await assignment(r);
    r.invite = await r.staff.requestCover(r.one, a.id, {
      revision: a.revision,
      toMemberId: r.two.memberId,
      requestId: request()
    });
  };
  const response = (r, decision, actor = r.two) =>
    r.staff.respondCover(actor, r.invite.id, { revision: 0, decision, requestId: request() });
  const edges = [
    [
      'empty',
      'published',
      'PUBLISH',
      async (r) => {
        r.input = {
          ...query,
          revision: -1,
          assignments: [shift(r.one.memberId)],
          requestId: request()
        };
        await r.staff.saveRosterWeek(r.head, r.input);
      }
    ],
    [
      'published',
      'published',
      'REPLAY',
      async (r) => {
        const before = r.db.sqlite.prepare('SELECT COUNT(*) n FROM audit_events').get().n;
        await r.staff.saveRosterWeek(r.head, r.input);
        assert.equal(r.db.sqlite.prepare('SELECT COUNT(*) n FROM audit_events').get().n, before);
      }
    ],
    [
      'published',
      'published',
      'REJECT_STALE',
      (r) =>
        rejectWithoutWrite(
          r.db,
          () => r.staff.saveRosterWeek(r.head, { ...r.input, requestId: request() }),
          { status: 409 }
        )
    ],
    [
      'published',
      'published',
      'REJECT_MEMBER',
      (r) =>
        rejectWithoutWrite(
          r.db,
          () => r.staff.saveRosterWeek(r.one, { ...r.input, revision: 0, requestId: request() }),
          { status: 403 }
        )
    ],
    ['published', 'leave', 'LEAVE', leave],
    [
      'leave',
      'published',
      'WITHDRAW',
      async (r) => {
        const a = await assignment(r);
        await r.staff.withdrawLeave(r.one, a.id, { revision: a.revision, requestId: request() });
      }
    ],
    ['leave', 'pending', 'INVITE', invite],
    [
      'pending',
      'pending',
      'REJECT_SENDER_ACCEPT',
      (r) => rejectWithoutWrite(r.db, () => response(r, 'accepted', r.one), { status: 403 })
    ],
    ['pending', 'accepted', 'ACCEPT', (r) => response(r, 'accepted')],
    ['pending', 'declined', 'DECLINE', (r) => response(r, 'declined')],
    ['pending', 'cancelled', 'CANCEL', (r) => response(r, 'cancelled', r.one)],
    ...['accepted', 'declined', 'cancelled'].map((state) => [
      state,
      state,
      'REJECT_SECOND_DECISION',
      (r) => rejectWithoutWrite(r.db, () => response(r, 'accepted'), { status: 409 })
    ]),
    [
      'accepted',
      'republished',
      'REPUBLISH',
      async (r) => {
        const current = await r.staff.rosterWeek(r.head, query);
        r.oldId = current.assignments[0].id;
        await r.staff.saveRosterWeek(r.head, {
          ...query,
          revision: current.revision,
          assignments: [shift(r.two.memberId, '2026-11-03')],
          requestId: request()
        });
      }
    ]
  ].map(([from, to, event, run]) => ({ from, to, event, run }));
  await runModel({
    name: 'roster-cover',
    initial: 'empty',
    edges,
    setup: async () => {
      const r = await setup();
      r.dispose = () => r.db.sqlite.close();
      return r;
    },
    observe: async (r, state) => {
      const roster = await r.staff.rosterWeek(r.head, query);
      assert.equal(roster.assignments.length, state === 'empty' ? 0 : 1);
      if (state !== 'empty') {
        const a = roster.assignments[0];
        assert.equal(
          a.memberId,
          ['accepted', 'republished'].includes(state) ? r.two.memberId : r.one.memberId
        );
        assert.equal(
          a.leaveStatus,
          ['leave', 'pending', 'declined', 'cancelled'].includes(state) ? 'recorded' : ''
        );
      }
      if (['pending', 'accepted', 'declined', 'cancelled'].includes(state))
        assert.equal(
          r.db.sqlite.prepare('SELECT status FROM roster_covers WHERE id=?').get(r.invite.id)
            .status,
          state
        );
      if (state === 'republished')
        assert.equal(
          r.db.sqlite.prepare('SELECT active FROM duty_assignments WHERE id=?').get(r.oldId).active,
          0
        );
      assert.equal(r.db.sqlite.prepare('SELECT COUNT(*) n FROM attendance_records').get().n, 0);
      assert.deepEqual(r.db.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
    }
  });
}
