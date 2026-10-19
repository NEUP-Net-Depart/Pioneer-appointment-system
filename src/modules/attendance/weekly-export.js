import {addDays,serviceDay} from '../../../shared/time.js';
import {staffIdentities} from '../../../shared/staff-identities.js';
import {rosterFactContext} from '../rosters/qualification.js';

// Authorization and suspension are applied to each fact before combining campuses.
// A weekly credit is a report calculation, never an attendance or presence write.
export function weeklyAttendanceRows({week,records,facts,paused,authorizer,canExport,firstOnly=false,leadersOnce=false}) {
  const names={'campus-nanhu':'南湖','campus-hunnan':'浑南'},rows=new Map();
  const suspended=(day,campus)=>paused.some(item=>item.paused&&item.businessDate===day&&item.campusId===campus);
  const ensure=(memberId,name,studentId)=>{
    if(!rows.has(memberId))rows.set(memberId,{weekStart:week,memberId,name,studentId,departments:new Set(),identities:new Set(),campuses:new Set(),actualCount:0,excludedCount:0,leaderCredit:false,leaderSeen:false});
    return rows.get(memberId);
  };
  for(const record of records){
    if(!canExport({memberId:record.memberId,campusId:record.campusId,departmentId:record.primaryDepartmentIdSnapshot,id:record.id}))continue;
    const row=ensure(record.memberId,record.identitySnapshot?.name||record.memberName,record.identitySnapshot?.studentId||record.studentId||'');
    row.departments.add(record.primaryDepartmentNameSnapshot||'历史部门未记录');row.campuses.add(names[record.campusId]||record.campusId);
    for(const identity of record.identitySnapshot?.identities||[])row.identities.add(identity.label);
    if(suspended(record.businessDate,record.campusId))row.excludedCount++;else row.actualCount++;
  }
  if(leadersOnce)for(const fact of facts){
    for(let offset=0;offset<4;offset++){
      const day=addDays(week,offset);if(!serviceDay(day))continue;
      const context=rosterFactContext(fact,day),departments=context.memberships.filter(item=>item.isPrimary);
      for(const campus of fact.campuses||[]){
        const campusId={'南湖':'campus-nanhu','浑南':'campus-hunnan'}[campus]||campus;
        for(const department of departments.length?departments:[{}]){
          const target={memberId:fact.memberId,campusId,departmentId:department.departmentId};
          if(!canExport(target))continue;
          const identities=staffIdentities(context,authorizer,target);
          if(!identities.some(item=>['repair_lead','office_lead'].includes(item.code)))continue;
          const row=ensure(fact.memberId,fact.name,fact.studentId||'');row.leaderSeen=true;
          row.departments.add(department.departmentName||'未记录部门');row.campuses.add(names[campusId]||campusId);
          identities.forEach(item=>row.identities.add(item.label));
          if(!suspended(day,campusId))row.leaderCredit=true;
        }
      }
    }
  }
  return [...rows.values()].map(row=>({...row,departments:[...row.departments].join('、'),identities:[...row.identities].join('、'),campuses:[...row.campuses].join('、'),
    creditedCount:leadersOnce&&row.leaderSeen?Number(row.leaderCredit):firstOnly?Math.min(1,row.actualCount):row.actualCount,
    basis:leadersOnce&&row.leaderSeen?row.leaderCredit?'负责人有效任职周计一次（不依据签到）':'整周暂停或无有效服务日，计零':firstOnly?'仅计本周首次有效签到':'本周全部有效签到'})).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')||a.memberId.localeCompare(b.memberId));
}
