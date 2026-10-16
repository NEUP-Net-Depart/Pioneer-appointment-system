import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAuthorizer} from '../src/modules/authorization/public.js';
import {rosterTaskManaged,rosterMemberInScope,rosterMemberReadable} from '../src/modules/rosters/scope.js';

const authorizer = createAuthorizer();
const context = grants => ({actor:{memberId:'manager',authorizedCampuses:['南湖','浑南']},businessDate:'2026-10-16',grants,todayDuties:[]});
const task = (campusIds,departmentIds) => ({id:'task',dutyType:'repair',campusScope:{campusIds,...(departmentIds ? {departmentIds} : {})}});
const grant = (campusId,departmentId) => ({permissionCode:'roster.repair.manage',scope:{campusIds:[campusId],departmentIds:[departmentId]}});

test('a roster task requires each real campus and department pair without stitching unrelated grants', () => {
  const ctx = context([grant('campus-nanhu','hardware'),grant('campus-hunnan','office')]);
  assert.equal(rosterTaskManaged(ctx,authorizer,task(['campus-nanhu'],['hardware'])),true);
  assert.equal(rosterTaskManaged(ctx,authorizer,task(['campus-hunnan'],['office'])),true);
  for (const value of [task(['campus-nanhu'],['office']),task(['campus-hunnan'],['hardware']),task(['campus-nanhu','campus-hunnan'],['hardware','office']),task(['campus-nanhu'])]) assert.equal(rosterTaskManaged(ctx,authorizer,value),false);
  ctx.grants.push(grant('campus-nanhu','office'));
  assert.equal(rosterTaskManaged(ctx,authorizer,task(['campus-nanhu'],['hardware','office'])),true);
});

test('current grant validity and duty conditions cannot be supplied by a future roster week', () => {
  const ctx = context([{...grant('campus-nanhu','hardware'),validity:{effectiveFrom:'2026-11-01'}}]);
  assert.equal(rosterTaskManaged(ctx,authorizer,{...task(['campus-nanhu'],['hardware']),weekStart:'2026-11-02'}),false);
  ctx.grants[0].validity = {};
  ctx.grants[0].conditions = [{code:'activeDutyRole',version:1,parameters:{kind:'repair_lead'}}];
  ctx.todayDuties = [{campusId:'campus-nanhu',businessDate:'2026-11-02',roleKind:'repair_lead'}];
  assert.equal(rosterTaskManaged(ctx,authorizer,task(['campus-nanhu'],['hardware'])),false);
});

test('roster membership uses the actual shift date, including secondary roles and exclusive transfer boundaries', () => {
  const fact = {memberId:'person',campuses:['南湖'],memberships:[
    {departmentId:'hardware',effectiveFrom:'2026-01-01',effectiveTo:'2026-11-04'},
    {departmentId:'office',effectiveFrom:'2026-11-04',effectiveTo:null}
  ]};
  assert.equal(rosterMemberInScope(fact,task(['campus-nanhu'],['hardware']),'2026-11-03','campus-nanhu'),true);
  assert.equal(rosterMemberInScope(fact,task(['campus-nanhu'],['hardware']),'2026-11-04','campus-nanhu'),false);
  assert.equal(rosterMemberInScope(fact,task(['campus-nanhu'],['office']),'2026-11-04','campus-nanhu'),true);
  assert.equal(rosterMemberInScope(fact,task(['campus-hunnan'],['office']),'2026-11-04','campus-hunnan'),false);
  fact.memberships.push({departmentId:'hardware',effectiveFrom:'2026-11-04',assignmentType:'secondary'});
  assert.equal(rosterMemberInScope(fact,task(['campus-nanhu'],['hardware']),'2026-11-04','campus-nanhu'),true);
});

test('a personal roster grant authorizes the actual member, campus and department, without granting management', () => {
  const ctx = context([{permissionCode:'roster.read',scope:{self:true,campusIds:['campus-nanhu'],departmentIds:['hardware']}}]);
  const fact = {memberId:'manager',campuses:['南湖','浑南'],memberships:[{departmentId:'hardware',effectiveFrom:'2026-01-01'}]};
  const value = task(['campus-nanhu','campus-hunnan'],['hardware']);
  assert.equal(rosterMemberReadable(ctx,authorizer,fact,value,'2026-11-02','campus-nanhu'),true);
  assert.equal(rosterMemberReadable(ctx,authorizer,fact,value,'2026-11-02','campus-hunnan'),false);
  assert.equal(rosterMemberReadable(ctx,authorizer,{...fact,memberId:'other'},value,'2026-11-02','campus-nanhu'),false);
  assert.equal(rosterTaskManaged(ctx,authorizer,value),false);
});
