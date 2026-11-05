import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manifests, validateManifests, publishedManifests, navigationFor, workbenchProviders } from '../../src/modules/registry.js';
import { dutyPolicy, meetingPolicy } from '../../src/modules/attendance/policies.js';

test('module manifests have unique contracts and resolvable dependencies', () => {
  const result = validateManifests(manifests);
  assert.equal(result.valid, true, result.errors.join('; '));
  assert.ok(result.summary.some(item => item.code === 'meetings' && item.releaseState === 'test'));
  assert.ok(publishedManifests().every(item => item.releaseState === 'ready'));
  assert.ok(!workbenchProviders().some(item => item.module === 'meetings'));
  assert.ok(!navigationFor({memberId:'test',role:'superadmin',authorizedCampuses:['南湖']},[{permissionCode:'meetings.read.own',scope:{all:true}}]).some(item => item.module === 'meetings'));
});

test('duty and meeting policies keep independent same-day dedupe keys', () => {
  const event = { id: 'event-1', type: 'duty', businessDate: '2026-10-14' };
  assert.equal(dutyPolicy().getDedupeScope({ memberId: 'member-1', event }), 'duty:member-1:2026-10-14');
  assert.equal(meetingPolicy().getDedupeScope({ memberId: 'member-1', event: { id: 'meeting-1', type: 'meeting' } }), 'meeting:member-1:meeting-1');
});
