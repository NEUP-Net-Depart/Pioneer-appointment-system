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

test('scan configuration always publishes the single workflow and accepts prior JWT-signed codes', async () => {
  const id = 'reserve020261013-01', primary = 'p'.repeat(64), previous = 'j'.repeat(64);
  const service = scanService({find:async()=>({id,campus:'南湖'}),expirePending:async()=>{}}, {lookup:async()=>({id})}, primary, undefined, {detail:async()=>({id})}, [previous]);
  assert.deepEqual(service.config(), {enabled:true});
  assert.equal((await service.code(id,'private')).code,scanCode(id,primary));
  const actor={role:'technician',status:'enabled',authorizedCampuses:['南湖']};
  assert.equal((await service.resolve({code:scanCode(id,previous)},actor)).id,id);
  await assert.rejects(service.resolve({code:scanCode(id,'wrong')},actor),error=>error.status===400);
});

test('scan service accepts signed QR payloads and applies the technician campus boundary', async () => {
  const id = 'reserve020261013-01'; const secret = 's'.repeat(64);
  const item = { id, revision: 0, campus: '南湖', date: '2026-10-13', timeSlot: '19:00–19:30', deviceType: '笔记本电脑', brand: '联想', deviceModel: 'ThinkPad', faultType: '蓝屏', status: 'booked', source: 'booking', assignedTo: '' };
  const appointments = { find: async value => value === id ? item : null, expirePending: async () => {} };
  const service = scanService(appointments, {}, secret, () => new Date('2026-10-12T12:00:00+08:00'), {detail:async()=>item});
  const actor = { role: 'technician', account: 'tech', status: 'enabled', authorizedCampuses: ['南湖'] };
  const result = await service.resolve({ code: scanCode(id, secret) }, actor);
  assert.equal(result.id, id);
  await assert.rejects(service.resolve({ code: scanCode(id, 't'.repeat(64)) }, actor));
  await assert.rejects(service.resolve({ code: scanCode(id, secret) }, { ...actor, authorizedCampuses: ['浑南'] }), error => error.status === 403);
});
