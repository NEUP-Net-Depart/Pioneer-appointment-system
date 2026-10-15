import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { scanCode, verifyScanCode } from '../src/lib/scan-code.js';
import { scanService } from '../src/services/scan.js';
import { appointmentService } from '../src/services/appointments.js';

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

test('appointment service accepts signed QR payloads and applies the technician campus boundary', async () => {
  const id = 'reserve020261013-01'; const secret = 's'.repeat(64);
  const item = { id, revision: 0, campus: '南湖', date: '2026-10-13', timeSlot: '19:00–19:30', deviceType: '笔记本电脑', brand: '联想', deviceModel: 'ThinkPad', faultType: '蓝屏', status: 'booked', source: 'booking', assignedTo: '' };
  const appointments = { findByCode: async value => value === id ? item : null };
  const service = appointmentService(appointments, {}, '', () => new Date('2026-10-12T12:00:00+08:00'), null, secret);
  const actor = { role: 'technician', account: 'tech', status: 'enabled', authorizedCampuses: ['南湖'] };
  const result = await service.resolveScan(scanCode(id, secret), actor);
  assert.equal(result.id, id);
  await assert.rejects(service.resolveScan(scanCode(id, 't'.repeat(64)), actor));
});
