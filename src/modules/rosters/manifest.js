export const rostersManifest = {
  code: 'rosters',
  version: '3.0.0',
  contractVersion: '3',
  requiredSchemaVersion: '0050',
  releaseState: 'ready',
  dependencies: ['identity@1', 'organization@1', 'authorization@1'],
  permissions: ['roster.read', 'roster.manage'],
  routes: ['/api/rosters', '/api/me/availability'],
  navigation: [{ id: 'duties', path: '/staff/duties', title: '值班', permission: 'attendance.self' }],
  attendancePolicies: [],
  workbenchProviders: [],
  reports: [],
  auditActions: [
    'rosters.week.published',
    'rosters.campus-week.published',
    'rosters.availability.updated',
    'rosters.leave.recorded',
    'rosters.leave.withdrawn',
    'rosters.cover.requested',
    'rosters.cover.responded'
  ]
};
