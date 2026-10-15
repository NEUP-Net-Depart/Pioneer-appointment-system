export const STAFF_PLATFORM_CONTRACT = 'staff-platform.v1';

export function normalizeAuthContext(value = {}) {
  return {
    actor: value.actor || { memberId: '', account: '', name: '' },
    memberships: Array.isArray(value.memberships) ? value.memberships : [],
    workProfiles: Array.isArray(value.workProfiles) ? value.workProfiles : [],
    grants: Array.isArray(value.grants) ? value.grants : [],
    todayDuties: Array.isArray(value.todayDuties) ? value.todayDuties : [],
    navigation: Array.isArray(value.navigation) ? value.navigation : [],
    resumeTasks: Array.isArray(value.resumeTasks) ? value.resumeTasks : [],
    modules: Array.isArray(value.modules) ? value.modules : [],
    authVersion: Number.isInteger(value.authVersion) ? value.authVersion : 0,
    schemaVersion: value.schemaVersion || '0011'
  };
}

export function hasGrant(context, permissionCode) {
  return context.grants.some(grant => grant.permissionCode === permissionCode);
}
