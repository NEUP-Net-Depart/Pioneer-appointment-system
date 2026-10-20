import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runtimeStateErrors } from '../scripts/runtime-state-audit.mjs';

test('runtime audit rejects module caches but permits request-local indexes', () => {
  for (const source of ['const cache = new Map();', 'let cache; if (true) { cache = new Map(); }']) {
    assert.equal(runtimeStateErrors(source).length, 1);
  }
  assert.deepEqual(runtimeStateErrors('export function requestHandler() { const index = new Map(); return index; }'), []);
  assert.deepEqual(runtimeStateErrors('export const createRepository = () => { const index = new Map(); return { lookup: key => index.get(key) }; };'), []);
});

test('TypeScript runtime modules receive the same shared-state checks', () => {
  assert.equal(runtimeStateErrors('const cache: Map<string, number> = new Map();',{typescript:true}).length,1);
  assert.deepEqual(runtimeStateErrors('export function solve(value: number) { const local: Map<string, number> = new Map(); return local.set("answer",value); }',{typescript:true}),[]);
});
