import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldWorkflow } from '../src/services/field-workflow.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const actor = { account: 'staff', memberId: 'member-staff', authorizedCampuses: ['南湖'] };
  const context = { actor, grants: [], memberships: [], todayDuties: [], permissions: { 'roster.read': true }, navigation: [], authVersion: 1 };
  const gates = Object.fromEntries(['repairs', 'photos', 'direct', 'event', 'covers', 'attendance', 'expiry', 'work'].map((name) => [name, deferred()]));
  const calls = [];
  const read = (name) => { calls.push(name); return gates[name].promise; };
  const workflow = fieldWorkflow({
    repository: { dutyEvent: () => read('event'), pendingCoverInvitations: () => read('covers'), findAttendanceByDedupe: () => read('attendance') },
    appointments: { inProgress: () => read('repairs'), pendingPhotos: () => read('photos'), expirePending: () => read('expiry'), openFieldWork: () => read('work') },
    staff: { contextFor: async () => context, directAttendanceAction: () => read('direct') },
    authorizer: { evaluate: () => ({ allowed: true }) }
  });
  return { actor, gates, calls, workflow };
}

test('field home starts independent reads together and preserves all returned sections', async () => {
  const { workflow, actor, gates, calls } = fixture();
  const result = workflow.home(actor);
  await new Promise(setImmediate);
  assert.deepEqual([...calls].sort(), ['repairs', 'photos', 'direct', 'event', 'covers', 'attendance'].sort());
  gates.repairs.resolve([{ id: 'own', campus: '南湖' }]);
  gates.photos.resolve([{ id: 'photo', campus: '南湖' }]);
  gates.direct.resolve({ allowed: true });
  gates.event.resolve({ id: 'event' });
  gates.covers.resolve(3);
  gates.attendance.resolve({ id: 'check-in', campusId: 'campus-nanhu' });
  const home = await result;
  assert.equal(home.repairs[0].id, 'own');
  assert.equal(home.pendingPhotos[0].id, 'photo');
  assert.equal(home.directAttendance.allowed, true);
  assert.equal(home.event.id, 'event');
  assert.equal(home.pendingCoverInvitations, 3);
  assert.equal(home.attendance.id, 'check-in');
});

test('field board overlaps home reads with expiry, then reuses work for own repairs', async () => {
  const { workflow, actor, gates, calls } = fixture();
  const result = workflow.board(actor);
  await new Promise(setImmediate);
  assert.deepEqual([...calls].sort(), ['expiry', 'photos', 'direct', 'event', 'covers', 'attendance'].sort());
  assert.equal(calls.includes('work'), false);
  gates.expiry.resolve();
  await new Promise(setImmediate);
  assert.ok(calls.includes('work'));
  gates.work.resolve([
    { id: 'own', campus: '南湖', status: 'in_progress', assignedMemberId: actor.memberId },
    { id: 'other', campus: '南湖', status: 'in_progress', assignedMemberId: 'other' }
  ]);
  gates.photos.resolve([]); gates.direct.resolve({ allowed: false }); gates.event.resolve(null); gates.covers.resolve(0);
  gates.attendance.resolve(null);
  const board = await result;
  assert.deepEqual(board.repairs.map((item) => item.id), ['own']);
  assert.deepEqual(board.appointments.map((item) => item.id), ['own', 'other']);
  assert.equal(calls.includes('repairs'), false);
});

test('field board rejects unauthorized campuses before work queries start', async () => {
  const { workflow, actor, calls } = fixture();
  await assert.rejects(workflow.board(actor, { campusId: 'campus-hunnan' }), (error) => error.status === 403);
  assert.deepEqual(calls, []);
});
