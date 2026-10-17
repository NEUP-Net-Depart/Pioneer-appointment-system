import { optimizeRoster } from './optimizer.ts';
import { optimizeRepairMinimum } from './repair-minimum.ts';

function key(value) { return `${value.memberId}:${value.businessDate}:${value.campusId}:${value.startAt || ''}:${value.endAt || ''}`; }
function slotKey(value) { return `${value.businessDate}:${value.campusId}:${value.startAt || ''}:${value.endAt || ''}`; }
function weekKey(value) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function availableFor(member, slot) {
  if (slot.manualOverride === true && (member.manualSlots || []).some(item=>slotKey(item)===slotKey(slot))) return true;
  return (member.available || []).some(window => window.businessDate === slot.businessDate &&
    window.startAt <= slot.startAt && window.endAt >= slot.endAt && (!window.campusId || window.campusId === slot.campusId));
}
function leadFor(member, slot) {
  return Array.isArray(member.leadSlots) ? member.leadSlots.some(item => slotKey(item) === slotKey(slot)) : member.isLead === true;
}

function diagnosticAssignments(input) {
  const members = [...(input.members || [])].sort((a, b) => String(a.memberId).localeCompare(String(b.memberId)));
  const slots = [...(input.slots || [])].sort((a, b) => slotKey(a).localeCompare(slotKey(b)));
  const assignments = [...(input.locked || [])].sort((a,b) => key(a).localeCompare(key(b))).map(item => ({ ...item, locked: true }));
  const assigned = new Set(assignments.map(item => item.memberId));
  // Augmenting paths reserve scarce qualified leaders without stranding a slot
  // when a flexible leader could cover a different day.
  const leaders = new Map();
  function placeLead(slotIndex, visited) {
    const slot = slots[slotIndex];
    for (const member of members) {
      if (assigned.has(member.memberId) || visited.has(member.memberId) || !availableFor(member, slot) || !leadFor(member, slot)) continue;
      visited.add(member.memberId);
      if (!leaders.has(member.memberId) || placeLead(leaders.get(member.memberId), visited)) {
        leaders.set(member.memberId, slotIndex);
        return true;
      }
    }
    return false;
  }
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    if ((input.requireLead || slot.requireLead) && !assignments.some(item => slotKey(item) === slotKey(slot) && item.roleKind === 'repair_lead')) placeLead(index, new Set());
  }
  for (const [memberId, index] of leaders) {
    assignments.push({ memberId, ...slots[index], roleKind: 'repair_lead' }); assigned.add(memberId);
  }
  const remaining = members.filter(member => !assigned.has(member.memberId)).map(member => ({ member, choices: slots.filter(slot => availableFor(member, slot)) }))
    .sort((a, b) => a.choices.length - b.choices.length || a.member.memberId.localeCompare(b.member.memberId));
  for (const { member, choices } of remaining) {
    const counts = slot => assignments.filter(item => slotKey(item) === slotKey(slot)).length;
    choices.sort((a, b) => counts(a) - counts(b) || slotKey(a).localeCompare(slotKey(b)));
    if (!choices.length) continue;
    const slot = choices[0];
    assignments.push({ memberId: member.memberId, ...slot, roleKind: leadFor(member, slot) ? 'repair_lead' : '' });
    assigned.add(member.memberId);
  }
  return assignments;
}

export function generateRoster(input) {
  const members = input.members || [], slots = input.slots || [];
  const pooled = input.ruleVersion === 'repair-minimum-v2';
  const optimized = pooled ? optimizeRepairMinimum({ ...input, members, slots }) : optimizeRoster({ ...input, members, slots });
  const assignments = optimized.assignments || diagnosticAssignments(input);
  const assigned = new Set(assignments.map(item => item.memberId));
  const effective = assignments.filter(item => item.leaveStatus !== 'approved');
  const counts = slots.map(slot => effective.filter(item => slotKey(item) === slotKey(slot)).length);
  const covered = counts.filter(count => count > 0).length;
  const campuses = [...new Set(slots.map(slot => slot.campusId))].sort().map(campusId => {
    const values = slots.map((slot,index) => slot.campusId === campusId ? counts[index] : null).filter(value => value !== null);
    return { campusId, counts: values, spread: Math.max(...values) - Math.min(...values) };
  });
  const result = {
    assignments, unassigned: members.filter(member => !assigned.has(member.memberId) && (!pooled || member.pool !== 'lead')).map(member => member.memberId),
    optionalUnassigned: pooled ? members.filter(member => member.pool === 'lead' && !assigned.has(member.memberId)).map(member => member.memberId) : [],
    coverage: { required: slots.length, covered, complete: covered === slots.length },
    balance: { min: counts.length ? Math.min(...counts) : 0, max: counts.length ? Math.max(...counts) : 0, spread: counts.length ? Math.max(...counts) - Math.min(...counts) : 0 },
    inputSnapshotRef: { memberCount: members.length, slotCount: slots.length, optimization: {
      complete: optimized.complete, reason: optimized.reason, work: optimized.work, flowRuns: optimized.flowRuns,
      objective: optimized.objective, campuses
    } }, ruleVersion: input.ruleVersion || '1.0.0', algorithmVersion: pooled ? 'bounded-flow-pools-v1' : 'bounded-flow-campus-v3',
    roleCoverage: { required: slots.filter(slot => input.requireLead || slot.requireLead).length,
      covered: slots.filter(slot => (input.requireLead || slot.requireLead) && effective.some(item => slotKey(item) === slotKey(slot) && item.roleKind === 'repair_lead')).length }
  };
  return { ...result, solverStatus: validateRoster(result, input).valid ? (optimized.complete ? 'optimal' : 'feasible') : 'needs_review' };
}

