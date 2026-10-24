import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldWorkflow } from '../src/services/field-workflow.js';

function fixture() {
  let reads = 0;
  const actor = { memberId: 'one', account: 'one', authorizedCampuses: ['南湖'] };
  const context = { actor, permissions: { 'onsite.frontdesk.create': true }, navigation: [], grants: [], workProfiles: [], todayDuties: [], authVersion: 1 };
  const field = fieldWorkflow({
    staff: {
      contextFor: async () => { reads++; return context; },
      directAttendanceAction: async (_actor, _campus, supplied) => {
        assert.equal(supplied, context);
        return { allowed: false };
      }
    },
    repository: {
      serviceDay: async () => null, dutyEvent: async () => null,
      fieldPeople: async () => [], fieldContexts: async () => new Map()
    },
    appointments: {
      currentRepair: async () => null, pendingDispatch: async () => null,
      expirePending: async () => {}, list: async () => ({ items: [] }),
      openFieldWork: async () => [], dailyWorkloads: async () => new Map()
    },
    authorizer: { eligibleGrants: () => [], evaluate: (_actor, code) => ({ allowed: !!context.permissions[code] }) }
  });
  return { actor, context, field, reads: () => reads };
}

for (const resource of ['home', 'board']) test(`${resource} reuses one read context without caching it across requests`, async () => {
  const { actor, context, field, reads } = fixture();
  const first = await field[resource](actor);
  assert.equal(reads(), 1);
  assert.equal(first.permissions['onsite.frontdesk.create'], true);
  context.permissions = {};
  if (resource === 'board') await assert.rejects(() => field.board(actor), error => error.status === 403);
  else assert.equal((await field.home(actor)).contexts.some(item => item.id === 'desk'), false);
  assert.equal(reads(), 2);
});
