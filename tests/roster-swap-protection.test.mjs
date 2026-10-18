import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSwap} from '../src/modules/rosters/swap-validation.js';

const from={id:'one',memberId:'a',businessDate:'2026-10-19',campusId:'campus-nanhu',dutyType:'office',startAt:'19:00',endAt:'21:00',versionStatus:'published'};
const to={...from,id:'two',memberId:'b',businessDate:'2026-10-20'};
const facts=['a','b'].map(memberId=>({memberId,active:true,campuses:['南湖'],profiles:[{profileCode:'office',effectiveFrom:'2026-01-01'}],assignments:[memberId==='a'?from:to]}));
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
