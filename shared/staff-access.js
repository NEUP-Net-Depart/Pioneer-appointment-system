// Staff entry points consume server-evaluated decisions. Never infer
// access from an account's historical admin/technician label.
export function staffPermission(user, code) {
  return user?.permissions?.[code] === true;
}

export function staffViewAllowed(user, view) {
  if (!user) return false;
  const permissions = {
    staff: 'repair.summary.read', members: 'members.manage', permissions: 'roles.manage',
    roster: 'roster.read', attendance: 'attendance.self','attendance-manage':'attendance.correct',
    users: 'accounts.manage', stats: 'statistics.read', capacity: 'settings.manage',
  };
  if (view === 'members') return ['members.manage', 'accounts.manage', 'settings.manage'].some(code => staffPermission(user, code));
  if (['workbench', 'settings'].includes(view)) return true;
  if (view === 'reports') return staffPermission(user, 'attendance.export') || staffPermission(user, 'settings.manage');
  return !!permissions[view] && staffPermission(user, permissions[view]);
}

export function staffSceneAllowed(user, home, scene) {
  if (scene === 'mine') return true;
  if (!home?.contexts?.some(context => context.id === scene)) return false;
  if (scene === 'repair') return !!home.repairs?.length || staffPermission(user, 'repair.summary.read');
  if (scene === 'desk') return ['onsite.create', 'repair.receive', 'repair.transfer']
    .some(code => staffPermission(user, code));
  return false;
}
