export const staffIdentityLabels = {
  repair: '维修工作人员', exchange: '交流人员', office: '办公工作人员',
  repair_lead: '维修负责人', office_lead: '办公值班负责人', superadmin: '最高管理员',
};

// Identity is a description of effective qualifications/authorization, not an action grant.
export function staffIdentities(context, authorizer, target = {}) {
  const codes = new Set((context.workProfiles || []).filter(item => item.active !== false &&
    (!item.effectiveFrom || item.effectiveFrom <= context.businessDate) && (!item.effectiveTo || context.businessDate < item.effectiveTo))
    .map(item => item.profileCode).filter(code => ['repair', 'exchange', 'office'].includes(code)));
  // Describe whether an authorization exists in its own range; this never grants
  // an action on an omitted department/object or removes a binding restriction.
  const has = (permission, roleCode) => (context.grants || []).some(grant => {
    if (roleCode && grant.roleCode !== roleCode) return false;
    const scope = grant.scope || {};
    const departments = target.departmentId ? [target.departmentId] : scope.departmentIds || scope.departments || [undefined];
    const objects = target.id ? [target.id] : scope.objectIds || [undefined];
    const descriptive = { ...grant, conditions: (grant.conditions || []).filter(condition => !['activeDutyRole', 'signedDutyPresence'].includes(condition.code)) };
    return departments.some(departmentId => objects.some(id => authorizer.evaluate(context.actor, permission,
      {...target, departmentId, id}, context, [descriptive]).allowed));
  });
  if (context.actor?.role === 'superadmin') codes.add('superadmin');
  else {
    if (has('repair.transfer', 'repair_lead') || has('repair.correct', 'repair_lead')) codes.add('repair_lead');
    if (has('roster.office.manage', 'office_lead')) codes.add('office_lead');
  }
  return [...codes].map(code => ({ code, label: staffIdentityLabels[code] || code }));
}

export function fieldPersonGroup(person) {
  const codes = (person.identities || []).map(item => item.code);
  return person.scheduledRepair || person.signedInAt && codes.some(code => ['repair', 'exchange', 'repair_lead'].includes(code)) ? 'repair' : 'other';
}

export function compareFieldPeople(a, b) {
  const rank = person => person.canReceive ? 0 : person.state === 'repairing' ? 1 : person.state === 'away' ? 2 : person.state === 'unsigned' ? 3 : 4;
  const lead = person => (person.identities || []).some(item => item.code === 'repair_lead');
  return Number(fieldPersonGroup(b) === 'repair') - Number(fieldPersonGroup(a) === 'repair') || rank(a) - rank(b) || Number(lead(b)) - Number(lead(a)) || a.name.localeCompare(b.name, 'zh-CN') || a.memberId.localeCompare(b.memberId);
}
