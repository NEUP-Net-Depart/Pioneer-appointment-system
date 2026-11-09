import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForSmoke } from '../scripts/smoke.mjs';

test('deployment verification waits for propagation and reruns the complete verifier', async () => {
  let attempts = 0;
  const pauses = [];
  const result = await waitForSmoke('https://deployment.example', {
    verify: async (base) => {
      assert.equal(base, 'https://deployment.example');
      if (++attempts < 3) throw new Error('CSS asset: HTTP 404');
      return { assets: 9 };
    },
    pause: async (duration) => pauses.push(duration)
  });
  assert.deepEqual(result, { assets: 9 });
  assert.equal(attempts, 3);
  assert.deepEqual(pauses, [5000, 5000]);
});

test('a persistently broken deployment still fails after the bounded verification attempts', async () => {
  let attempts = 0;
  let pauses = 0;
  const failure = new Error('Deployed React entry does not match this build');
  await assert.rejects(waitForSmoke('https://deployment.example', {
    attempts: 3,
    verify: async () => { attempts++; throw failure; },
    pause: async () => { pauses++; }
  }), (error) => error === failure);
  assert.equal(attempts, 3);
  assert.equal(pauses, 2);
});
