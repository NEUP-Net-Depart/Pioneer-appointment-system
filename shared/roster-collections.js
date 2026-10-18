import {dateKey,weekRange} from './time.js';

// A recurring collection has one identity. Weekly task rows are period snapshots,
// retained so later cycles never rewrite availability, approvals or published work.
export function preferredRosterPeriod(periods,today=dateKey()) {
  const week=weekRange(today).start;
  const ascending=[...periods].sort((a,b)=>a.weekStart.localeCompare(b.weekStart));
  return ascending.find(item=>item.collectionState==='open'&&item.weekStart>=week)
    || ascending.find(item=>item.weekStart>=week) || ascending.at(-1);
}

export function rosterCollections(items) {
  const groups=new Map();
  for(const period of items) {
    const id=period.seriesId||period.id;
    if(!groups.has(id))groups.set(id,{id,recurring:!!period.seriesId,dutyType:period.dutyType,name:period.collectionName||`${period.dutyType==='office'?'办公':'维修'}可用时间收集 · ${period.scopeLabel||''}`,periods:[]});
    groups.get(id).periods.push(period);
  }
  return [...groups.values()].map(group=>({...group,periods:group.periods.sort((a,b)=>b.weekStart.localeCompare(a.weekStart)),currentPeriodId:preferredRosterPeriod(group.periods)?.id}));
}
