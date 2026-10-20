import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRoster } from '../src/modules/rosters/solver.js';

test('office coverage uses daily uniqueness and optional coordinators without imposing repair leadership', () => {
  const slots = ['2026-11-02','2026-11-03'].map(businessDate => ({ businessDate, campusId: 'campus-nanhu', dutyType: 'office', startAt: '19:00', endAt: '21:00' }));
  const input = { slots, members: [{ memberId: 'office', available: slots }] };
  const assignments = slots.map(slot => ({ ...slot, memberId: 'office', roleKind: 'coordinator' }));
  assert.equal(validateRoster({ assignments }, input).valid, true);
  assert.equal(validateRoster({ assignments: [...assignments, assignments[0]] }, input).errors.some(error => error.code === 'MEMBER_DAY_DUPLICATE'), true);
  assert.equal(validateRoster({ assignments: assignments.map(row => ({ ...row, roleKind: 'repair_lead' })) }, input).valid, false);
  assert.equal(validateRoster({ assignments: assignments.slice(1) }, input).errors.some(error => error.code === 'COVERAGE_MISSING'), true);
  const repair = { slots: slots.map(slot => ({ ...slot, dutyType: 'repair' })), members: [{ memberId: 'office', available: slots }] };
  assert.equal(validateRoster({ assignments: assignments.map(row => ({ ...row, dutyType: 'repair', roleKind: '' })) }, repair).errors.some(error => error.code === 'MEMBER_WEEK_DUPLICATE'), true);
});
