export function memberPublic(row, options = {}) {
  if (!row) return null;
  const memberships = options.memberships || [];
  const profiles = options.profiles || [];
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
    workProfiles: profiles,
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
