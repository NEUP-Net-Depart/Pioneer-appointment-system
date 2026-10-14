import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCapacityGrid, gridRange, rangeContains, pasteRange, repeatGridValue } from '../shared/capacity-grid.js';

test('capacity clipboard accepts Excel TSV, CRLF, zero and safe integer values',() => {
  assert.deepEqual(parseCapacityGrid(' 0\t007\r\n3\t9007199254740991\r\n'),[['0','7'],['3','9007199254740991']]);
  for (const invalid of ['', '1\t', '1\n\n2', '-1', '1.5', '=1+2', '1e3', '9007199254740992', '1\t2\n3', '1\t2\t3\t4\t5', '1\n2\n3\n4\n5', '0'.repeat(4097)]) {
    assert.throws(() => parseCapacityGrid(invalid));
  }
});

test('paste uses active cell as origin and tiles exact multiples without clipping',() => {
  const single = { top:1,bottom:1,left:1,right:1 }, grid = [['1','2'],['3','4']];
  assert.deepEqual(pasteRange(grid,single),{ top:1,bottom:2,left:1,right:2 });
  const all = { top:0,bottom:3,left:0,right:3 };
  assert.deepEqual(pasteRange(grid,all),all);
  assert.throws(() => pasteRange(grid,{ top:3,bottom:3,left:3,right:3 }));
  assert.throws(() => pasteRange(grid,{ top:0,bottom:2,left:0,right:1 }));
});

test('fill repeats source blocks in every direction without number extrapolation',() => {
  const source = gridRange({ row:2,col:2 },{ row:1,col:1 }), grid = [['7','8'],['9','10']];
  assert.deepEqual(source,{ top:1,bottom:2,left:1,right:2 });
  assert.equal(repeatGridValue(grid,source,3,3),'7');
  assert.equal(repeatGridValue(grid,source,0,0),'10');
  assert.equal(repeatGridValue(grid,source,1,0),'8');
  assert.equal(rangeContains(source,2,2),true);
  assert.equal(rangeContains(source,0,2),false);
});
