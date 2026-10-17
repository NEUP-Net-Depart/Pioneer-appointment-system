import { BoundedFlow, SolverBudget, SolverBudgetExceeded, type FlowEdge } from './bounded-flow.ts';

type Slot = { businessDate: string; campusId: string; startAt: string; endAt: string; ordinaryMinimum?: number };
type Member = { memberId: string; pool: 'lead' | 'ordinary'; available: Slot[]; leadSlots?: Slot[]; manualSlots?: Slot[] };
type Assignment = Slot & { memberId: string; roleKind?: string; leaveStatus?: string; locked?: boolean; manualOverride?: boolean };
type Input = { slots: Slot[]; members: Member[]; locked?: Assignment[]; preservedAssignments?: Assignment[]; optimizationBudget?: number };
const key = (slot: Slot) => `${slot.businessDate}:${slot.campusId}:${slot.startAt}:${slot.endAt}`;
const available = (member: Member, slot: Slot) => member.available.some(window => window.businessDate === slot.businessDate &&
  window.campusId === slot.campusId && window.startAt <= slot.startAt && window.endAt >= slot.endAt) &&
  (member.pool !== 'lead' || (member.leadSlots || []).some(window => key(window) === key(slot)));

// Ordinary staff each work once; leaders work at most once and never consume
// ordinary capacity. Dummy flow makes shortages visible without inventing staff.
export function optimizeRepairMinimum(input: Input) {
  const budget = new SolverBudget(input.optimizationBudget ?? 8_000_000);
  const slots = [...input.slots].sort((a,b) => key(a).localeCompare(key(b)));
  const members = [...input.members].sort((a,b) => a.memberId.localeCompare(b.memberId));
  const locked = (input.locked || []).map(row => ({...row,locked:true}));
  const result = (assignments: Assignment[], complete: boolean, reason: string) => ({assignments,complete,reason,work:budget.work,flowRuns:budget.runs});
  if (new Set(locked.map(row => row.memberId)).size !== locked.length || locked.some(row => !(input.preservedAssignments || []).some(old=>old.memberId===row.memberId&&key(old)===key(row)&&(old.roleKind || '')===(row.roleKind || '')) && !members.some(member => member.memberId === row.memberId && (available(member,row) || row.manualOverride && member.manualSlots?.some(slot=>key(slot)===key(row))) &&
    (row.roleKind === 'repair_lead') === (member.pool === 'lead')) || !slots.some(slot => key(slot) === key(row)))) return result(locked,false,'invalid_locks_or_slots');
  try {
    const flow = new BoundedFlow(budget), source = flow.node(), sink = flow.node();
    const ordinary = slots.map(() => flow.node()), leads = slots.map(() => flow.node());
    const references: { member: Member; slot: Slot; edge: FlowEdge }[] = [];
    const shortages: FlowEdge[] = [];
    const fixed = slots.map(slot => locked.filter(row => row.leaveStatus !== 'approved' && key(row) === key(slot)));
    if (fixed.some(rows => rows.filter(row => row.roleKind === 'repair_lead').length > 1)) return result(locked,false,'invalid_locks_or_slots');
    for (const member of members.filter(person => !locked.some(row => row.memberId === person.memberId))) {
      const choices = slots.map((slot,index) => available(member,slot) ? index : -1).filter(index => index >= 0);
      if (!choices.length) continue;
      const node = flow.node();
      flow.edge(source,node,member.pool === 'ordinary' ? 1 : 0,1);
      for (const index of choices) references.push({member,slot:slots[index],edge:flow.edge(node,member.pool === 'lead' ? leads[index] : ordinary[index],0,1)});
    }
    for (let index = 0; index < slots.length; index++) {
      const fixedLeads = fixed[index].filter(row => row.roleKind === 'repair_lead').length;
      const fixedOrdinary = fixed[index].length - fixedLeads;
      const minimum = Math.max(0,(slots[index].ordinaryMinimum ?? 1) - fixedOrdinary);
      // Deficits cost more than any possible balancing cost (300 staff).
      shortages.push(flow.edge(source,leads[index],0,1,1_000_000));
      shortages.push(flow.edge(source,ordinary[index],0,minimum,1_000_000));
      flow.edge(leads[index],sink,1-fixedLeads,1-fixedLeads);
      for (let count = 1; count <= Math.max(minimum,members.length); count++) {
        flow.edge(ordinary[index],sink,count <= minimum ? 1 : 0,1,2 * (fixedOrdinary + count) - 1);
      }
    }
    flow.edge(sink,source,0,members.length + slots.length * 301);
    if (!flow.solve()) return result(locked,false,'coverage_infeasible');
    const assignments = [...locked,...references.filter(row => flow.used(row.edge)).map(row => ({...row.slot,memberId:row.member.memberId,roleKind:row.member.pool === 'lead' ? 'repair_lead' : ''}))];
    const complete = !shortages.some(edge => flow.used(edge));
    return result(assignments,complete,complete ? 'minimum_balanced' : 'coverage_infeasible');
  } catch (error) {
    if (!(error instanceof SolverBudgetExceeded)) throw error;
    return result(locked,false,'budget_exhausted');
  }
}
