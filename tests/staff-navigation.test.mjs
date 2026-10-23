import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStaffScene, staffSceneAllowed } from '../shared/staff-access.js';

test('unified desk requires both a server context and a currently effective field permission', () => {
  const home = { contexts: [{ id: 'desk', label: '现场工作台' }] };
  for (const code of ['onsite.frontdesk.create', 'repair.receive', 'repair.dispatch', 'repair.transfer']) {
    const actor = { permissions: { [code]: true } };
    assert.equal(staffSceneAllowed(actor, home, 'desk'), true, code);
    assert.equal(staffSceneAllowed(actor, home, 'operations'), true, code);
    assert.equal(staffSceneAllowed(actor, { contexts: [] }, 'desk'), false, code);
  }
  for (const permissions of [{}, { 'repair.summary.read': true, 'repair.start': true }, { 'repair.transfer': false }]) {
    assert.equal(staffSceneAllowed({ permissions }, home, 'desk'), false);
    assert.equal(staffSceneAllowed({ permissions }, home, 'operations'), false);
  }
  assert.equal(normalizeStaffScene('operations'), 'desk');
  assert.equal(normalizeStaffScene('repair'), 'repair');
});
