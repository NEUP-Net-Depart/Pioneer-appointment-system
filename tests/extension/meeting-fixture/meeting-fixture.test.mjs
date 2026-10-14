import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meetingFixture, fixtureAttendance } from './index.mjs';
import { meetingPolicy } from '../../../src/modules/attendance/policies.js';

test('network department meeting fixture uses the public attendance contract', () => {
  const input = fixtureAttendance();
  assert.equal(meetingFixture.department.id, 'dept-network');
  assert.equal(input.policyCode, 'meeting.v1');
  assert.equal(meetingPolicy().getDedupeScope({ memberId: meetingFixture.participants[0], event: { id: input.eventId, type: 'meeting' } }), `meeting:${meetingFixture.participants[0]}:${input.eventId}`);
});
