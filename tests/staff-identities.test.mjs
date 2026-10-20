import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAuthorizer} from '../src/modules/authorization/public.js';
import {staffIdentities,fieldPersonGroup,compareFieldPeople} from '../shared/staff-identities.js';

const authorizer=createAuthorizer();
const context={actor:{memberId:'lead',authorizedCampuses:['南湖']},businessDate:'2026-10-17',todayDuties:[],workProfiles:[],grants:[{
  permissionCode:'repair.transfer',scope:{campusIds:['campus-nanhu'],departmentIds:['hardware']},conditions:[{code:'signedDutyPresence',version:1}],validity:{effectiveTo:'2026-11-01'}
}]};
test('identity exists without a scheduled duty while commands retain campus, department and check-in requirements',()=>{
  assert.deepEqual(staffIdentities(context,authorizer),[{code:'repair_lead',label:'维修值班负责人'}]);
  const target={campusId:'campus-nanhu',departmentId:'hardware',businessDate:'2026-10-16'};
  const check=(ctx,resource)=>authorizer.evaluate(ctx.actor,'repair.transfer',resource,ctx,ctx.grants).allowed;
  assert.equal(check(context,target),false);
  const signed={...context,presence:{businessDate:'2026-10-17',campusId:'campus-nanhu',state:'available'}};
  assert.equal(check(signed,target),true,'Today’s sign-in can manage a cross-day repair');
  assert.equal(check(signed,{...target,campusId:'campus-hunnan'}),false);
  assert.equal(check(signed,{...target,departmentId:'office'}),false);
  assert.equal(check({...signed,presence:{...signed.presence,businessDate:'2026-10-16'}},target),false);
  assert.deepEqual(staffIdentities({...signed,businessDate:'2026-11-01'},authorizer),[]);
  assert.deepEqual(staffIdentities(signed,authorizer,{campusId:'campus-hunnan'}),[]);
});
test('qualifications, identities and field groups remain separate, deduplicated and stably ordered',()=>{
  const identities=staffIdentities({...context,workProfiles:[{profileCode:'exchange'},{profileCode:'exchange'},{profileCode:'repair',effectiveTo:'2026-10-17'}]},authorizer);
  assert.deepEqual(identities.map(item=>item.code),['exchange','repair_lead']);
  const people=[{memberId:'office',name:'甲',identities:[{code:'office'}],state:'available',signedInAt:'now'},
    {memberId:'repair',name:'乙',identities:[{code:'repair'}],scheduledRepair:true,state:'unsigned'},
    {memberId:'lead',name:'丙',identities:[{code:'repair_lead'}],signedInAt:'now',state:'available',canReceive:true},
    {memberId:'exchange',name:'丁',identities:[{code:'exchange'}],signedInAt:'now',state:'available',canReceive:true}];
  assert.equal(fieldPersonGroup(people[0]),'other');
  assert.equal(fieldPersonGroup(people[1]),'repair');
  assert.deepEqual(people.sort(compareFieldPeople).map(item=>item.memberId),['lead','exchange','repair','office']);
});
