export const repairsManifest = {
  code: 'repairs', version: '1.0.0', contractVersion: '1', requiredSchemaVersion: '0007',
  dependencies: ['identity@1', 'organization@1', 'authorization@1'], releaseState: 'ready',
  permissions: ['repair.summary.read','repair.start','repair.finish.own','repair.transfer','repair.correct','onsite.create','onsite.frontdesk.create'],
  routes: ['/api/appointments','/api/scan'], navigation: [{ id: 'workbench', path: '/staff/workbench', title: '工作台', permission: 'repair.summary.read' }],
  attendancePolicies: [], workbenchProviders: ['repairs.current'], reports: ['repairs.completed'], auditActions: ['repairs.claimed','repairs.completed']
};
