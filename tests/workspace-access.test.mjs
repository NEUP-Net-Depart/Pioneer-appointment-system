import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workspacePermissions } from '../src/modules/authorization/workspace.js';
import { navigationFor } from '../src/modules/registry.js';
import { staffViewAllowed, staffPermission } from '../shared/staff-access.js';

test('workspace entries evaluate grant scope, validity and current duty rather than mere grant codes', () => {
  const actor = { memberId: 'one', role: 'technician', authorizedCampuses: ['南湖', '浑南'] };
  const grant = { permissionCode: 'members.manage', scope: { campusIds: ['campus-nanhu'] }, conditions: [{ code: 'activeDutyRole', parameters: { kind: 'office_lead' } }] };
  const context = { businessDate: '2026-10-16', grants: [grant], todayDuties: [] };
  assert.equal(workspacePermissions(actor, context)['members.manage'], false);
  assert.equal(navigationFor(actor, [grant], undefined, context).some(entry => entry.id === 'members'), false);
  const duty = { campusId: 'campus-hunnan', roleKind: 'office_lead', businessDate: context.businessDate };
  context.todayDuties = [duty];
  assert.equal(workspacePermissions(actor, context)['members.manage'], false);
  duty.campusId = 'campus-nanhu';
  assert.equal(workspacePermissions(actor, context)['members.manage'], true);
  grant.validity = { effectiveTo: '2026-10-16' };
  assert.equal(workspacePermissions(actor, context)['members.manage'], false);
  grant.validity = { effectiveFrom: '2026-10-17' };
  assert.equal(workspacePermissions(actor, context)['members.manage'], false);
  grant.validity = {};
  actor.authorizedCampuses = ['浑南'];
  assert.equal(workspacePermissions(actor, context)['members.manage'], false);
});

test('an enabled workspace fails closed even when legacy admin labels and stale grants remain', () => {
  const user = { staffWorkflowEnabled: true, role: 'superadmin', grants: [{ permissionCode: 'settings.manage' }], permissions: {} };
  for (const view of ['capacity','stats','users','members','permissions','roster-manage','office-roster','staff','unknown']) assert.equal(staffViewAllowed(user, view), false, view);
  assert.equal(staffViewAllowed(user, 'settings'), true);
  assert.equal(staffViewAllowed(user, 'workbench'), true);
  assert.equal(staffPermission(user, 'settings.manage'), false);
  user.role = 'technician'; user.permissions['settings.manage'] = true;
  assert.equal(staffViewAllowed(user, 'capacity'), true);
  assert.equal(staffViewAllowed(user, 'users'), false);
});
