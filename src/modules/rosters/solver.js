function key(value) { return `${value.memberId}:${value.businessDate}:${value.campusId}:${value.startAt || ''}:${value.endAt || ''}`; }
function slotKey(value) { return `${value.businessDate}:${value.campusId}:${value.startAt || ''}:${value.endAt || ''}`; }
function weekKey(value) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

export function generateRoster(input) {
  const members = [...(input.members || [])].sort((a, b) => String(a.memberId).localeCompare(String(b.memberId)));
  const slots = [...(input.slots || [])].sort((a, b) => String(a.businessDate).localeCompare(String(b.businessDate)) || String(a.campusId).localeCompare(String(b.campusId)));
  const locked = input.locked || [];
  const assignments = [];
  const assignedMembers = [];
  const lockedKeys = locked.map(item => key(item));
  for (const item of locked) { assignments.push({ ...item, locked: true }); assignedMembers.push(item.memberId); }
  for (const slot of slots) {
    if (assignments.some(item => slotKey(item) === slotKey(slot))) continue;
    const candidates = members.filter(member => !assignedMembers.includes(member.memberId) &&
      (member.available || []).some(window => window.businessDate === slot.businessDate && window.startAt <= slot.startAt && window.endAt >= slot.endAt && (!window.campusId || window.campusId === slot.campusId)) &&
      !lockedKeys.includes(key({ memberId: member.memberId, ...slot })));
    const candidate = candidates.find(member => member.isLead) || candidates[0];
    if (!candidate) continue;
    assignments.push({ memberId: candidate.memberId, ...slot, roleKind: candidate.isLead ? 'repair_lead' : 'repair' });
    assignedMembers.push(candidate.memberId);
  }
  const covered = slots.filter(slot => assignments.some(item => slotKey(item) === slotKey(slot)));
  const unassigned = members.filter(member => !assignedMembers.includes(member.memberId)).map(member => member.memberId);
  const counts = slots.map(slot => assignments.filter(item => slotKey(item) === slotKey(slot)).length);
  return {
    assignments, unassigned, coverage: { required: slots.length, covered: covered.length, complete: covered.length === slots.length },
    balance: { min: counts.length ? Math.min(...counts) : 0, max: counts.length ? Math.max(...counts) : 0, spread: counts.length ? Math.max(...counts) - Math.min(...counts) : 0 },
    inputSnapshotRef: { memberCount: members.length, slotCount: slots.length }, ruleVersion: input.ruleVersion || '1.0.0', algorithmVersion: 'deterministic-greedy-v1',
    roleCoverage: { required: slots.filter(slot => input.requireLead === true || slot.requireLead === true).length, covered: slots.filter(slot => assignments.some(item => slotKey(item) === slotKey(slot) && item.roleKind === 'repair_lead')).length },
    solverStatus: covered.length === slots.length ? 'optimal' : 'needs_review'
  };
}

export function validateRoster(result, input) {
  const errors = [];
  const seen = [];
  for (const item of result.assignments || []) {
    const memberDays = seen.filter(value => value.memberId === item.memberId);
    const week = item.weekStart || input.weekStart || weekKey(item.businessDate);
    if (memberDays.some(value => (value.weekStart || input.weekStart || weekKey(value.businessDate)) === week)) errors.push({ code: 'MEMBER_WEEK_DUPLICATE', memberId: item.memberId });
    seen.push(item);
  }
  for (const slot of input.slots || []) if (!(result.assignments || []).some(item => slotKey(item) === slotKey(slot))) errors.push({ code: 'COVERAGE_MISSING', slot });
  for (const slot of input.slots || []) if ((input.requireLead === true || slot.requireLead === true) && !(result.assignments || []).some(item => slotKey(item) === slotKey(slot) && item.roleKind === 'repair_lead')) errors.push({ code: 'LEAD_COVERAGE_MISSING', slot });
  return { valid: errors.length === 0, errors };
}
