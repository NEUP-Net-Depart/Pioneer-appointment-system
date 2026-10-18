export function collectionState(task, now = Date.now()) {
  if(task.collectionOpensAt&&Date.parse(task.collectionOpensAt)>now)return 'scheduled';
  return task.dutyType === 'office' && task.workflowVersion!==1 ? 'not_required' : task.collectionClosedAt || Date.parse(task.deadline) <= now ? 'closed' : 'open';
}
export function rosterStage(task, versions, now = Date.now()) {
  const published=versions.find(item=>item.status==='published');
  const draft=versions.find(item=>item.status==='draft');
  if(collectionState(task,now)==='scheduled')return 'scheduled';
  if(collectionState(task,now)==='open') return 'collecting';
  return draft ? published ? 'revising' : 'adjusting' : published ? 'published' : 'ready';
}
export const sameAssignment = (a,b) => ['memberId','businessDate','campusId','startAt','endAt','dutyType','roleKind'].every(key=>(a[key] || (key==='dutyType' ? 'repair' : ''))===(b[key] || (key==='dutyType' ? 'repair' : '')));
