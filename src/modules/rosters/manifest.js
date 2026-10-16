export const rostersManifest = {
  code: 'rosters', version: '1.2.0', contractVersion: '1', requiredSchemaVersion: '0016',
  dependencies: ['identity@1','organization@1','duty@1'], releaseState: 'ready',
  permissions: ['roster.read','roster.repair.manage','roster.office.manage','leave.review'],
  routes: ['/api/roster-tasks','/api/rosters','/api/swaps','/api/leaves'], navigation: [{ id: 'rosters', path: '/staff/rosters', title: '排班', permission: 'roster.read' },
    { id: 'roster-manage', path: '/staff/roster-manage', title: '维修排班管理', permission: 'roster.repair.manage' },
    { id: 'office-roster', path: '/staff/office-roster', title: '办公排班管理', permission: 'roster.office.manage' },
    { id: 'leave-review', path: '/staff/leave-review', title: '请假审批', permission: 'leave.review' }],
  attendancePolicies: [], workbenchProviders: ['rosters.pending'], reports: ['rosters.coverage'], auditActions: ['rosters.generated','rosters.updated','rosters.published','rosters.leave.created','rosters.leave.reviewed','rosters.leave.withdrawn']
};
