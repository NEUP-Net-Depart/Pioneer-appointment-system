import {test} from 'node:test';
import assert from 'node:assert/strict';
import {weeklyAttendanceRows} from '../src/modules/attendance/weekly-export.js';
import {createAuthorizer} from '../src/modules/authorization/public.js';

const week='2026-10-19',authorizer=createAuthorizer(),canExport=target=>target.campusId==='campus-nanhu';
const records=[0,1,2].map(i=>({id:`record-${i}`,memberId:'ordinary',businessDate:`2026-10-${19+i}`,campusId:'campus-nanhu',primaryDepartmentIdSnapshot:'hardware',primaryDepartmentNameSnapshot:'硬件部',identitySnapshot:{name:'维修甲',studentId:'20260001',identities:[{code:'repair',label:'维修工作人员'}]}}));
const lead={memberId:'lead',name:'负责人乙',studentId:'20260002',campuses:['南湖','浑南'],memberships:[{departmentId:'office',departmentName:'办公部',isPrimary:true,effectiveFrom:'2026-01-01'}],grants:[{id:'lead-office',roleCode:'office_lead',permissionCode:'roster.office.manage',scope:{campusIds:['campus-nanhu']},conditions:[],binding:{effectiveFrom:'2026-10-20',effectiveTo:'2026-10-22'}}]};
test('weekly aggregation filters before combining and keeps both accounting options independent',()=>{
  const input={week,records:[...records,{...records[0],id:'hidden',campusId:'campus-hunnan'}],facts:[lead],paused:[],authorizer,canExport};
  let rows=weeklyAttendanceRows(input);assert.equal(rows.length,1);assert.equal(rows[0].actualCount,3);assert.equal(rows[0].creditedCount,3);
  rows=weeklyAttendanceRows({...input,firstOnly:true});assert.equal(rows[0].actualCount,3);assert.equal(rows[0].creditedCount,1);
  rows=weeklyAttendanceRows({...input,leadersOnce:true});assert.equal(rows.length,2);assert.equal(rows.find(row=>row.memberId==='lead').creditedCount,1);assert.equal(rows.find(row=>row.memberId==='lead').actualCount,0);
});
test('suspended days and expired lead intervals cannot create weekly credit',()=>{
  const paused=[19,20,21,22].map(day=>({businessDate:`2026-10-${day}`,campusId:'campus-nanhu',paused:true}));
  const rows=weeklyAttendanceRows({week,records,facts:[lead],paused,authorizer,canExport,leadersOnce:true,firstOnly:true});
  assert.ok(rows.every(row=>row.creditedCount===0));assert.equal(rows.find(row=>row.memberId==='ordinary').excludedCount,3);
  assert.equal(weeklyAttendanceRows({week:'2026-10-26',records:[],facts:[lead],paused:[],authorizer,canExport,leadersOnce:true}).length,0);
});
