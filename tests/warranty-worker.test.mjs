import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

test('actual Worker runtime queries the manufacturer and refuses upstream redirects', async () => {
  const { outputFiles } = await build({ stdin: { contents: `import { warrantyService } from './src/services/warranty.js';
    export default { async fetch(request) { try { return Response.json(await warrantyService().query(await request.json())); }
      catch (error) { return Response.json({ code: error.code }, { status: error.status || 500 }); } } };`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  let redirect = false;
  let calls = 0;
  const mf = new Miniflare({ telemetry: { enabled: false }, workers: [{ config: { name: 'warranty-test', compatibilityDate: '2026-10-01', manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: outputFiles[0].text } } } }, dev: { outboundService: { type: 'fetcher', handler: async request => {
    calls++;
    assert.equal(request.url, 'https://consumerservice.lenovo.com.cn/api/drive/TEST1234/drivewarrantyinfo');
    if (redirect) return new Response(null, { status: 302, headers: { Location: 'https://attacker.invalid/' } });
    return Response.json({ statusCode: '200', data: { detailinfo: { warranty: [{ ServiceProductName: '基础保修（模拟）', ServiceProductSmallClass: '基础服务', PartStartDate: '2020-01-01', PartEndDate: '2099-01-01' }], onsite: [], other: [] } } });
  } } } }] });
  const query = () => mf.dispatchFetch('http://localhost/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brand: 'lenovo', serial: 'TEST1234' }) });
  try {
    const first = await query();
    assert.equal(first.status, 200);
    const result = await first.json();
    assert.equal(result.outcome, 'found');
    assert.equal(result.status, 'in_warranty');
    redirect = true;
    const second = await query();
    assert.equal(second.status, 502);
    assert.equal((await second.json()).code, 'WARRANTY_UPSTREAM');
    assert.equal(calls, 2);
  } finally { await mf.dispose(); }
});

test('actual Worker preserves Acer session cookies through human CAPTCHA and posts only that answer', async () => {
  const { outputFiles } = await build({ stdin: { contents: `import { warrantyService } from './src/services/warranty.js';
    export default { async fetch(request) { const input=await request.json(); const service=warrantyService({encryptionKey:'${'11'.repeat(32)}'}); const actor={account:'fixture-staff'};
      try { return Response.json(await (input.action==='challenge'?service.challenge(input,actor):service.query(input,actor))); }
      catch(error) { return Response.json({code:error.code}, {status:error.status||500}); } } };`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  const page = `<input type="hidden" name="__VIEWSTATE" value="mock"><input type="hidden" name="__EVENTVALIDATION" value="mock"><input type="hidden" name="ctl00$ContentPlaceHolder1$hfSheetBrand" value="acer">`;
  let submissions = 0;
  const mf = new Miniflare({telemetry:{enabled:false}, workers:[{config:{name:'warranty-captcha-test',compatibilityDate:'2026-10-01',manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:outputFiles[0].text}}}},dev:{outboundService:{type:'fetcher',handler:async request=>{
    assert.equal(new URL(request.url).hostname,'support.acer.com.cn');
    if(request.url.endsWith('verify_code.ashx')) {
      assert.equal(request.headers.get('Cookie'),'ASP.NET_SessionId=mock-session');
      return new Response(Uint8Array.of(137,80,78,71),{headers:{'Content-Type':'image/Png'}});
    }
    if(request.method==='POST') {
      submissions++;
      assert.equal(request.headers.get('Cookie'),'ASP.NET_SessionId=mock-session');
      assert.equal(new URLSearchParams(await request.text()).get('ctl00$ContentPlaceHolder1$txtVeriCode'),'HUMAN');
      return new Response('<table><tr><td>标准保修期</td><td>2025-01-01 至 2027-01-01</td></tr></table>');
    }
    return new Response(page,{headers:{'Set-Cookie':'ASP.NET_SessionId=mock-session; Path=/; HttpOnly'}});
  }}}}]});
  const query=body=>mf.dispatchFetch('http://localhost/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try {
    const challengeResponse=await query({action:'challenge',brand:'acer',serial:'TEST1234'});
    assert.equal(challengeResponse.status,200);
    const challenge=await challengeResponse.json();
    assert.equal(submissions,0);
    const result=await query({brand:'acer',serial:'TEST1234',captchaToken:challenge.token,captchaAnswer:'HUMAN'});
    assert.equal(result.status,200);
    assert.equal((await result.json()).outcome,'found');
    assert.equal(submissions,1);
  } finally {await mf.dispose();}
});
