export const attendanceManifest = {
  code: 'attendance',
  version: '3.0.0',
  contractVersion: '2',
  requiredSchemaVersion: '0050',
  dependencies: ['identity@1', 'organization@1'],
  releaseState: 'ready',
  permissions: [
    'attendance.self',
    'attendance.session.manage',
    'attendance.correct',
    'attendance.export'
  ],
  routes: ['/api/attendance', '/api/presence', '/api/me/volunteer-summary'],
  navigation: [],
  attendancePolicies: ['duty.v1', 'meeting.v1'],
  workbenchProviders: ['attendance.today'],
  reports: ['attendance.monthly'],
  auditActions: [
    'attendance.event.created',
    'attendance.checked_in',
    'attendance.corrected',
    'attendance.arrival.confirmed',
    'attendance.reviewed'
  ]
};
