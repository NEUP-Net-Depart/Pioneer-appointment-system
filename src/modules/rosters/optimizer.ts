import {BoundedFlow, SolverBudget, SolverBudgetExceeded, type FlowEdge} from './bounded-flow.ts';

export type Slot = {businessDate: string; campusId: string; startAt: string; endAt: string; requireLead?: boolean};
export type Member = {memberId: string; available?: Slot[]; leadSlots?: Slot[]; isLead?: boolean};
export type Assignment = Slot & {memberId: string; roleKind?: string; locked?: boolean; leaveStatus?: string};
type Input = {members: Member[]; slots: Slot[]; locked?: Assignment[]; requireLead?: boolean; optimizationBudget?: number};
const slotKey = (slot: Slot) => `${slot.businessDate}:${slot.campusId}:${slot.startAt}:${slot.endAt}`;
const available = (member: Member, slot: Slot) => (member.available || []).some(window => window.businessDate === slot.businessDate && window.startAt <= slot.startAt && window.endAt >= slot.endAt && (!window.campusId || window.campusId === slot.campusId));
const qualified = (member: Member, slot: Slot) => Array.isArray(member.leadSlots) ? member.leadSlots.some(value => slotKey(value) === slotKey(slot)) : member.isLead === true;
const gcd = (a: number, b: number): number => b ? gcd(b,a % b) : a;

