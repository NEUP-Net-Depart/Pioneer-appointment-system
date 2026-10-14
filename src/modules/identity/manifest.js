export const identityManifest = {
  code: 'identity', version: '1.0.0', contractVersion: '1', requiredSchemaVersion: '0007',
  dependencies: [], releaseState: 'ready',
  permissions: ['members.manage'], routes: ['/api/auth/me', '/api/members'],
  navigation: [{ id: 'members', path: '/staff/members', title: '成员', permission: 'members.manage' }],
  attendancePolicies: [], workbenchProviders: ['identity.resumeTasks'], reports: [],
  auditActions: ['identity.member.updated', 'identity.account.mapped']
};
