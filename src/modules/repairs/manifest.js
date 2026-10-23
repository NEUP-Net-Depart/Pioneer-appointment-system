export const repairsManifest = {
  code: 'repairs', version: '1.1.0', contractVersion: '1', requiredSchemaVersion: '0007',
  dependencies: ['identity@1', 'organization@1', 'authorization@1'], releaseState: 'ready',
  permissions: ['repair.summary.read','repair.start','repair.receive','repair.dispatch','repair.finish.own','repair.transfer','repair.correct','onsite.create','onsite.frontdesk.create','statistics.read'],
  routes: ['/api/appointments','/api/scan','/api/stats'], navigation: [{ id: 'workbench', path: '/staff/workbench', title: '工作台', permission: 'repair.summary.read' },
    { id: 'stats', path: '/staff/stats', title: '统计分析', permission: 'statistics.read' }],
  attendancePolicies: [], workbenchProviders: ['repairs.current'], reports: ['repairs.completed'], auditActions: ['receptions.received','receptions.assign','receptions.return','receptions.withdraw','receptions.reschedule','receptions.cancel','receptions.leave','receptions.guest_leave','repairs.claimed','repairs.completed']
};
