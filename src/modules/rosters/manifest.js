export const rostersManifest = {
  code: 'rosters', version: '1.0.0', contractVersion: '1', requiredSchemaVersion: '0007',
  dependencies: ['identity@1','organization@1','duty@1'], releaseState: 'ready',
  permissions: ['roster.read','roster.repair.manage','roster.office.manage','leave.review'],
  routes: ['/api/roster-tasks','/api/rosters','/api/swaps','/api/leaves'], navigation: [{ id: 'rosters', path: '/staff/rosters', title: '排班', permission: 'roster.read' }],
  attendancePolicies: [], workbenchProviders: ['rosters.pending'], reports: ['rosters.coverage'], auditActions: ['rosters.generated','rosters.published']
};
