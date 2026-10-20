export const attendanceManifest = {
  code: 'attendance', version: '1.2.0', contractVersion: '1', requiredSchemaVersion: '0021',
  dependencies: ['identity@1', 'organization@1'], releaseState: 'ready',
  permissions: ['attendance.self','attendance.session.manage','attendance.correct','attendance.export'],
  routes: ['/api/attendance','/api/presence'], navigation: [{ id: 'attendance', path: '/staff/attendance', title: '签到', permission: 'attendance.self' },{id:'attendance-manage',path:'/staff/attendance-manage',title:'考勤核查',permission:'attendance.correct'}],
  attendancePolicies: ['duty.v1','meeting.v1'], workbenchProviders: ['attendance.today'], reports: ['attendance.monthly'],
  auditActions: ['attendance.event.created','attendance.checked_in','attendance.corrected']
};
