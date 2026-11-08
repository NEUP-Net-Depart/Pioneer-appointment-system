export const dutyManifest = {
  code: 'duty', version: '1.0.0', contractVersion: '1', requiredSchemaVersion: '0007',
  dependencies: ['identity@1', 'organization@1', 'attendance@1'], releaseState: 'ready', permissions: [],
  routes: [], navigation: [],
  attendancePolicies: ['duty.v1'], workbenchProviders: ['duty.today'], reports: ['duty.monthly'], auditActions: ['duty.checkin','duty.presence.changed']
};
