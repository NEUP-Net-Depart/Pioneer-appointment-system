import { repairScenario } from './fixtures/repair-scenario.ts';
import { present } from './helpers/present.ts';
import { HttpError } from '../src/lib/http.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { scanCode, verifyScanCode } from '../src/lib/scan-code.ts';
import { scanService } from '../src/services/scan.ts';

test('fixed scan codes use a domain-separated HMAC and reject malformed or forged payloads', () => {
  const id = 'reserve020261013-01', secret = 's'.repeat(64);
  const code = scanCode(id, secret);
  assert.equal(code, id + '.' + createHmac('sha256', secret).update('pioneer:repair-qr:v1:' + id).digest('hex').slice(0,12));
  assert.equal(verifyScanCode(code, secret), id);
  assert.equal(scanCode(id, secret), code);
  for (const invalid of [id, code + '?access=private', code.replace('reserve0','reserve1'), code.slice(0,-1) + (code.endsWith('0') ? '1' : '0'), 'https://app.test/#appointment='+id+'&access=secret', {}, 'x'.repeat(10000)]) {
    assert.throws(() => verifyScanCode(invalid, secret), error => error instanceof HttpError && error.status === 400);
  }
  assert.throws(() => verifyScanCode(code, 't'.repeat(64)), error => error instanceof HttpError && error.status === 400);
});


test('scan service accepts signed QR payloads and applies the technician campus boundary', async (t) => {
  const id = 'reserve020261013-01'; const secret = 's'.repeat(64);
  const { repo, staff, service: appointments, order, users } = repairScenario(t, { time: '10:00' });
  order(id, { date: '2026-10-13', expires_at: '2026-11-06T03:00:00.000Z', device_type: '笔记本电脑', brand: '联想', device_model: 'ThinkPad', fault_type: '蓝屏' });
  const actor = present(await users.find('20260001'));
  const service = scanService(repo, appointments, secret, () => new Date('2026-10-12T12:00:00+08:00'), staff.field);
  const result = await service.resolve({ code: scanCode(id, secret) }, actor);
  assert.equal(result.id, id);
  await assert.rejects(service.resolve({ code: scanCode(id, 't'.repeat(64)) }, actor));
  await assert.rejects(service.resolve({ code: scanCode(id, secret) }, { ...actor, authorizedCampuses: ['浑南'] }), error => error instanceof HttpError && error.status === 403);
});
