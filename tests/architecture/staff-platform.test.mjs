import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manifests, validateManifests, publishedManifests, navigationFor, workbenchProviders } from '../../src/modules/registry.js';
import { createAuthorizer } from '../../src/modules/authorization/public.js';
import { generateRoster, validateRoster } from '../../src/modules/rosters/solver.js';
import { dutyPolicy, meetingPolicy } from '../../src/modules/attendance/policies.js';

test('module manifests have unique contracts and resolvable dependencies', () => {
  const result = validateManifests(manifests);
  assert.equal(result.valid, true, result.errors.join('; '));
  assert.ok(result.summary.some(item => item.code === 'meetings' && item.releaseState === 'test'));
  assert.ok(publishedManifests().every(item => item.releaseState === 'ready'));
  assert.ok(!workbenchProviders().some(item => item.module === 'meetings'));
  assert.ok(!navigationFor({memberId:'test',role:'superadmin',authorizedCampuses:['南湖']},[{permissionCode:'meetings.read.own',scope:{all:true}}]).some(item => item.module === 'meetings'));
});

test('complete grants combine scope and condition without widening unrelated campuses', () => {
  const authorizer = createAuthorizer({ providers: { ownResource: { check: () => true } } });
  const actor = { memberId: 'member-1', authorizedCampuses: ['南湖'] };
  const grants = [{ id: 'nanhu-start', permissionCode: 'repair.start', scope: { campusIds: ['南湖'] }, conditions: [] }];
  assert.equal(authorizer.evaluate(actor, 'repair.start', { campusId: 'campus-nanhu' }, {}, grants).allowed, true);
  assert.equal(authorizer.evaluate(actor, 'repair.start', { campusId: 'campus-hunnan' }, {}, grants).allowed, false);
});

test('duty and meeting policies keep independent same-day dedupe keys', () => {
  const event = { id: 'event-1', type: 'duty', businessDate: '2026-10-14' };
  assert.equal(dutyPolicy().getDedupeScope({ memberId: 'member-1', event }), 'duty:member-1:2026-10-14');
  assert.equal(meetingPolicy().getDedupeScope({ memberId: 'member-1', event: { id: 'meeting-1', type: 'meeting' } }), 'meeting:member-1:meeting-1');
});

test('roster generation is deterministic and independently verifiable', () => {
  const input = {
    ruleVersion: '1.0.0',
    members: [
      { memberId: 'member-b', isLead: true, available: [{ businessDate: '2026-10-12', startAt: '19:00', endAt: '21:00', campusId: 'campus-nanhu' }] },
      { memberId: 'member-a', isLead: false, available: [{ businessDate: '2026-10-13', startAt: '19:00', endAt: '21:00', campusId: 'campus-nanhu' }] }
    ],
    slots: [
      { businessDate: '2026-10-12', campusId: 'campus-nanhu', startAt: '19:00', endAt: '21:00' },
      { businessDate: '2026-10-13', campusId: 'campus-nanhu', startAt: '19:00', endAt: '21:00' }
    ]
  };
  const first = generateRoster(input); const second = generateRoster(input);
  assert.deepEqual(first.assignments, second.assignments);
  assert.equal(validateRoster(first, input).valid, true);
  assert.equal(first.ruleVersion, '1.0.0');
});


test('rosters assign all available members instead of stopping after one person per slot', () => {
  const slots = [12,13,14,15].map(day => ({ businessDate: `2026-10-${day}`, campusId: 'campus-nanhu', startAt: '19:00', endAt: '21:00' }));
  const members = Array.from({ length: 8 }, (_, i) => ({ memberId: `member-${i}`, available: slots, leadSlots: i < 4 ? slots : [] }));
  const input = { members, slots, requireLead: true };
  const result = generateRoster(input);
  assert.equal(result.assignments.length, 8);
  assert.equal(result.balance.spread, 0);
  assert.equal(result.roleCoverage.covered, 4);
  assert.equal(validateRoster(result, input).valid, true);
  assert.equal(validateRoster({ assignments: [] }, { members: [], slots: [] }).valid, false);
});

test('independent roster validation rejects forged qualifications, unavailable members and altered locks', () => {
  const slot = { businessDate: '2026-10-12', campusId: 'campus-nanhu', startAt: '19:00', endAt: '21:00' };
  const input = { slots: [slot], members: [{ memberId: 'member-a', available: [slot], leadSlots: [] }], locked: [{ memberId: 'member-a', ...slot }] };
  const errors = validateRoster({ assignments: [{ memberId: 'outsider', ...slot, roleKind: 'repair_lead' }] }, input).errors.map(item => item.code);
  assert.ok(errors.includes('MEMBER_UNAVAILABLE'));
  assert.ok(errors.includes('LEAD_INELIGIBLE'));
  assert.ok(errors.includes('LOCKED_ASSIGNMENT_CHANGED'));
});

test('scarce leadership uses reassignment instead of leaving a covered alternative empty', () => {
  const slots = [12,13].map(day => ({ businessDate: `2026-10-${day}`, campusId: 'campus-nanhu', startAt: '19:00', endAt: '21:00' }));
  const members = [{ memberId: 'a-flexible', available: slots, leadSlots: slots }, { memberId: 'b-monday-only', available: [slots[0]], leadSlots: [slots[0]] }];
  const input = { slots, members, requireLead: true };
  assert.equal(validateRoster(generateRoster(input), input).valid, true);
});