export function optimizeRoster(input: Input) {
  const budget = new SolverBudget(input.optimizationBudget ?? 8_000_000);
  const members = [...input.members].sort((a,b) => a.memberId.localeCompare(b.memberId));
  const slots = [...input.slots].sort((a,b) => slotKey(a).localeCompare(slotKey(b)));
  // Locks fix the assignment, not the leader decision. A qualified locked
  // member can cover the required role without moving to another slot.
  const locked = [...(input.locked || [])].sort((a,b) => a.memberId.localeCompare(b.memberId) || slotKey(a).localeCompare(slotKey(b))).map(row => ({...row,locked:true,
    roleKind: row.roleKind || (members.some(member => member.memberId === row.memberId && qualified(member,row)) ? 'repair_lead' : '')}));
  const lockedMembers = new Set(locked.map(row => row.memberId));
  const fixedCounts = slots.map(slot => locked.filter(row => row.leaveStatus !== 'approved' && slotKey(row) === slotKey(slot)).length);
  const fixedLeads = slots.map(slot => locked.some(row => row.leaveStatus !== 'approved' && row.roleKind === 'repair_lead' && slotKey(row) === slotKey(slot)));
  const choices = members.filter(member => !lockedMembers.has(member.memberId)).map(member => ({member,slots:slots.map((slot,index) => available(member,slot) ? index : -1).filter(index => index >= 0)})).filter(item => item.slots.length);
  const campuses = [...new Set(slots.map(slot => slot.campusId))].sort();
  const groups = campuses.map(campusId => slots.map((slot,index) => slot.campusId === campusId ? index : -1).filter(index => index >= 0));
  const total = choices.length + fixedCounts.reduce((sum,value) => sum + value,0);
  const maximum = slots.map((_,index) => fixedCounts[index] + choices.filter(item => item.slots.includes(index)).length);
  const minimum = slots.map((_,index) => Math.max(1,fixedCounts[index] + choices.filter(item => item.slots.length === 1 && item.slots[0] === index).length));
  const scale = groups.reduce((value,group) => value * group.length / gcd(value,group.length),1);
  const groupMin = groups.map(group => group.reduce((sum,index) => sum + fixedCounts[index],0) + choices.filter(item => item.slots.every(index => group.includes(index))).length);
  const groupMax = groups.map(group => group.reduce((sum,index) => sum + fixedCounts[index],0) + choices.filter(item => item.slots.some(index => group.includes(index))).length);
  let best: {assignments: Assignment[]; counts: number[]; spread: number; deviation: number} | null = null;
  function metrics(assignments: Assignment[]) {
    const counts = slots.map(slot => assignments.filter(row => row.leaveStatus !== 'approved' && slotKey(row) === slotKey(slot)).length);
    return {assignments,counts,spread:groups.reduce((sum,group) => sum + Math.max(...group.map(index => counts[index])) - Math.min(...group.map(index => counts[index])),0),
      deviation:groups.reduce((sum,group) => {const n = group.reduce((value,index) => value + counts[index],0); return sum + scale * group.reduce((value,index) => value + counts[index] ** 2,0) - scale / group.length * n ** 2;},0)};
  }
  function flow(lower: number[], upper: number[], totals?: number[]) {
    budget.consume();
    const network = new BoundedFlow(budget), source = network.node(), sink = network.node();
    const people = choices.map(() => network.node()), leadNodes = slots.map(() => network.node()), slotNodes = slots.map(() => network.node()), groupNodes = groups.map(() => network.node());
    const references: {member: Member; slot: number; edge: FlowEdge}[] = [];
    for (const [index,item] of choices.entries()) {
      network.edge(source,people[index],1,1);
      for (const slot of item.slots) {
        references.push({member:item.member,slot,edge:network.edge(people[index],slotNodes[slot],0,1)});
        if (qualified(item.member,slots[slot])) references.push({member:item.member,slot,edge:network.edge(people[index],leadNodes[slot],0,1)});
      }
    }
    for (let index = 0; index < slots.length; index++) {
      const needsLead = (input.requireLead || slots[index].requireLead) && !fixedLeads[index];
      network.edge(leadNodes[index],slotNodes[index],needsLead ? 1 : 0,needsLead ? 1 : 0);
      const group = campuses.indexOf(slots[index].campusId);
      if (upper[index] < lower[index]) return null;
      for (let count = fixedCounts[index] + 1; count <= upper[index]; count++) network.edge(slotNodes[index],groupNodes[group],count <= lower[index] ? 1 : 0,1,2 * count - 1);
    }
    for (let index = 0; index < groups.length; index++) {
      const fixed = groups[index].reduce((sum,slot) => sum + fixedCounts[slot],0);
      network.edge(groupNodes[index],sink,totals ? totals[index] - fixed : 0,totals ? totals[index] - fixed : choices.length);
    }
    network.edge(sink,source,choices.length,choices.length);
    if (!network.solve()) return null;
    return metrics([...locked,...references.filter(row => network.used(row.edge)).map(row => ({...slots[row.slot],memberId:row.member.memberId,roleKind:qualified(row.member,slots[row.slot]) ? 'repair_lead' : ''}))]);
  }
  function* totalsFor(group = 0, remaining = total, prefix: number[] = []): Generator<number[]> {
    budget.consume();
    if (group === groups.length) {if (!remaining) yield prefix; return;}
    const min = Math.max(groupMin[group],groups[group].reduce((sum,index) => sum + minimum[index],0));
    const max = Math.min(groupMax[group],remaining,groups[group].reduce((sum,index) => sum + maximum[index],0));
    for (let n = min; n <= max; n++) yield* totalsFor(group + 1,remaining - n,[...prefix,n]);
  }
  function* spreadsFor(remaining: number, group = 0, prefix: number[] = []): Generator<number[]> {
    budget.consume();
    if (group === groups.length) {if (!remaining) yield prefix; return;}
    for (let spread = 0; spread <= remaining; spread++) yield* spreadsFor(remaining - spread,group + 1,[...prefix,spread]);
  }
  function* intervals(totals: number[], spreads: number[], group = 0, lower = [...minimum], upper = [...maximum]): Generator<{lower: number[]; upper: number[]}> {
    budget.consume();
    if (group === groups.length) {yield {lower,upper}; return;}
    const size = groups[group].length, spread = spreads[group];
    for (let min = Math.max(0,Math.ceil(totals[group] / size - spread)); min <= Math.floor(totals[group] / size); min++) {
      const nextLower = [...lower], nextUpper = [...upper];
      for (const slot of groups[group]) {nextLower[slot] = Math.max(minimum[slot],min); nextUpper[slot] = Math.min(maximum[slot],min + spread);}
      if (groups[group].some(slot => nextLower[slot] > nextUpper[slot]) || groups[group].reduce((sum,slot) => sum + nextLower[slot],0) > totals[group] || groups[group].reduce((sum,slot) => sum + nextUpper[slot],0) < totals[group]) continue;
      yield* intervals(totals,spreads,group + 1,nextLower,nextUpper);
    }
  }
  const result = (complete: boolean, reason: string) => ({assignments:best?.assignments,complete,reason,work:budget.work,flowRuns:budget.runs,
    objective:best ? {assigned:best.assignments.filter(row => row.leaveStatus !== 'approved').length,campusSpreadSum:best.spread,squaredDeviation:best.deviation / scale} : null});
  try {
    if (!slots.length || new Set(slots.map(slotKey)).size !== slots.length || new Set(members.map(row => row.memberId)).size !== members.length || new Set(locked.map(row => row.memberId)).size !== locked.length || locked.some(row => !members.some(member => member.memberId === row.memberId && available(member,row) && (!row.roleKind || row.roleKind === 'repair_lead' && qualified(member,row))) || !slots.some(slot => slotKey(slot) === slotKey(row)))) return result(false,'invalid_locks_or_slots');
    best = flow(minimum,maximum);
    if (!best) return result(false,'coverage_infeasible');
    if (!best.spread && !best.deviation) return result(true,'optimal');
    const totals = [...totalsFor()];
    for (let spread = 0; spread <= best.spread; spread++) {
      let found = false;
      for (const groupTotals of totals) {
        // For fixed campus totals, squared count cost differs from the sum
        // of squared deviations only by a constant. It is therefore exact.
        const deviationBound = groupTotals.reduce((sum,n,index) => sum + scale / groups[index].length * (n % groups[index].length) * (groups[index].length - n % groups[index].length),0);
        if (best.spread === spread && deviationBound > best.deviation) continue;
        for (const ranges of spreadsFor(spread)) for (const bounds of intervals(groupTotals,ranges)) {
          const candidate = flow(bounds.lower,bounds.upper,groupTotals);
          if (!candidate) continue;
          found = true;
          if (candidate.spread < best.spread || candidate.spread === best.spread && candidate.deviation < best.deviation) best = candidate;
        }
      }
      if (found) return result(true,'optimal');
    }
    // An incumbent must fit an enumerated interval. Do not claim a proof if
    // an unexpected model inconsistency prevents finding it again.
    return result(false,'search_incomplete');
  } catch (error) {
    if (!(error instanceof SolverBudgetExceeded)) throw error;
    return result(false,'budget_exhausted');
  }
}
