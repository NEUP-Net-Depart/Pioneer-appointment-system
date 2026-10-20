import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dutyEnd,fullDutyWindows} from '../shared/duty-window.js';
test('a complete duty lasts two hours and never wraps across midnight',()=>{
  assert.equal(dutyEnd('19:00'),'21:00');assert.equal(dutyEnd('21:59'),'23:59');
  assert.equal(dutyEnd('22:00'),'');assert.equal(dutyEnd('bad'),'');
});
test('old partial availability needs confirmation; full historical coverage can be displayed as a whole duty',()=>{
  const task={slotStart:'19:00',slotEnd:'21:00'};
  assert.deepEqual(fullDutyWindows([{id:'partial',startAt:'19:30',endAt:'21:00'},{id:'full',startAt:'18:00',endAt:'22:00'}],task),[{id:'full',startAt:'19:00',endAt:'21:00'}]);
});
