export const meetingsManifest = {
  code: 'meetings', version: '1.0.0', contractVersion: '1', requiredSchemaVersion: '0007',
  dependencies: ['identity@1','organization@1','authorization@1','attendance@1'], releaseState: 'test',
  permissions: ['meetings.read.own','meetings.manage','meetings.attendance.export'],
  routes: ['/api/meetings'], navigation: [{ id: 'meetings.mine', path: '/staff/meetings', title: '我的会议', permission: 'meetings.read.own' }],
  attendancePolicies: ['meeting.v1'], workbenchProviders: ['meetings.myUpcoming'],
  reports: ['meetings.attendance'], auditActions: ['meetings.created','meetings.participants.updated']
};