export function validateRoster(result, input) {
  const errors = [];
  const pooled = input.ruleVersion === 'repair-minimum-v2';
  const seen = [];
  const effective = (result.assignments || []).filter(item => item.leaveStatus !== 'approved');
  if (!input.slots?.length) errors.push({ code: 'SLOTS_REQUIRED' });
  for (const item of result.assignments || []) {
    const member = (input.members || []).find(candidate => candidate.memberId === item.memberId);
    const slot = (input.slots || []).find(candidate => slotKey(candidate) === slotKey(item));
    const preserved=(input.preservedAssignments || []).some(previous=>key(previous)===key(item)&&(previous.roleKind || '')===(item.roleKind || '')&&(previous.dutyType || 'repair')===(item.dutyType || 'repair'));
    if (!slot || !preserved && (!member || !availableFor(member, item))) errors.push({ code: 'MEMBER_UNAVAILABLE', memberId: item.memberId, slot: item });
    const office = slot?.dutyType === 'office';
    if (!preserved && item.roleKind && (office ? item.roleKind !== 'coordinator' : item.roleKind !== 'repair_lead' || !member || !leadFor(member, item))) errors.push({ code: 'LEAD_INELIGIBLE', memberId: item.memberId });
    if (!preserved && pooled && member && (item.roleKind === 'repair_lead') !== (member.pool === 'lead')) errors.push({code:'POOL_MISMATCH',memberId:item.memberId});
    if (item.dutyType && item.dutyType !== (slot?.dutyType || 'repair')) errors.push({ code: 'DUTY_TYPE_MISMATCH', memberId: item.memberId });
    const week = weekKey(item.businessDate);
    if (seen.some(value => value.memberId === item.memberId && (office ? value.businessDate === item.businessDate : weekKey(value.businessDate) === week))) errors.push({ code: office ? 'MEMBER_DAY_DUPLICATE' : 'MEMBER_WEEK_DUPLICATE', memberId: item.memberId });
    seen.push(item);
  }
  for (const locked of input.locked || []) if (!(result.assignments || []).some(item => key(item) === key(locked))) errors.push({ code: 'LOCKED_ASSIGNMENT_CHANGED', memberId: locked.memberId });
  for (const slot of input.slots || []) {
    if ((slot.dutyType!=='office'||(slot.ordinaryMinimum??1)>0)&&!effective.some(item => slotKey(item) === slotKey(slot))) errors.push({ code: 'COVERAGE_MISSING', slot });
    if(slot.dutyType==='office'&&effective.filter(item=>slotKey(item)===slotKey(slot)).length<(slot.ordinaryMinimum??1))errors.push({code:'OFFICE_COVERAGE_MISSING',slot,required:slot.ordinaryMinimum??1});
    if ((input.requireLead || slot.requireLead) && !effective.some(item => slotKey(item) === slotKey(slot) && item.roleKind === 'repair_lead')) errors.push({ code: 'LEAD_COVERAGE_MISSING', slot });
    if (pooled) {
      const assigned = effective.filter(item => slotKey(item) === slotKey(slot));
      const leadCount = assigned.filter(item => item.roleKind === 'repair_lead').length;
      const ordinaryCount = assigned.length - leadCount;
      if (leadCount > 1) errors.push({code:'LEAD_SURPLUS',slot,actual:leadCount,required:1});
      if (ordinaryCount < (slot.ordinaryMinimum ?? 1)) errors.push({code:'ORDINARY_COVERAGE_MISSING',slot,actual:ordinaryCount,required:slot.ordinaryMinimum ?? 1});
    }
  }
  if (pooled) for (const member of input.members || []) {
    if (member.pool === 'ordinary' && !(result.assignments || []).some(item => item.memberId === member.memberId)) errors.push({code:'MEMBER_WEEK_MISSING',memberId:member.memberId});
  }
  return { valid: errors.length === 0, errors };
}
