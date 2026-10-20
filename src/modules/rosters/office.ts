import {BoundedFlow,SolverBudget} from './bounded-flow.ts';
type Slot={businessDate:string;campusId:string;startAt:string;endAt:string;ordinaryMinimum?:number};
type Assignment=Slot&{memberId:string;roleKind?:string;locked?:boolean;manualOverride?:boolean;leaveStatus?:string};
type Member={memberId:string;available:Slot[]};
const key=(slot:Slot)=>`${slot.businessDate}:${slot.campusId}:${slot.startAt}:${slot.endAt}`;
export function generateOfficeRoster(input:{slots:Slot[];members:Member[];locked?:Assignment[];ruleVersion?:string}) {
  const locked=(input.locked||[]).map(row=>({...row,locked:true}));
  const flow=new BoundedFlow(new SolverBudget(8_000_000)),source=flow.node(),sink=flow.node(),slotNodes=input.slots.map(()=>flow.node());
  const references:{member:Member;slot:Slot;edge:ReturnType<BoundedFlow['edge']>}[]=[],shortages:ReturnType<BoundedFlow['edge']>[]=[];
  for(const member of [...input.members].sort((a,b)=>a.memberId.localeCompare(b.memberId))) {
    const node=flow.node(),fixed=locked.filter(row=>row.memberId===member.memberId).length;
    for(let count=1;count<=4-fixed;count++)flow.edge(source,node,0,1,(2*(fixed+count)-1)*100);
    for(const day of [...new Set(input.slots.map(slot=>slot.businessDate))]) {
      if(locked.some(row=>row.memberId===member.memberId&&row.businessDate===day))continue;
      const dayNode=flow.node();flow.edge(node,dayNode,0,1);
      input.slots.forEach((slot,index)=>{if(slot.businessDate===day&&member.available.some(window=>key(window)===key(slot)))references.push({member,slot,edge:flow.edge(dayNode,slotNodes[index],0,1,index)});});
    }
  }
  input.slots.forEach((slot,index)=>{
    const fixed=locked.filter(row=>key(row)===key(slot)&&row.leaveStatus!=='approved').length,target=Math.max(0,(slot.ordinaryMinimum??1)-fixed);
    shortages.push(flow.edge(source,slotNodes[index],0,target,1_000_000));flow.edge(slotNodes[index],sink,target,target);
  });
  flow.edge(sink,source,0,input.slots.length*300);
  const feasible=flow.solve();
  const assignments=[...locked,...references.filter(row=>flow.used(row.edge)).map(row=>({...row.slot,memberId:row.member.memberId}))];
  return {assignments,ruleVersion:input.ruleVersion||'office-daily-v2',algorithmVersion:'office-balanced-flow-v1',solverStatus:'feasible',inputSnapshotRef:{optimization:{complete:feasible&&!shortages.some(edge=>flow.used(edge)),reason:feasible?'office_balanced':'coverage_infeasible'}}};
}
