// Staff entry points consume server-evaluated decisions. Never infer
// access from an account's historical admin/technician label.
export function staffPermission(user, code) {
  return user?.permissions?.[code] === true;
}

export function staffViewAllowed(user, view) {
  if (!user) return false;
  const permissions = {
    staff: 'repair.summary.read', members: 'members.manage', permissions: 'roles.manage',
    roster: 'roster.read', 'roster-manage': 'roster.repair.manage', attendance: 'attendance.self','attendance-manage':'attendance.correct',
    users: 'accounts.manage', stats: 'statistics.read', capacity: 'settings.manage', 'office-roster': 'roster.office.manage', 'leave-review': 'leave.review',
  };
  if (['workbench', 'settings'].includes(view)) return true;
  if (view === 'roster-requests') return staffPermission(user, 'roster.read');
  if (view === 'roster-manage') return staffPermission(user,'roster.repair.manage') || staffPermission(user,'roster.repair.configure');
  if (view === 'roster') return staffPermission(user, 'roster.read') || staffPermission(user, 'roster.repair.manage') || staffPermission(user,'roster.repair.configure');
  return !!permissions[view] && staffPermission(user, permissions[view]);
}

export function staffSceneAllowed(user, home, scene) {
  if (scene === 'mine') return true;
  if (!home?.contexts?.some(context => context.id === scene)) return false;
  if (scene === 'repair') return !!home.currentRepair || staffPermission(user, 'repair.summary.read');
  if (scene === 'desk') return staffPermission(user, 'onsite.frontdesk.create');
  if (scene === 'operations') return staffPermission(user, 'repair.transfer');
  return false;
}
