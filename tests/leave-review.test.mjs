import test from 'node:test';
import assert from 'node:assert/strict';
import { staffPlatformService } from '../src/services/staff-platform.js';
import { createAuthorizer } from '../src/modules/authorization/public.js';
import { validateRoster } from '../src/modules/rosters/solver.js';
import { dateKey, addDays } from '../shared/time.js';

function setup(grants) {
  const day = addDays(dateKey(), 14), writes = [];
  const shift = { id: 'current-shift', memberId: 'applicant', campusId: 'campus-nanhu', businessDate: day, startAt: '19:00', endAt: '21:00', dutyType: 'repair', versionStatus: 'published' };
  const row = { id: 'leave', assignment_id: 'original-shift', member_id: 'applicant', member_name: '申请成员', reason: '课程考试', status: 'pending', revision: 0 };
  const dates = [];
  const repository = {
    leaveById: async () => row, listLeaves: async () => [row], effectiveLeaveAssignment: async () => shift,
    memberships: async (_id, date) => { dates.push(date); return [{ departmentId: 'dept-hardware', departmentName: '硬件部' }]; },
    memberRow: async () => ({ name: '申请成员' }),
    leaveImpact: async () => ({ scheduled: 2, expected: 2, afterApproval: 1, leadersAfterApproval: 0, checkedIn: false, needsReplacement: true }),
    updateLeave: async (...args) => { writes.push(args); return { ...row, status: args[1], revision: 1 }; }
  };
  const platform = { authContext: async () => ({ actor: { memberId: 'reviewer' }, grants }), authorizer: createAuthorizer() };
  const service = staffPlatformService({ repository, platform, manifests: [] });
  return { service, dates, writes, shift };
}
const actor = { account: 'reviewer', role: 'technician', authorizedCampuses: ['南湖', '浑南'] };
const grant = (campusIds, departmentIds, extra = {}) => ({ permissionCode: 'leave.review', scope: { campusIds, departmentIds }, conditions: [], ...extra });

test('leave approval requires a complete campus and applicant-department grant, never a union of unrelated grants', async () => {
  for (const grants of [[], [grant(['campus-hunnan'], ['dept-hardware'])],
    [grant(['campus-nanhu'], ['dept-office']), grant(['campus-hunnan'], ['dept-hardware'])]]) {
    const { service, writes } = setup(grants);
    assert.deepEqual((await service.leaves(actor, { all: true })).items, []);
    await assert.rejects(service.leaveDetail(actor, 'leave'), error => error.status === 403);
    await assert.rejects(service.leaveDecision(actor, 'leave', { decision: 'approve', revision: 0 }), error => error.status === 403);
    assert.deepEqual(writes, []);
  }
});

test('a delegated reviewer can review without personal roster or member-management permissions', async () => {
  const { service, dates, writes, shift } = setup([grant(['campus-nanhu'], ['dept-hardware'])]);
  const items = (await service.leaves(actor, { all: true })).items;
  assert.equal(items.length, 1);
  assert.equal(items[0].actions.approve, true);
  const detail = await service.leaveDetail(actor, 'leave');
  assert.equal(detail.memberName, '申请成员');
  assert.equal(detail.impact.needsReplacement, true);
  assert.ok(dates.every(day => day === shift.businessDate));
  await service.leaveDecision(actor, 'leave', { decision: 'approve', revision: 0, note: '安排补位' });
  assert.equal(writes.length, 1);
  assert.equal(writes[0][5].action, 'rosters.leave.reviewed');
});

test('future reviewer grants cannot authorize a decision today for a future shift', async () => {
  const { service } = setup([grant(['campus-nanhu'], ['dept-hardware'], { validity: { effectiveFrom: addDays(dateKey(), 7) } })]);
  assert.deepEqual((await service.leaves(actor, { all: true })).items, []);
  await assert.rejects(service.leaveDecision(actor, 'leave', { decision: 'approve', revision: 0 }), error => error.status === 403);
});

test('approved leave reduces effective coverage but preserves original scheduling constraints', () => {
  const slot = { businessDate: '2026-11-09', campusId: 'campus-nanhu', startAt: '19:00', endAt: '21:00', dutyType: 'repair', requireLead: true };
  const members = [{ memberId: 'lead', available: [slot], leadSlots: [slot] }, { memberId: 'repair', available: [slot] }];
  const assignments = [{ ...slot, memberId: 'lead', roleKind: 'repair_lead', leaveStatus: 'approved' }, { ...slot, memberId: 'repair' }];
  const result = validateRoster({ assignments }, { slots: [slot], members });
  assert.deepEqual(result.errors.map(item => item.code), ['LEAD_COVERAGE_MISSING']);
  assert.equal(validateRoster({ assignments: assignments.map(item => ({ ...item, leaveStatus: 'pending' })) }, { slots: [slot], members }).valid, true);
  assert.equal(assignments.length, 2);
});
