export const auditManifest = {
  code: 'audit', version: '1.0.0', contractVersion: '1', requiredSchemaVersion: '0007',
  dependencies: ['identity@1'], releaseState: 'ready', permissions: ['audit.read'], routes: ['/api/audit'], navigation: [],
  attendancePolicies: [], workbenchProviders: [], reports: ['audit.events'], auditActions: ['audit.read']
};
