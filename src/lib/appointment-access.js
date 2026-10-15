// Alternatives of field conditions, shared by detail authorization and SQL candidate filtering.
export function appointmentAccessRules(user, { start = false } = {}) {
  if (user.role !== 'technician') return [[]];
  return [
    [{ field: 'status', operator: 'ne', value: 'booked' }, { field: 'assignedTo', value: user.account }],
    [{ field: 'source', value: 'onsite' }, { field: 'registeredBy', value: user.account }],
    ...(start ? [[{ field: 'status', value: 'booked' }]] : [])
  ];
}
export function matchesAppointmentAccess(item, rules) {
  return rules.some(conditions => conditions.every(({ field, operator, value }) => operator === 'ne' ? item[field] !== value : item[field] === value));
}
