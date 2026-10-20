export const meetingFixture = {
  module: { code: 'meetings', version: '1.0.0', releaseState: 'test' },
  department: { id: 'dept-network', name: '网络部' },
  meeting: { id: 'meeting-fixture-001', title: '网络部例会', businessDate: '2026-10-14' },
  participants: ['member-network-1', 'member-network-lead']
};

export function fixtureAttendance(eventId = 'meeting-event-001') {
  return { type: 'meeting', policyCode: 'meeting.v1', sourceRef: { module: 'meetings', type: 'meeting', id: meetingFixture.meeting.id }, eventId, participants: meetingFixture.participants };
}
