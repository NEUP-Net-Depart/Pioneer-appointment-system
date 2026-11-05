export const repairsManifest = {
  code: 'repairs', version: '2.0.0', contractVersion: '1', requiredSchemaVersion: '0049',
  dependencies: ['identity@1', 'organization@1', 'authorization@1'], releaseState: 'ready',
  permissions: ['repair.summary.read','repair.start','repair.receive','repair.finish.own','repair.transfer','repair.correct','onsite.create','statistics.read'],
  routes: ['/api/appointments','/api/scan','/api/stats'], navigation: [{ id: 'workbench', path: '/staff/workbench', title: '工作台', permission: 'repair.summary.read' },
    { id: 'stats', path: '/staff/stats', title: '统计分析', permission: 'statistics.read' }],
  attendancePolicies: [], workbenchProviders: ['repairs.current'], reports: ['repairs.completed'], auditActions: ['repairs.received','repairs.started','repairs.transferred','repairs.completed','repairs.corrected','repairs.photos.supplemented']
};
