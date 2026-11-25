import type { PermissionDecisions } from './staff-types.ts';

type StaffPermissions = { permissions?: PermissionDecisions } | null | undefined;

// Staff entry points consume server-evaluated decisions. Never infer
// access from an account's historical admin/technician label.
export function staffPermission(user: StaffPermissions, code: string) {
  return user?.permissions?.[code] === true;
}

export function staffViewAllowed(user: StaffPermissions, view: string) {
  if (!user) return false;
  const permissions: Partial<Record<string, string>> = {
    staff: 'repair.summary.read', members: 'members.manage', permissions: 'roles.manage',

    users: 'accounts.manage', stats: 'statistics.read', capacity: 'booking.manage',
  };
  if (view === 'members') return ['members.manage', 'accounts.manage'].some(code => staffPermission(user, code));
  if (['workbench', 'settings'].includes(view)) return true;
  if (view === 'duties') return ['roster.manage','attendance.self','attendance.correct','attendance.export'].some(code => staffPermission(user,code));
  const permission = permissions[view];
  return !!permission && staffPermission(user, permission);
}

export function staffSceneAllowed(user: StaffPermissions, home: { contexts?: readonly { id: string }[] } | null | undefined, scene: string) {
  if (scene === 'mine') return true;
  if (!home?.contexts?.some(context => context.id === scene)) return false;
  if (scene === 'today') return staffPermission(user, 'repair.summary.read');
  return false;
}
