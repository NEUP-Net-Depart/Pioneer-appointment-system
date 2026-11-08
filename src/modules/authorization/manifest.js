export const authorizationManifest = {
  code: 'authorization', version: '2.0.0', contractVersion: '1', requiredSchemaVersion: '0049',
  dependencies: ['identity@1', 'organization@1'], releaseState: 'ready',
  permissions: ['roles.manage'], routes: ['/api/permissions', '/api/roles'],
  navigation: [{ id: 'roles', path: '/staff/roles', title: '系统权限', permission: 'roles.manage' }],
  attendancePolicies: [], workbenchProviders: [], reports: [], auditActions: ['authorization.grant.updated']
};
