// Enabled-platform entry points consume server-evaluated decisions. Never infer
// access from an account's historical admin/technician label.
export function staffPermission(user, code) {
  return user?.staffWorkflowEnabled ? user.permissions?.[code] === true :
    (user?.grants || []).some(grant => grant.permissionCode === code);
}

export function staffViewAllowed(user, view) {
  if (!user?.staffWorkflowEnabled) return true;
  const permissions = {
    staff: 'repair.summary.read', members: 'members.manage', permissions: 'roles.manage',
    roster: 'roster.read', 'roster-manage': 'roster.repair.manage', attendance: 'attendance.self',
    users: 'accounts.manage', stats: 'statistics.read', capacity: 'settings.manage',
  };
  if (['workbench', 'settings'].includes(view)) return true;
  if (view === 'roster') return staffPermission(user, 'roster.read') || staffPermission(user, 'roster.repair.manage');
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
