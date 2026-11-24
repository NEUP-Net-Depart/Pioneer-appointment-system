import { present } from './helpers/present.ts';
import { modelEdges, runModel, rejectWithoutWrite } from './fixtures/workflow-seed.ts';
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { database, seedStaff } from './helpers/database.ts';
import { staffServices } from './fixtures/staff-services.ts';
import { userRepository } from '../src/db/users.ts';
import { staffPlatformRepository } from '../src/db/staff-platform.ts';
const weekStart='2026-11-02',campusId='campus-nanhu',dutyType='repair';
const query={weekStart,campusId,dutyType};
const request=()=>crypto.randomUUID();
beforeEach(() => mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-01T12:00:00Z') }));
afterEach(() => mock.timers.reset());
async function setup(){
 const db=database();for(const id of ['20261001','20261002','20261003'])seedStaff(db,id);seedStaff(db,'20261004','浑南');
 db.sqlite.exec("INSERT INTO member_department_memberships(id,member_id,department_id,position_code,assignment_type,is_primary,effective_from,created_at) VALUES('head','member-20261001','dept-network','head','primary',1,'2026-01-01','2026-01-01')");
 for(const account of ['20261002','20261003'])db.sqlite.prepare("INSERT INTO member_department_memberships(id,member_id,department_id,position_code,assignment_type,is_primary,effective_from,created_at) VALUES(?,?,'dept-hardware','member','primary',1,'2026-01-01','2026-01-01')").run(`post-${account}`,`member-${account}`);
 const users=userRepository(db),staff=staffServices(db,'00'.repeat(32));
 return {db,staff,head:present(await users.find('20261001')),one:present(await users.find('20261002')),two:present(await users.find('20261003')),outside:present(await users.find('20261004'))};
}
function shift(memberId: string,date=weekStart){return {memberId,businessDate:date,startAt:'19:00',endAt:'21:00'};}
test('usual availability carries without weekly confirmation; exceptions apply to one week and can be removed',async()=>{
  await availabilityModel();
 const {db,staff,one}=await setup();try{
 const windows=[{weekday:1,campusId,startAt:'19:00',endAt:'21:00'}];
 await staff.saveAvailability(one,{dutyType,weekStart:'',revision:-1,windows,requestId:request()});
 const carried=await staff.availability(one,{dutyType,weekStart});assert.equal(carried.source,'usual');assert.equal(carried.updatedThisWeek,false);assert.deepEqual(carried.effectiveWindows,windows);
 const input={dutyType,weekStart,revision:-1,windows:[{...windows[0],weekday:2}],requestId:request()};
 await Promise.all([staff.saveAvailability(one,input),staff.saveAvailability(one,input)]);
 assert.equal((await staff.availability(one,{dutyType,weekStart})).source,'exception');
 assert.deepEqual((await staff.availability(one,{dutyType,weekStart:'2026-11-09'})).effectiveWindows,windows);
 const restored=await staff.saveAvailability(one,{dutyType,weekStart,revision:0,useUsual:true,requestId:request()});
 assert.equal(restored.updatedThisWeek,false);
 assert.equal(restored.exception.revision,1);
 }finally{db.sqlite.close();}
});
test('publish without weekly questionnaires, recipient takeover, scoped edits and revision conflicts',async()=>{
  await rosterModel();
 const {db,staff,head,one,two,outside}=await setup();try{
 const input={...query,revision:-1,assignments:[shift(one.memberId),shift(two.memberId,'2026-11-03')],requestId:request()};
 const published=await staff.saveRosterWeek(head,input);assert.equal(published.assignments.length,2);
 await staff.saveRosterWeek(head,input);assert.equal(present(db.sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='rosters.week.published'").get()).n,1);
 await assert.rejects(staff.saveRosterWeek(head,{...input,requestId:request()}),{status:409});
 await assert.rejects(staff.saveRosterWeek(one,{...input,revision:0,requestId:request()}),{status:403});
 await assert.rejects(staff.saveRosterWeek(head,{...input,campusId:'campus-hunnan',assignments:[shift(outside.memberId)],requestId:request()}),{status:403});
 assert.equal((await staff.rosterWeek(one,query)).assignments.length,1);
 const first=published.assignments.find(row=>row.memberId===one.memberId);
 const item=(await staff.rosterMine(one,{weekStart})).items[0];
 const invite=await staff.requestCover(one,item.id,{revision:item.revision,toMemberId:two.memberId,note:'已沟通',requestId:request()});
 await assert.rejects(staff.respondCover(one,invite.id,{revision:0,decision:'accepted',requestId:request()}),{status:403});
 const accepted={revision:0,decision:'accepted',requestId:request()};
 await Promise.all([staff.respondCover(two,invite.id,accepted),staff.respondCover(two,invite.id,accepted)]);
 assert.equal((await staff.rosterMine(two,{weekStart})).items.length,2);
 assert.equal(present(db.sqlite.prepare('SELECT member_id FROM duty_assignments WHERE id=?').get(present(first).id)).member_id,two.memberId);
 assert.equal('leaveStatus' in present((await staff.rosterWeek(head,query)).assignments.find(row=>row.id===present(first).id)),false);
 assert.equal(present(db.sqlite.prepare('SELECT COUNT(*) n FROM attendance_records').get()).n,0);
 const current=await staff.rosterWeek(head,query);
 const changes={...query,revision:current.revision,assignments:current.assignments.map((row,index: number)=>({...row,businessDate:index?'2026-11-05':'2026-11-04'})),requestId:request()};
 const results=await Promise.allSettled([staff.saveRosterWeek(head,changes),staff.saveRosterWeek(head,{...changes,requestId:request()})]);
 assert.equal(results.filter(row=>row.status==='fulfilled').length,1);
 assert.equal(present(db.sqlite.prepare('SELECT active FROM duty_assignments WHERE id=?').get(present(first).id)).active,0,'old shift IDs remain in history');
 assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.sqlite.close();}
});
test('request IDs bind the assignment, and competing cover/time edits cannot overwrite each other',async()=>{
 const {db,staff,head,one,two}=await setup();try{
 const published=await staff.saveRosterWeek(head,{...query,revision:-1,assignments:[shift(one.memberId),shift(one.memberId,'2026-11-03'),shift(two.memberId)],requestId:request()});
 const mine=published.assignments.filter(row=>row.memberId===one.memberId);
 const input={revision:0,toMemberId:two.memberId,requestId:request()};
 const invite=await staff.requestCover(one,mine[0].id,input);
 await assert.rejects(staff.requestCover(one,mine[1].id,input),{status:409});
 await assert.rejects(staff.respondCover(two,invite.id,{revision:0,decision:'accepted',requestId:request()}),{status:409},'overlapping recipient assignment blocks takeover');
 assert.equal(present(db.sqlite.prepare('SELECT member_id FROM duty_assignments WHERE id=?').get(mine[0].id)).member_id,one.memberId);
 assert.equal((await staff.rosterMine(one,{weekStart})).items[0].revision,0);
 }finally{db.sqlite.close();}
});

test('republishing a changed shift cancels the pending invitation and prevents stale acceptance', async () => {
 const {db,staff,head,one,two}=await setup();try{
 const published=await staff.saveRosterWeek(head,{...query,revision:-1,assignments:[shift(one.memberId)],requestId:request()});
 const original=published.assignments[0];
 const invite=await staff.requestCover(one,original.id,{revision:original.revision,toMemberId:two.memberId,requestId:request()});
 await staff.saveRosterWeek(head,{...query,revision:published.revision,assignments:[shift(one.memberId,'2026-11-03')],requestId:request()});
 const received=(await staff.covers(two)).items.find(item=>item.id===invite.id);
 assert.equal(present(received).status,'cancelled');
 assert.equal(present(received).canRespond,false);
 await assert.rejects(staff.respondCover(two,invite.id,{revision:0,decision:'accepted',requestId:request()}),{status:409});
 assert.equal((await staff.rosterMine(two,{weekStart})).items.length,0);
 assert.equal((await staff.rosterMine(one,{weekStart})).items[0].businessDate,'2026-11-03');
 assert.equal(present(db.sqlite.prepare('SELECT COUNT(*) n FROM attendance_records').get()).n,0);
 }finally{db.sqlite.close();}
});

test('cover agreement immediately updates the published roster without republishing and remains retryable after the deadline', async () => {
 const {db,staff,head,one,two}=await setup();try{
 const published=await staff.saveRosterWeek(head,{...query,revision:-1,assignments:[shift(one.memberId)],requestId:request()});
 const original=published.assignments[0];
 mock.timers.setTime(Date.parse('2026-11-01T15:59:59.999Z'));
 const invite=await staff.requestCover(one,original.id,{revision:original.revision,toMemberId:two.memberId,requestId:request()});
 const accepted={revision:0,decision:'accepted',requestId:request()};
 await staff.respondCover(two,invite.id,accepted);
 const current=await staff.rosterWeek(head,query);
 assert.equal(current.publishedAt,published.publishedAt);
 assert.equal(current.revision,published.revision+1);
 assert.equal(current.assignments[0].id,original.id);
 assert.equal(current.assignments[0].memberId,two.memberId);
 assert.equal((await staff.rosterMine(one,{weekStart})).items.length,0);
 assert.equal((await staff.rosterMine(two,{weekStart})).items[0].id,original.id);
 assert.equal(present(db.sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='rosters.week.published'").get()).n,1);
 mock.timers.setTime(Date.parse('2026-11-01T16:00:00Z'));
 assert.deepEqual(await staff.respondCover(two,invite.id,accepted),{status:'accepted'});
 }finally{db.sqlite.close();}
});

test('Shanghai duty-date midnight blocks both new requests and pending acceptance without changing the roster', async () => {
 const {db,staff,head,one,two}=await setup();try{
 const published=await staff.saveRosterWeek(head,{...query,revision:-1,assignments:[shift(one.memberId)],requestId:request()});
 const original=published.assignments[0];
 const invite=await staff.requestCover(one,original.id,{revision:original.revision,toMemberId:two.memberId,requestId:request()});
 mock.timers.setTime(Date.parse('2026-11-01T16:00:00Z'));
 assert.equal((await staff.rosterMine(one,{weekStart})).items[0].canRequestCover,false);
 await rejectWithoutWrite(db,()=>staff.requestCover(one,original.id,{revision:original.revision,toMemberId:two.memberId,requestId:request()}),{status:409});
 await assert.rejects(staff.coverCandidates(one,original.id),{status:409});
 await rejectWithoutWrite(db,()=>staff.respondCover(two,invite.id,{revision:0,decision:'accepted',requestId:request()}),{status:409});
 assert.equal((await staff.covers(two)).items[0].status,'expired');
 assert.equal((await staff.covers(two)).items[0].canRespond,false);
 assert.equal((await staff.rosterWeek(head,query)).revision,published.revision);
 assert.equal((await staff.rosterWeek(head,query)).assignments[0].memberId,one.memberId);
 assert.equal(await staffPlatformRepository(db).pendingCoverInvitations(two.memberId),0);
 }finally{db.sqlite.close();}
});

test('expired legacy exchanges do not block a new cover for the later shift', async () => {
 const {db,staff,head,one,two}=await setup();try{
 seedStaff(db,'20261005');
 db.sqlite.exec("INSERT INTO member_department_memberships(id,member_id,department_id,position_code,assignment_type,is_primary,effective_from,created_at) VALUES('third-exchange','member-20261005','dept-hardware','member','exchange',0,'2026-01-01','2026-01-01')");
 const third=present(await userRepository(db).find('20261005'));
 const published=await staff.saveRosterWeek(head,{...query,revision:-1,assignments:[shift(one.memberId),shift(two.memberId,'2026-11-05')],requestId:request()});
 const original=published.assignments.find(row=>row.memberId===one.memberId);
 const other=published.assignments.find(row=>row.memberId===two.memberId);
 db.sqlite.prepare("INSERT INTO roster_covers(id,assignment_id,exchange_assignment_id,from_member_id,to_member_id,assignment_revision,exchange_revision,status,created_at) VALUES('swap',?,?,?,?,?,?,'pending','2026-11-01')")
  .run(present(original).id,present(other).id,one.memberId,two.memberId,present(original).revision,present(other).revision);
 const replacement=()=>staff.requestCover(two,present(other).id,{revision:present(other).revision,toMemberId:third.memberId,requestId:request()});
 await rejectWithoutWrite(db,replacement,{status:409});
 mock.timers.setTime(Date.parse('2026-11-01T16:00:00Z'));
 await rejectWithoutWrite(db,()=>staff.respondCover(two,'swap',{revision:0,decision:'accepted',requestId:request()}),{status:409});
 assert.equal((await staff.covers(two)).items[0].status,'expired');
 assert.equal(await staffPlatformRepository(db).pendingCoverInvitations(two.memberId),0);
 const invite=await replacement();
 assert.equal(present(db.sqlite.prepare("SELECT status FROM roster_covers WHERE id='swap'").get()).status,'pending');
 await staff.respondCover(third,invite.id,{revision:0,decision:'accepted',requestId:request()});
 assert.equal(present(db.sqlite.prepare('SELECT member_id FROM duty_assignments WHERE id=?').get(present(other).id)).member_id,third.memberId);
 }finally{db.sqlite.close();}
});

async function availabilityModel() {
  const windows = [{ weekday: 1, campusId, startAt: '19:00', endAt: '21:00' }];
  const save = async (r: Awaited<ReturnType<typeof setup>>, useUsual: boolean) => {
    const current = await r.staff.availability(r.one, { dutyType, weekStart });
    await r.staff.saveAvailability(r.one, {
      dutyType,
      weekStart,
      revision: current.exception?.revision ?? -1,
      windows: [{ ...windows[0], weekday: 2 }],
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
      await r.staff.saveAvailability(r.one, {
        dutyType,
        weekStart: '',
        revision: -1,
        windows,
        requestId: request()
      });
      return { ...r, dispose: () => r.db.sqlite.close() };
    },
    observe: async (r, state: string) => {
      const result = await r.staff.availability(r.one, { dutyType, weekStart });
      assert.equal(result.source, state);
      assert.deepEqual(result.effectiveWindows, state === 'usual' ? windows : [{ ...windows[0], weekday: 2 }]);
      assert.deepEqual(
        (await r.staff.availability(r.one, { dutyType, weekStart: '2026-11-09' })).effectiveWindows,
        windows
      );
    }
  });
}
type RosterFixture = Awaited<ReturnType<typeof setup>>;
type RosterModel = RosterFixture & {
  input?: Parameters<RosterFixture['staff']['saveRosterWeek']>[1];
  invite?: Awaited<ReturnType<RosterFixture['staff']['requestCover']>>;
  oldId?: string;
  dispose(): void;
};

async function rosterModel() {
  const assignment = async (r: RosterModel) => (await r.staff.rosterWeek(r.head, query)).assignments[0];
  const invite = async (r: RosterModel) => {
    const a = await assignment(r);
    r.invite = await r.staff.requestCover(r.one, a.id, {
      revision: a.revision,
      toMemberId: r.two.memberId,
      requestId: request()
    });
  };
  const response = (r: RosterModel, decision: string, actor = r.two) =>
    r.staff.respondCover(actor, present(r.invite).id, { revision: 0, decision, requestId: request() });
  const edges = modelEdges<RosterModel>([
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
        const before = present(r.db.sqlite.prepare('SELECT COUNT(*) n FROM audit_events').get()).n;
        await r.staff.saveRosterWeek(r.head, present(r.input));
        assert.equal(present(r.db.sqlite.prepare('SELECT COUNT(*) n FROM audit_events').get()).n, before);
      }
    ],
    [
      'published',
      'published',
      'REJECT_STALE',
      (r) =>
        rejectWithoutWrite(
          r.db,
          () => r.staff.saveRosterWeek(r.head, { ...present(r.input), requestId: request() }),
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
          () => r.staff.saveRosterWeek(r.one, { ...present(r.input), revision: 0, requestId: request() }),
          { status: 403 }
        )
    ],
    ['published', 'pending', 'INVITE', invite],
    [
      'pending',
      'pending',
      'REJECT_SENDER_ACCEPT',
      (r) => rejectWithoutWrite(r.db, () => response(r, 'accepted', r.one), { status: 403 })
    ],
    ['pending', 'accepted', 'ACCEPT', (r) => response(r, 'accepted')],
    ['pending', 'declined', 'DECLINE', (r) => response(r, 'declined')],
    ['pending', 'cancelled', 'CANCEL', (r) => response(r, 'cancelled', r.one)],
    ...['accepted', 'declined', 'cancelled'].map<[string, string, string, (r: RosterModel) => unknown]>((state) => [
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
  ]);
  await runModel<RosterModel>({
    name: 'roster-cover',
    initial: 'empty',
    edges,
    setup: async () => {
      const r = await setup();
      return { ...r, dispose: () => r.db.sqlite.close() };
    },
    observe: async (r, state: string) => {
      const roster = await r.staff.rosterWeek(r.head, query);
      assert.equal(roster.assignments.length, state === 'empty' ? 0 : 1);
      if (state !== 'empty') {
        const a = roster.assignments[0];
        assert.equal(
          a.memberId,
          ['accepted', 'republished'].includes(state) ? r.two.memberId : r.one.memberId
        );
        assert.equal('leaveStatus' in a, false);
      }
      if (['pending', 'accepted', 'declined', 'cancelled'].includes(state))
        assert.equal(
          present(r.db.sqlite.prepare('SELECT status FROM roster_covers WHERE id=?').get(present(r.invite).id))
            .status,
          state
        );
      if (state === 'republished')
        assert.equal(
          present(r.db.sqlite.prepare('SELECT active FROM duty_assignments WHERE id=?').get(present(r.oldId))).active,
          0
        );
      assert.equal(present(r.db.sqlite.prepare('SELECT COUNT(*) n FROM attendance_records').get()).n, 0);
      assert.deepEqual(r.db.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
    }
  });
}
