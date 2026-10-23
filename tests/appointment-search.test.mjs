import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAppointmentSearch, APPOINTMENT_SEARCH_LIMIT } from '../shared/appointment-search.js';
import { fieldWorkflow } from '../src/services/field-workflow.js';
import { createAuthorizer } from '../src/modules/authorization/public.js';
import { statusLabels } from '../shared/constants.js';
import {receptionStatus} from '../shared/reception.js';

test('reception stages preserve the five appointment statuses after rescheduling and completion',()=>{
  assert.equal(receptionStatus({status:'booked',reception:{state:'queued'}}),'queued');
  assert.equal(receptionStatus({status:'booked',reception:{state:'assigned'}}),'assigned');
  assert.equal(receptionStatus({status:'booked',reception:{state:'closed'}}),'booked');
  assert.equal(receptionStatus({status:'completed',reception:{state:'closed'}}),'completed');
});

test('shared search parser distinguishes tail fragments from cross-date numbers', () => {
  for (const value of ['', '-01', '10--01', 'test01', '01%', '1'.repeat(81), null]) assert.equal(parseAppointmentSearch(value), null);
  assert.equal(parseAppointmentSearch('0').ready, false);
  assert.deepEqual(parseAppointmentSearch('01'), {text:'01', acrossDates:false, ready:true});
  for (const value of ['1015-01', 'reserve1015-01', ' REVERSE1015-01 ']) assert.deepEqual(parseAppointmentSearch(value), {text:'1015-01', acrossDates:true, ready:true});
  assert.equal(parseAppointmentSearch('1015-').ready, true);
  assert.ok(APPOINTMENT_SEARCH_LIMIT > 0);
});

test('candidate projection and detail authorization share campus and ownership decisions for every role and status',async()=>{
 for(const role of ['technician','admin','superadmin'])for(const status of Object.keys(statusLabels))for(const assignedMemberId of ['','member-one','member-other']){
  const actor={memberId:'member-one',account:'100001',role,status:'enabled',authorizedCampuses:['南湖']};
  const context={actor,businessDate:'2026-10-15',permissions:{'repair.summary.read':true},workProfiles:[],grants:[{permissionCode:'repair.summary.read',scope:{campusIds:['campus-nanhu']}},{permissionCode:'customer.identity.read',scope:{self:true},conditions:[{code:'ownResource',version:1}]},{permissionCode:'customer.contact.read',scope:{self:true},conditions:[{code:'ownResource',version:1}]}]};
  let item={id:'reserve020261015-01',status,campus:'南湖',name:'本人客户',studentId:'20306001',assignedMemberId,assignedTo:assignedMemberId==='member-one'?'100001':'100002'};
  const field=fieldWorkflow({appointments:{find:async()=>item,currentRepair:async()=>null,pendingDispatch:async()=>null},repository:{fieldContexts:async()=>new Map(),repairIdentitySnapshot:async()=>null,latestIntake:async()=>null,dutyEvent:async()=>null,serviceDay:async()=>null},staff:{contextFor:async()=>context},authorizer:createAuthorizer(),secret:'test-secret',encryptionKey:''});
  const visible=(await field.projectList(actor,[item]))[0],detail=await field.detail(actor,item.id);assert.equal(detail.name,visible.name);assert.equal(visible.name,assignedMemberId==='member-one'?'本人客户':undefined);
  item={...item,campus:'浑南'};assert.deepEqual(await field.projectList(actor,[item]),[]);await assert.rejects(field.detail(actor,item.id),e=>e.status===403);
 }
});
