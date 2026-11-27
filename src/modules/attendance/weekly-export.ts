import type { WeeklyAttendanceRow } from '../../../shared/attendance-types.ts';
import type { AttendanceIdentitySnapshot } from '../../../shared/staff-types.ts';
import type { PolicyResource } from '../authorization/types.ts';
import type { AttendanceFact, ServicePause } from './fact-context.ts';
import { dutyCampusName } from '../../../shared/duty.ts';

interface AttendanceExportRecord {
  id: string;
  businessDate: string;
  campusId: string | null;
  memberId: string;
  memberName: string;
  studentId?: string | null;
  identitySnapshot?: AttendanceIdentitySnapshot;
  primaryDepartmentIdSnapshot?: string | null;
  primaryDepartmentNameSnapshot?: string | null;
}

interface WeeklyExportInput {
  week: string;
  records: readonly AttendanceExportRecord[];
  facts: readonly AttendanceFact[];
  paused: readonly ServicePause[];
  homeCampuses: ReadonlyMap<string, string | null>;
  canExport(target: PolicyResource): boolean;
  firstOnly?: boolean;
  leadersOnce?: boolean;
}

interface WeeklyExportRow {
  weekStart: string;
  memberId: string;
  name: string;
  studentId: string;
  departments: Set<string>;
  identities: Set<string>;
  campuses: Set<string | null>;
  actualCount: number;
  excludedCount: number;
  leaderCredit: boolean;
  leaderSeen: boolean;
}

import {addDays,serviceDay} from '../../../shared/time.ts';
import {staffIdentities} from '../../../shared/staff-identities.ts';
import {attendanceFactContext, volunteerCampus, volunteerLeaderOn} from './fact-context.ts';

// Authorization and suspension are applied to each fact before combining campuses.
// A weekly credit is a report calculation, never an attendance or presence write.
export function weeklyAttendanceRows({week,records,facts,paused,homeCampuses,canExport,firstOnly=false,leadersOnce=false}: WeeklyExportInput): WeeklyAttendanceRow[] {
  const rows = new Map<string, WeeklyExportRow>();
  const suspended=(day: string,campus: string | null)=>paused.some(item=>item.paused&&item.businessDate===day&&item.campusId===campus);
  const ensure=(memberId: string,name: string,studentId: string)=>{
    let row = rows.get(memberId);
    if (!row) {
      row = {weekStart:week,memberId,name,studentId,departments:new Set(),identities:new Set(),campuses:new Set(),actualCount:0,excludedCount:0,leaderCredit:false,leaderSeen:false};
      rows.set(memberId, row);
    }
    return row;
  };
  for(const record of records){
    const campusId = volunteerCampus(homeCampuses.get(record.memberId), record.campusId);
    if(!canExport({memberId:record.memberId,campusId,departmentId:record.primaryDepartmentIdSnapshot,id:record.id}))continue;
    const row=ensure(record.memberId,record.identitySnapshot?.name||record.memberName,record.identitySnapshot?.studentId||record.studentId||'');
    row.departments.add(record.primaryDepartmentNameSnapshot||'历史部门未记录');row.campuses.add(dutyCampusName(campusId)||campusId);
    for(const identity of record.identitySnapshot?.identities||[])row.identities.add(identity.label);
    if(suspended(record.businessDate,record.campusId))row.excludedCount++;else row.actualCount++;
  }
  if(leadersOnce)for(const fact of facts){
    const campusId = volunteerCampus(homeCampuses.get(fact.memberId));
    if (!campusId) continue;
    for(let offset=0;offset<4;offset++){
      const day=addDays(week,offset);if(!serviceDay(day))continue;
      const department = volunteerLeaderOn(fact, day, campusId);
      if (!department || !canExport({memberId:fact.memberId,campusId,departmentId:department.departmentId})) continue;
      const row=ensure(fact.memberId,fact.name,fact.studentId||'');
      row.leaderSeen = true;
      row.departments.add(department.departmentName||'未记录部门');row.campuses.add(dutyCampusName(campusId)||campusId);
      for (const identity of staffIdentities(attendanceFactContext(fact, day))) row.identities.add(identity.label);
      if(!suspended(day,campusId))row.leaderCredit=true;
    }
  }
  return [...rows.values()].map(row=>({...row,departments:[...row.departments].join('、'),identities:[...row.identities].join('、'),campuses:[...row.campuses].join('、'),
    creditedCount:row.leaderCredit?1:firstOnly?Math.min(1,row.actualCount):row.actualCount,
    basis:row.leaderCredit?'负责人有效任职周计一次（不依据签到）':row.leaderSeen&&!row.actualCount?'整周暂停或无有效服务日，计零':firstOnly?'仅计本周首次有效签到':'本周全部有效签到'})).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')||a.memberId.localeCompare(b.memberId));
}
