import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthorizer } from '../src/modules/authorization/public.js';

const authorizer = createAuthorizer({ providers: {
  activeDutyRole: { check: () => true },
  ownResource: { check: ({ actor, resource }) => actor.memberId === resource.memberId }
} });

test('authorization intersects bound campus scopes and never widens a role grant', () => {
  const actor = { memberId: 'member-1', authorizedCampuses: ['南湖'] };
  const grants = [{ id: 'grant-1', permissionCode: 'repair.summary.read', scope: { campusIds: ['campus-nanhu'] }, conditions: [] }];
  assert.equal(authorizer.evaluate(actor, 'repair.summary.read', { campusId: 'campus-nanhu' }, {}, grants).allowed, true);
  assert.equal(authorizer.evaluate(actor, 'repair.summary.read', { campusId: 'campus-hunnan' }, {}, grants).allowed, false);
});

test('authorization rejects grants outside their effective validity window', () => {
  const actor = { memberId: 'member-1', authorizedCampuses: ['南湖'] };
  const grants = [{ id: 'grant-2', permissionCode: 'members.manage', scope: { all: true }, conditions: [], validity: { effectiveFrom: '2026-10-15', effectiveTo: '2026-10-20' } }];
  assert.equal(authorizer.evaluate(actor, 'members.manage', {}, { businessDate: '2026-10-14' }, grants).allowed, false);
  assert.equal(authorizer.evaluate(actor, 'members.manage', {}, { businessDate: '2026-10-15' }, grants).allowed, true);
  assert.equal(authorizer.evaluate(actor, 'members.manage', {}, { businessDate: '2026-10-20' }, grants).allowed, false);
});

test('condition and self scope remain required after a grant matches', () => {
  const actor = { memberId: 'member-1', authorizedCampuses: ['南湖'] };
  const grants = [{ id: 'grant-3', permissionCode: 'repair.finish.own', scope: { self: true, campusIds: ['campus-nanhu'] }, conditions: [{ code: 'ownResource' }] }];
  assert.equal(authorizer.evaluate(actor, 'repair.finish.own', { memberId: 'member-1', campusId: 'campus-nanhu' }, {}, grants).allowed, true);
  assert.equal(authorizer.evaluate(actor, 'repair.finish.own', { memberId: 'member-2', campusId: 'campus-nanhu' }, {}, grants).allowed, false);
});
