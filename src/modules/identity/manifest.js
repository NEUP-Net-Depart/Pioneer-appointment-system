export const identityManifest = {
  code: 'identity', version: '1.0.0', contractVersion: '1', requiredSchemaVersion: '0007',
  dependencies: [], releaseState: 'ready',
  permissions: ['members.manage', 'accounts.manage', 'settings.manage'], routes: ['/api/auth/me', '/api/members', '/api/users', '/api/slot-capacities'],
  navigation: [{ id: 'members', path: '/staff/members', title: '成员', permission: 'members.manage' },
    { id: 'users', path: '/staff/users', title: '账号管理', permission: 'accounts.manage' },
    { id: 'capacity', path: '/staff/capacity', title: '预约配置', permission: 'settings.manage' }],
  attendancePolicies: [], workbenchProviders: ['identity.resumeTasks'], reports: [],
  auditActions: ['identity.member.updated', 'identity.account.mapped']
};
