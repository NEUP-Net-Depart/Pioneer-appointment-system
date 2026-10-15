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

test('a complete campus grant also respects the account campus boundary', () => {
  const actor = { memberId: 'member-1', authorizedCampuses: ['南湖'] };
  const grants = [{ permissionCode: 'members.manage', scope: { campusIds: ['campus-nanhu', 'campus-hunnan'] } }];
  assert.equal(authorizer.evaluate(actor, 'members.manage', { campusId: 'campus-nanhu' }, {}, grants).allowed, true);
  assert.equal(authorizer.evaluate(actor, 'members.manage', { campusId: 'campus-hunnan' }, {}, grants).allowed, false);
  const objectGrant = [{ permissionCode: 'members.manage', scope: { objectIds: ['target-1'] } }];
  assert.equal(authorizer.evaluate(actor, 'members.manage', { id: 'target-1', campusId: 'campus-nanhu' }, {}, objectGrant).allowed, true);
  assert.equal(authorizer.evaluate(actor, 'members.manage', { id: 'target-2', campusId: 'campus-nanhu' }, {}, objectGrant).allowed, false);
  assert.equal(authorizer.evaluate(actor, 'members.manage', { id: 'target-1', campusId: 'campus-hunnan' }, {}, objectGrant).allowed, false);
});

test('duty conditions require the same campus, business date, role kind and duty type', () => {
  const auth = createAuthorizer(), actor = { memberId: 'member-1', authorizedCampuses: ['南湖', '浑南'] };
  const grants = [{ permissionCode: 'repair.transfer', scope: { campusIds: ['campus-nanhu', 'campus-hunnan'] },
    conditions: [{ code: 'activeDutyRole', version: 1, parameters: { kind: 'repair_lead', dutyType: 'repair' } }] }];
  const target = { campusId: '南湖' }, context = { businessDate: '2026-10-15',
    todayDuties: [{ campusId: 'campus-nanhu', businessDate: '2026-10-15', roleKind: 'repair_lead', dutyType: 'repair' }] };
  const allowed = (resource, ctx) => auth.evaluate(actor, 'repair.transfer', resource, ctx, grants).allowed;
  assert.equal(allowed(target, context), true);
  assert.equal(allowed({ campusId: 'campus-hunnan' }, context), false);
  assert.equal(allowed({ campusId: 'campus-unregistered' }, context), false);
  assert.equal(allowed({ campusId: 'campus-hunnan' }, { ...context, todayDuties: [{ campusId: 'campus-nanhu' }] }), false);
  for (const patch of [{ businessDate: '2026-10-14' }, { roleKind: 'office_lead' }, { dutyType: 'office' }, { active: false }]) {
    assert.equal(allowed(target, { ...context, todayDuties: [{ ...context.todayDuties[0], ...patch }] }), false);
  }
  assert.equal(allowed(target, { ...context, todayDuties: [], todayDuty: true }), false);
});

test('department and work qualification conditions use left-closed right-open validity', () => {
  const auth = createAuthorizer(), actor = { memberId: 'member-1' };
  const target = { departmentId: 'dept-hardware' };
  const grant = { permissionCode: 'repair.start', scope: {}, conditions: [
    { code: 'activeDepartmentMembership', parameters: { departmentId: 'dept-hardware', isPrimary: true } },
    { code: 'repairWorkEligible' }
  ] };
  const context = { businessDate: '2026-10-15', memberships: [{ departmentId: 'dept-hardware', isPrimary: true, effectiveFrom: '2026-10-15', effectiveTo: '2026-10-16' }],
    workProfiles: [{ profileCode: 'repair', effectiveFrom: '2026-10-15', effectiveTo: '2026-10-16' }] };
  assert.equal(auth.evaluate(actor, 'repair.start', target, context, [grant]).allowed, true);
  assert.equal(auth.evaluate(actor, 'repair.start', target, { ...context, businessDate: '2026-10-16' }, [grant]).allowed, false);
  assert.equal(auth.evaluate(actor, 'repair.start', target, { ...context, memberships: [{ ...context.memberships[0], effectiveFrom: '2026-10-16' }] }, [grant]).allowed, false);
  assert.equal(auth.evaluate(actor, 'repair.start', target, { ...context, workProfiles: [{ ...context.workProfiles[0], effectiveTo: '2026-10-15' }] }, [grant]).allowed, false);
});

test('unknown condition versions, providers and parameter shapes fail closed', () => {
  const auth = createAuthorizer();
  for (const condition of [null, { code: 'unregistered' }, { code: 'constructor' }, { code: '__proto__' }, { code: 'activeDutyRole', version: 2 },
    { code: 'activeDutyRole', parameters: { kind: ['repair_lead'] } }, { code: 'activeDutyRole', parameters: { ignoreCampus: true } }]) {
    assert.equal(auth.evaluate({}, 'test', {}, {}, [{ permissionCode: 'test', scope: {}, conditions: [condition] }]).allowed, false);
    assert.equal(auth.validCondition(condition), false);
  }
  assert.ok(auth.conditionDefinitions().find(item => item.code === 'activeDutyRole').parameterSchema.properties.kind);
});

test('malformed stored authorization data never becomes an unrestricted grant', () => {
  const auth = createAuthorizer();
  for (const patch of [{ validity: false }, { validity: [] }, { validity: { effectiveFrom: false } }, { validity: { effectiveTo: 0 } },
    { validity: { effectiveFrom: '2026-10-20', effectiveTo: '2026-10-19' } },
    { scope: null }, { scope: 'all' }, { scope: { departmentIds: 'hardware' } }, { scope: { all: 'true' } }, { conditions: 'none' }, { conditions: null }]) {
    assert.equal(auth.evaluate({}, 'test', {}, {}, [{ permissionCode: 'test', ...patch }]).allowed, false);
  }
});
