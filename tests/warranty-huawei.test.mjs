import test from 'node:test';
import assert from 'node:assert/strict';
import { warrantyService } from '../src/services/warranty.js';
import { captchaBridgeOrigin, normalizeHuaweiWarranty } from '../src/services/warranty/huawei.js';

const key = '22'.repeat(32), actor = { account: 'fixture-staff' };
function fixture({ type = 2 } = {}) {
  const calls = [];
  let now = new Date('2026-10-26T10:00:00Z');
  const service = warrantyService({ encryptionKey: key, captchaOrigin: 'https://verification.example.org', clock: () => now, fetcher: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/csrfToken/1')) return Response.json({ resultCode: 0, data: 'mock-csrf-token' }, { headers: { 'Set-Cookie': 'HWSTORE-SESSION=mock-session; Domain=.huawei.com; Path=/; Secure' } });
    assert.match(options.headers.Cookie, /HWSTORE-SESSION=mock-session/);
    if (url.endsWith('/query')) return Response.json({ resultCode: 0, data: { type, lang: 'zh-CN' } });
    if (url.endsWith('/register')) return Response.json({ resultCode: 0, data: { challenge: 'mock-challenge', hcg: 'mock-hcg', hct: 'mock-hct' } });
    if (url.endsWith('/picture')) return Response.json({ resultCode: 0, data: { picture: 'iVBORw==', sessionId: 'mock-image-session' } });
    return Response.json({ responseCode: '200', responseData: { device: { displayName: 'Mock MateBook', owner: 'PRIVATE' }, deviceRight: [{ privilegeFlag: '1', displayName: '原厂权益', privilegeInfoList: [{ displayName: '有限保修（模拟）', serviceCatCode: 'BS03', startDate: '2025-01-01', endDate: '2027-01-01', owner: 'PRIVATE' }] }, { privilegeFlag: '0', privilegeInfoList: [{ displayName: '未领取的促销权益' }] }] } });
  } });
  return { service, calls, expire() { now = new Date(now.getTime() + 180001); } };
}
test('Huawei issues the actual configured challenge type with an encrypted staff-bound session', async () => {
  const { service, calls } = fixture();
  const challenge = await service.challenge({ brand: 'huawei', serial: 'TEST12345678' }, actor);
  assert.equal(challenge.widget.type, 2);
  assert.equal(challenge.widget.origin, 'https://verification.example.org');
  assert.equal(challenge.image, undefined);
  assert.equal(calls.some(call => call.url.endsWith('/picture')), false);
  assert.equal(challenge.token.includes('mock-csrf-token'), false);
  assert.equal(JSON.stringify(challenge.widget).includes('TEST12345678'), false);
  assert.equal(JSON.stringify(challenge.widget).includes('mock-session'), false);
});
test('Huawei submits a human proof for the server-selected type and never downgrades sliders to image answers', async () => {
  const { service, calls } = fixture();
  const challenge = await service.challenge({ brand: 'huawei', serial: 'TEST12345678' }, actor);
  const input = { brand: 'huawei', serial: 'TEST12345678', captchaToken: challenge.token };
  await assert.rejects(service.query({ ...input, captchaAnswer: 'HUMAN', type: 0 }, actor), error => error.code === 'WARRANTY_CAPTCHA_REQUIRED');
  assert.equal(calls.length, 3);
  const result = await service.query({ ...input, captchaProof: 'mock-human-sdk-proof', challenge: 'attacker-challenge' }, actor);
  const sent = JSON.parse(calls[3].options.body);
  assert.equal(sent.type, 2);
  assert.equal(sent.validate, 'mock-human-sdk-proof');
  assert.equal(sent.challenge, 'mock-challenge');
  assert.equal(sent.channelCode, 'WEBSITE');
  assert.equal(sent.siteCode, 'zh_CN');
  assert.equal(result.status, 'unknown');
  assert.equal(result.services.length, 1);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});
test('Huawei image CAPTCHA is requested only when the manufacturer selects image verification', async () => {
  const { service, calls } = fixture({ type: 0 });
  const challenge = await service.challenge({ brand: 'huawei', serial: 'TEST12345678' }, actor);
  assert.equal(challenge.widget, undefined);
  assert.equal(challenge.image, 'data:image/png;base64,iVBORw==');
  await service.query({ brand: 'huawei', serial: 'TEST12345678', captchaToken: challenge.token, captchaAnswer: 'HUMAN' }, actor);
  const sent = JSON.parse(calls[3].options.body);
  assert.equal(sent.sessionId, 'mock-image-session');
  assert.equal(sent.verifyCode, 'HUMAN');
  assert.equal(sent.type, 0);
});
test('Huawei rejects tampered, expired and mismatched sessions before contacting upstream', async () => {
  const { service, calls, expire } = fixture();
  const challenge = await service.challenge({ brand: 'huawei', serial: 'TEST12345678' }, actor);
  const input = { brand: 'huawei', serial: 'TEST12345678', captchaToken: challenge.token, captchaProof: 'mock-human-proof' };
  for (const [change, who] of [[{ serial: 'OTHER1234567' }, actor], [{ captchaToken: challenge.token + 'bad' }, actor], [{}, { account: 'other-staff' }]]) await assert.rejects(service.query({ ...input, ...change }, who));
  expire();
  await assert.rejects(service.query(input, actor), error => error.code === 'WARRANTY_CAPTCHA_EXPIRED');
  assert.equal(calls.length, 3);
});
test('Huawei unknown and failed verification results do not become expired coverage', () => {
  assert.throws(() => normalizeHuaweiWarranty({ responseCode: '501' }), error => error.code === 'WARRANTY_CAPTCHA_INVALID');
  assert.throws(() => normalizeHuaweiWarranty({ responseCode: '200', responseData: { device: {} } }), error => error.code === 'WARRANTY_UPSTREAM_FORMAT');
  assert.equal(normalizeHuaweiWarranty({ responseCode: '5000', responseDesc: '序列号不存在' }).outcome, 'not_found');
  for (const value of ['https://example.org/path', 'javascript:alert(1)', 'http://example.org', 'https://user:pass@example.org', 'https://example.org/?token=abc']) assert.equal(captchaBridgeOrigin(value), '');
  assert.equal(captchaBridgeOrigin('https://verification.example.org'), 'https://verification.example.org');
});
