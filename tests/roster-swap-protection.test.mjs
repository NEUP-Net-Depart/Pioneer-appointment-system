import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSwap} from '../src/modules/rosters/swap-validation.js';

const from={id:'one',memberId:'a',businessDate:'2026-10-19',campusId:'campus-nanhu',dutyType:'office',startAt:'19:00',endAt:'21:00',versionStatus:'published'};
const to={...from,id:'two',memberId:'b',businessDate:'2026-10-20'};
const facts=['a','b'].map(memberId=>({memberId,active:true,campuses:['南湖'],grants:[{roleCode:'office',scope:{campuses:'bound'}}],assignments:[memberId==='a'?from:to]}));
const project=(extra={})=>validateSwap({from,to,facts,coverage:[from,to],today:'2026-10-19',...extra});

test('swap previews allow future and unsigned current-day shifts, but protect signed or past shifts on either side',()=>{
  assert.equal(project().allowed,true);
  for(const row of [from,to]) {
    const result=project({protectedAssignments:[row]});
    assert.equal(result.allowed,false);
    assert.match(result.errors.join('；'),/已签到/);
  }
  assert.equal(project({today:'2026-10-20'}).allowed,false);
  assert.equal(project({protectedAssignments:[{...from,campusId:'campus-hunnan'}]}).allowed,true,'attendance in another campus does not rewrite the assignment fact');
});

test('office lead swaps require both participation and effective management in the destination campus',()=>{
  const lead={roleCode:'office_lead',permissionCode:'roster.office.manage',scope:{campusIds:['campus-nanhu']}};
  const officeFrom={...from,roleKind:'office_lead'};
  const managerFacts=facts.map(fact=>({...fact,campuses:['南湖','浑南'],grants:[...fact.grants,lead]}));
  assert.equal(project({from:officeFrom,facts:managerFacts}).allowed,true);
  assert.equal(project({from:officeFrom,facts:managerFacts.map(fact=>({...fact,grants:[lead]}))}).allowed,false,'management alone does not imply actual office participation');
  assert.equal(project({from:officeFrom,facts:managerFacts.map(fact=>({...fact,grants:[fact.grants[0],{...lead,scope:{campusIds:['campus-hunnan']}}]}))}).allowed,false);
});
