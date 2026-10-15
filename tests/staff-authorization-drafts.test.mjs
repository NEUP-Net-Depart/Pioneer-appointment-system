import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setGrantEnabled, withCampusScope, roleBindingsPayload } from '../frontend/staff-react/authorization-drafts.js';

test('permission edits preserve unrelated grants and restore an existing complete grant', () => {
  const definition = { code: 'repair.start', scopeKinds: ['campus'], conditionKinds: ['activeDutyRole'] };
  const original = [{ id: 'start', permissionCode: 'repair.start', scope: { campusIds: ['campus-hunnan'], departmentIds: ['hardware'] },
    conditions: [{ code: 'activeDutyRole', parameters: { kind: 'repair_lead' } }], validity: { effectiveFrom: '2026-10-20', effectiveTo: '2026-11-01' } },
  { id: 'extension', permissionCode: 'future.permission', scope: { objectIds: ['private-event'] }, conditions: [{ code: 'futureCondition', parameters: { policy: 2 } }], validity: {} }];
  const initial = structuredClone(original);
  const removed = setGrantEnabled(original, definition, false, initial);
  assert.deepEqual(removed, [initial[1]]);
  const restored = setGrantEnabled(removed, definition, true, initial);
  assert.deepEqual(restored.find(grant => grant.permissionCode === definition.code), initial[0]);
  assert.deepEqual(original, initial);
  restored.find(grant => grant.permissionCode === definition.code).conditions[0].parameters.kind = 'changed';
  assert.deepEqual(original, initial);
});

test('new permissions retain required conditions and restricted default scopes', () => {
  const [grant] = setGrantEnabled([], { code: 'repair.finish.own', scopeKinds: ['campus', 'self'], conditionKinds: ['ownResource', 'repairWorkEligible'] }, true);
  assert.deepEqual(grant.scope, { campuses: 'bound', self: true });
  assert.deepEqual(grant.conditions.map(item => item.code), ['ownResource', 'repairWorkEligible']);
  assert.deepEqual(setGrantEnabled([grant], { code: grant.permissionCode }, true), [grant]);
});

test('editing a binding campus preserves department and object scope without linking home campus', () => {
  const scope = { campuses: ['南湖'], departmentIds: ['network'], objectIds: ['meeting-1'], self: true };
  assert.deepEqual(withCampusScope(scope, ['campus-hunnan']), { campusIds: ['campus-hunnan'], departmentIds: ['network'], objectIds: ['meeting-1'], self: true });
  assert.deepEqual(withCampusScope(scope, null), { departmentIds: ['network'], objectIds: ['meeting-1'], self: true });
  const original = [{ id: 'binding-1', roleId: 'role-1', scope, effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31', revision: 3 },
    { id: 'binding-2', roleId: 'role-2', scope: { campusIds: [] }, effectiveFrom: '2026-02-01', effectiveTo: null }];
  const result = roleBindingsPayload(original);
  assert.deepEqual(result, original);
  result[0].scope.objectIds.push('another');
  assert.deepEqual(original[0].scope.objectIds, ['meeting-1']);
});
