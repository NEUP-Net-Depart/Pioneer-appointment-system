import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serviceLocationService } from '../src/services/service-locations.js';
import { encryptText } from '../src/lib/privacy.js';

test('location configuration reuses object-level identity and contact permissions without repeated context queries', async () => {
  const key='0123456789012345678901234567890101234567890123456789012345678901';
  const encrypted=await encryptText('private-contact',key);
  const rows=['visible','private'].map(id=>({id,assignedMemberId:`member-${id}`,name:'客户',studentId:'20300001',phone:encrypted,social:encrypted,email:encrypted,contactValue:encrypted,contactType:'wechat'}));
  let contexts=0,scopes=0;
  const targets=[];
  const actor={account:'settings-editor',status:'enabled',role:'technician',authorizedCampuses:['南湖']};
  const staff={field:{enabled:true},
    scopedActor:async(value,permission)=>{scopes++;assert.equal(permission,'settings.manage');return value;},
    contextFor:async(value,date)=>{contexts++;assert.equal(value,actor);assert.equal(date,'2026-10-19');return {actor:{memberId:'member-visible'}};},
    evaluate:(context,code,target)=>{targets.push(target);return {allowed:target.id==='visible' && code==='customer.contact.read' && target.assignedMemberId===context.actor.memberId};}
  };
  const service=serviceLocationService({affected:async()=>rows,changes:async()=>[]},null,null,key,undefined,staff);
  const result=await service.details('南湖','2026-10-19',actor);
  assert.equal(scopes,1);assert.equal(contexts,1);
  assert.deepEqual(result.affectedAppointments[1],{id:'private'});
  assert.equal(result.affectedAppointments[0].contactValue,'private-contact');
  assert.equal(Object.hasOwn(result.affectedAppointments[0],'name'),false);
  assert.ok(targets.every(target=>target.campusId==='南湖' && target.businessDate==='2026-10-19'));
  await assert.rejects(service.details('浑南','2026-10-19',actor),error=>error.status===403);
});

test('location read and write reject revoked configuration rights before touching stored data', async () => {
  let writes=0,reads=0;
  const staff={field:{enabled:true},scopedActor:async()=>{throw Object.assign(new Error('没有权限'),{status:403});}};
  const service=serviceLocationService({update:async()=>{writes++;},changes:async()=>{reads++;}},null,null,'',undefined,staff);
  await assert.rejects(service.details('南湖','2026-10-19',{}),error=>error.status===403);
  await assert.rejects(service.update({campus:'南湖',date:'2026-10-19',location:'新地点',revision:1},{}),error=>error.status===403);
  assert.equal(writes,0);assert.equal(reads,0);
});
