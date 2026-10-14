export const ASSIGNMENT_TYPES = ['primary', 'secondary', 'exchange', 'temporary'];

export function membershipIsActive(membership, businessDate) {
  return membership.effectiveFrom <= businessDate && (!membership.effectiveTo || businessDate < membership.effectiveTo);
}

export function primaryMembership(memberships, businessDate) {
  return memberships.find(item => item.isPrimary && membershipIsActive(item, businessDate)) || null;
}

export function membershipSnapshot(membership) {
  return membership ? {
    departmentId: membership.departmentId,
    departmentName: membership.departmentName,
    assignmentType: membership.assignmentType,
    isPrimary: !!membership.isPrimary
  } : { departmentId: null, departmentName: '', assignmentType: 'unknown', isPrimary: false };
}
