import test from 'node:test';
import assert from 'node:assert/strict';
import { staffPlatformService } from '../src/services/staff-platform.js';
import { createAuthorizer } from '../src/modules/authorization/public.js';
import {dateKey,weekRange,addDays} from '../shared/time.js';

function setup(memberId = 'target', allowedCampuses = ['campus-nanhu']) {
  const week=addDays(weekRange(dateKey()).start,7);
  const changes = [];
  const assignments = {
    a: { id: 'a', memberId: 'sender', businessDate: week, campusId: 'campus-nanhu', dutyType: 'repair', revision: 0, versionStatus: 'published', startAt: '19:00', endAt: '21:00' },
    b: { id: 'b', memberId: 'target', businessDate: addDays(week,1), campusId: 'campus-hunnan', dutyType: 'repair', revision: 0, versionStatus: 'published', startAt: '19:00', endAt: '21:00' }
  };
  const swap = { id: 'swap', from_assignment_id: 'a', to_assignment_id: 'b', from_member_id: 'sender', to_member_id: 'target', from_revision: 0, to_revision: 0, status: 'pending', revision: 0 };
  const repository = {
    serviceDays: async () => [],
    availability: async () => [{ memberId: 'target', campusId: 'campus-nanhu', businessDate:week }, { memberId: 'sender', campusId: 'campus-hunnan', businessDate:week }],
    rosterTaskById: async () => ({id:'task',weekStart:week,campusScope:{campusIds:['campus-nanhu']},memberIds:[],dutyType:'repair'}),
    assignmentById: async id => assignments[id], swapById: async () => swap,
    effectiveAssignment: async id => assignments[id], swapFingerprint: async () => 'unchanged', swapCoverage: async () => Object.values(assignments), receipt: async () => null,
    protectedRosterAssignments:async()=>[],
    memberRow: async id => ({ id, name: id }), memberships: async () => [],
    rosterMemberFacts: async () => ['sender','target'].map(memberId => ({ memberId,name:memberId,active:true,campuses:['南湖','浑南'],
      profiles:['repair','repair_lead'].map(profileCode => ({ profileCode,effectiveFrom:'2026-01-01' })),assignments:Object.values(assignments).filter(row => row.memberId === memberId) })),
    listSwaps: async () => [swap],
    listLeaves: async () => [{ id: 'north', assignment_id: 'b', member_id: 'target', status: 'pending' }, { id: 'south', assignment_id: 'a', member_id: 'sender', status: 'pending' }],
    updateSwap: async (...args) => { changes.push(args); return { ...swap, status: args[1] }; },
    audit: async () => {}
  };
  const platform = {
    authContext: async () => ({ actor: { memberId }, grants: [] }),
    authorizer: { evaluate: (_actor, permission, target) => ({ allowed: permission === 'roster.read' || allowedCampuses.includes(target.campusId) }) }
  };
  return { service: staffPlatformService({ repository, platform, manifests: [] }), changes, assignments, repository, platform };
}

test('only the invited member can respond, including when a manager supplies an authorized campus', async () => {
  const { service, changes } = setup('manager', ['campus-nanhu', 'campus-hunnan']);
  for (const decision of ['accept', 'decline']) {
    await assert.rejects(service.swapDecision({ account: 'root001', role: 'superadmin' }, 'swap', { decision, revision: 0, campusId: 'campus-nanhu' }), error => error.status === 403);
  }
  assert.deepEqual(changes, []);
});

test('invited member can respond and receives the corresponding action', async () => {
  const { service, changes } = setup();
  const list = await service.swaps({ account: 'target' });
  assert.equal(list.items[0].actions.respond, true);
  await service.swapDecision({ account: 'target' }, 'swap', { decision: 'accept', revision: 0 });
  assert.equal(changes[0][3].actorMemberId, 'target');
});

test('review lists filter actual assignment scope, including both sides of a swap', async () => {
  const { service } = setup('manager');
  const actor = { account: 'manager' };
  assert.deepEqual((await service.leaves(actor, { all: true })).items.map(item => item.id), ['south']);
  assert.deepEqual((await service.swaps(actor, { all: true, campusId: 'campus-nanhu' })).items, []);
});

test('stale and cross-week swap proposals fail before creating a request', async () => {
  const { service, assignments } = setup('sender');
  const input = { fromAssignmentId: 'a', toAssignmentId: 'b', toMemberId: 'target', fromRevision: 1, toRevision: 0 };
  await assert.rejects(service.swap({ account: 'sender' }, input), error => error.status === 409);
  assignments.b.businessDate = addDays(assignments.a.businessDate,7);
  await assert.rejects(service.swap({ account: 'sender' }, { ...input, fromRevision: 0 }), error => error.status === 400);
});


test('a personal roster grant does not expose other members availability', async () => {
  const { service } = setup('target', []);
  const result = await service.taskAvailability({ account: 'target' }, 'task');
  assert.deepEqual(result.items.map(item => item.memberId), ['target']);
});

test('swap management requires current complete department and campus grants for both participants', async () => {
  const { repository,platform } = setup('manager',['campus-nanhu','campus-hunnan']);
  repository.memberships = async memberId => [{ departmentId:memberId === 'sender' ? 'hardware' : 'office' }];
  let grants = [
    { permissionCode:'roster.repair.manage',scope:{ campusIds:['campus-nanhu'],departmentIds:['office'] } },
    { permissionCode:'roster.repair.manage',scope:{ campusIds:['campus-hunnan'],departmentIds:['hardware'] } }
  ];
  platform.authContext = async () => ({ actor:{ memberId:'manager' },grants,todayDuties:[] });
  platform.authorizer = createAuthorizer();
  const service = staffPlatformService({ repository,platform,manifests:[] });
  const actor = { account:'manager',role:'technician',authorizedCampuses:['南湖','浑南'] };
  assert.deepEqual((await service.swaps(actor,{ all:true })).items,[],'Grants cannot mix departments and campuses');
  await assert.rejects(service.swapDetail(actor,'swap'),error => error.status === 403);
  grants = [
    { permissionCode:'roster.repair.manage',scope:{ campusIds:['campus-nanhu'],departmentIds:['hardware'] } },
    { permissionCode:'roster.repair.manage',scope:{ campusIds:['campus-hunnan'],departmentIds:['office'] } }
  ];
  assert.equal((await service.swaps(actor,{ all:true })).items.length,1);
  assert.equal((await service.swapDetail(actor,'swap')).actions.respond,false,'Scoped managers cannot give another member consent');
  grants = grants.map(grant => ({ ...grant,validity:{ effectiveFrom:'2999-01-01' } }));
  assert.deepEqual((await service.swaps(actor,{ all:true })).items,[],'Future grants must not authorize a current management read');
});
