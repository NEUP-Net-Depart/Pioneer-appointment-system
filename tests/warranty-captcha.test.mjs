import test from 'node:test';
import assert from 'node:assert/strict';
import { warrantyService } from '../src/services/warranty.js';
import { normalizeAcerWarranty } from '../src/services/warranty/acer.js';

// Synthetic form/response fixtures. None contains an actual manufacturer CAPTCHA answer.
const page = `<form><input type="hidden" name="__VIEWSTATE" value="mock-state&amp;value"><input type="hidden" name="__VIEWSTATEGENERATOR" value="mock-generator"><input type="hidden" name="__EVENTVALIDATION" value="mock-validation"><input type="hidden" name="ctl00$ContentPlaceHolder1$hfSheetBrand" value="acer"><input type="hidden" name="evil" value="never-forward"></form>`;
const resultHtml = `<table><tr><td>机主姓名</td><td>PRIVATE</td></tr><tr><td>标准保修期</td><td>2025-01-01 至 2027-01-01</td></tr></table>`;
const actor = { account: 'fixture-staff' };
const key = '11'.repeat(32);
function fixture({ failImage = false, responseHtml = resultHtml } = {}) {
  const calls = [];
  let now = new Date('2026-10-26T08:00:00Z');
  const service = warrantyService({ encryptionKey: key, clock: () => now, fetcher: async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('verify_code.ashx')) return new Response(failImage ? '<html>blocked</html>' : Uint8Array.of(137, 80, 78, 71), { headers: { 'Content-Type': failImage ? 'text/html' : 'image/Png', 'Set-Cookie': 'ASP.NET_SessionId=second-session; Path=/; HttpOnly' } });
    if (options.method === 'POST') return new Response(responseHtml);
    return new Response(page, { headers: { 'Set-Cookie': 'ASP.NET_SessionId=first-session; Path=/; HttpOnly' } });
  } });
  return { service, calls, advance() { now = new Date(now.getTime() + 180001); } };
}
test('Acer challenge gets a real upstream image with session binding and hides cookies/form state', async () => {
  const { service, calls } = fixture();
  const challenge = await service.challenge({ brand: 'acer', serial: 'TEST1234' }, actor);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.headers.Cookie, 'ASP.NET_SessionId=first-session');
  assert.equal(challenge.image, 'data:image/png;base64,iVBORw==');
  assert.equal(challenge.expiresAt, '2026-10-26T08:03:00.000Z');
  assert.equal(challenge.token.includes('first-session'), false);
  assert.equal(challenge.token.includes('mock-state'), false);
  assert.equal(service.providers().providers.find(p => p.id === 'acer').mode, 'captcha');
});
test('only a human supplied answer is submitted together with the original encrypted session', async () => {
  const { service, calls } = fixture();
  const challenge = await service.challenge({ brand: 'acer', serial: 'TEST1234' }, actor);
  const result = await service.query({ brand: 'acer', serial: 'TEST1234', captchaToken: challenge.token, captchaAnswer: 'HUMAN' }, actor);
  const { options, url } = calls[2];
  assert.equal(url, calls[0].url);
  assert.equal(options.redirect, 'manual');
  assert.equal(options.headers.Cookie, 'ASP.NET_SessionId=second-session');
  const body = new URLSearchParams(options.body);
  assert.equal(body.get('__VIEWSTATE'), 'mock-state&value');
  assert.equal(body.get('ctl00$ContentPlaceHolder1$txtVeriCode'), 'HUMAN');
  assert.equal(body.get('ctl00$ContentPlaceHolder1$txtSerialno'), 'TEST1234');
  assert.equal(body.has('evil'), false);
  assert.equal(result.outcome, 'found');
  assert.equal(result.status, 'unknown');
  assert.match(result.services[0].name, /2027-01-01/);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});
test('missing, tampered, mismatched or expired challenges never contact upstream', async () => {
  const { service, calls, advance } = fixture();
  const challenge = await service.challenge({ brand: 'acer', serial: 'TEST1234' }, actor);
  const input = { brand: 'acer', serial: 'TEST1234', captchaToken: challenge.token, captchaAnswer: 'HUMAN' };
  for (const [change, user] of [[{ captchaToken: '' }, actor], [{ captchaAnswer: '' }, actor], [{ captchaToken: challenge.token + 'bad' }, actor], [{ serial: 'OTHER1234' }, actor], [{}, { account: 'other-staff' }]]) await assert.rejects(service.query({ ...input, ...change }, user));
  advance();
  await assert.rejects(service.query(input, actor), error => error.code === 'WARRANTY_CAPTCHA_EXPIRED');
  assert.equal(calls.length, 2);
});
test('Acer CAPTCHA error, empty result or unknown format never becomes expired coverage', async () => {
  assert.throws(() => normalizeAcerWarranty('<p>验证码不正确</p>'), error => error.code === 'WARRANTY_CAPTCHA_INVALID');
  assert.equal(normalizeAcerWarranty('<p>未查询到该序列号的信息</p>').outcome, 'not_found');
  for (const html of ['<form>nothing</form>', '<table><tr><td>产品型号</td><td>MockBook</td></tr></table>', '<script>保修期已到期</script>']) assert.throws(() => normalizeAcerWarranty(html), error => error.code === 'WARRANTY_UPSTREAM_FORMAT');
  const { service } = fixture({ failImage: true });
  await assert.rejects(service.challenge({ brand: 'acer', serial: 'TEST1234' }, actor), error => error.code === 'WARRANTY_UPSTREAM_FORMAT');
});
