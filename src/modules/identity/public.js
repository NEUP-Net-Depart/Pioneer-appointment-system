export function memberPublic(row, options = {}) {
  if (!row) return null;
  const memberships = options.memberships || [];
  return {
    memberId: row.id,
    name: row.name,
    studentId: row.student_id || '',
    college: row.college || '',
    major: row.major || '',
    homeCampusId: row.home_campus_id || '',
    status: row.status,
    revision: row.revision,
    memberships,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function accountIdentity(row) {
  return row ? { account: row.account, memberId: row.member_id || `member-${row.account}`, name: row.name } : null;
}

export function activeAt(from, to, date) {
  return from <= date && (!to || date < to);
}

export function businessIdentityEligible(authorizer, { memberId, status, campuses, grants, memberships, authorizationDate }) {
  if (status !== 'active' || !campuses.length) return false;
  const actor = { memberId, status, authorizedCampuses: campuses };
  const context = { actor, memberships, businessDate: authorizationDate, authorizationDate };
  return campuses.some(campus => grants.some(grant => {
    const scope = grant.scope || {};
    const departments = scope.departmentIds || scope.departments || [undefined];
    const objects = scope.objectIds || [undefined];
    const identityGrant = { ...grant, conditions: (grant.conditions || []).filter(item => !['activeDutyRole', 'signedDutyPresence', 'attendanceEligible'].includes(item.code)) };
    return departments.some(departmentId => objects.some(id => authorizer.evaluate(actor, grant.permissionCode,
      { campusId: campus, memberId, assignedMemberId: memberId, departmentId, id }, context, [identityGrant]).allowed));
  }));
}
