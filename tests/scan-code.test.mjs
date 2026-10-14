import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { scanCode, verifyScanCode } from '../src/lib/scan-code.js';
import { scanService } from '../src/services/scan.js';

test('fixed scan codes use a domain-separated HMAC and reject malformed or forged payloads', () => {
  const id = 'reserve020261013-01', secret = 's'.repeat(64);
  const code = scanCode(id, secret);
  assert.equal(code, id + '.' + createHmac('sha256', secret).update('pioneer:repair-qr:v1:' + id).digest('hex').slice(0,12));
  assert.equal(verifyScanCode(code, secret), id);
  assert.equal(scanCode(id, secret), code);
  for (const invalid of [id, code + '?access=private', code.replace('reserve0','reserve1'), code.slice(0,-1) + (code.endsWith('0') ? '1' : '0'), 'https://app.test/#appointment='+id+'&access=secret', {}, 'x'.repeat(10000)]) {
    assert.throws(() => verifyScanCode(invalid, secret), error => error.status === 400);
  }
  assert.throws(() => verifyScanCode(code, 't'.repeat(64)), error => error.status === 400);
});

test('the feature switch disables all scan routes without accessing the old workflow', async () => {
  const service = scanService(null, null, '', '', false);
  assert.deepEqual(service.config(), { enabled: false });
  for (const task of [() => service.resolve({}, {}), () => service.current({}), () => service.onsite({}, {}), () => service.code('', '')]) {
    await assert.rejects(task, error => error.status === 404);
  }
});
