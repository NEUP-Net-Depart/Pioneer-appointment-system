import test from 'node:test';
import assert from 'node:assert/strict';
import { WARRANTY_BRANDS, warrantyBrandId, normalizeDeviceSerial, isDeviceSerial, deviceSerialFromCode } from '../shared/warranty.js';

test('all requested brands have fixed HTTPS official entries', () => {
  const hosts = ['www.asus.com.cn','www.acer.com.cn','consumerservice.lenovo.com.cn','support.hp.com','www.dell.com','account.msi.com','checkcoverage.apple.com','www.mi.com','consumer.huawei.com','www.mechrevo.com'];
  assert.equal(WARRANTY_BRANDS.length, 10);
  assert.equal(new Set(WARRANTY_BRANDS.map(brand => brand.id)).size, 10);
  assert.deepEqual(WARRANTY_BRANDS.map(brand => new URL(brand.url).hostname), hosts);
  for (const brand of WARRANTY_BRANDS) assert.equal(new URL(brand.url).protocol, 'https:');
});
test('work-order brand aliases preselect the correct official provider', () => {
  for (const [input, id] of [['联想 ThinkPad','lenovo'],['ASUS ROG','asus'],['惠普','hp'],['HP OMEN','hp'],['苹果 MacBook Air','apple'],['Xiaomi Book','xiaomi'],['华为 MateBook','huawei'],['机械革命','mechrevo']]) assert.equal(warrantyBrandId(input), id);
  assert.equal(warrantyBrandId('机械师'), '');
  assert.equal(warrantyBrandId('未填写'), '');
  assert.equal(warrantyBrandId('ShopComputer'), '');
});
test('serial normalization preserves O/0, I/1 and original separators', () => {
  assert.equal(normalizeDeviceSerial(' S/N: ｔｅｓｔＯ０Ｉ１-2345 '), 'TESTO0I1-2345');
  assert.ok(isDeviceSerial('ABCDEFGHJK'));
  assert.ok(isDeviceSerial('ABC123/456'));
  for (const serial of ['123','AA-BB-CC-DD-EE-FF','AA:BB:CC:DD:EE:FF','reserve020261015-12','<script>','A'.repeat(41)]) assert.equal(isDeviceSerial(serial), false);
});
test('camera or album codes require one explicit serial, with no remote navigation', () => {
  assert.equal(deviceSerialFromCode('SN: TEST0O1I2345'), 'TEST0O1I2345');
  assert.equal(deviceSerialFromCode('https://example.invalid/label?SerialNumber=TEST1234'), 'TEST1234');
  assert.equal(deviceSerialFromCode('https://qs.asus.com/T8NRKD00T364355'), 'T8NRKD00T364355');
  assert.equal(deviceSerialFromCode('http://qr.i-tongfang.com:8080/default.aspx?qr=424090A32499430244'), '424090A32499430244');
  for (const code of ['http://not-i-tongfang.com:8080/default.aspx?qr=424090A32499430244', 'http://qr.i-tongfang.com/default.aspx?qr=424090A32499430244', 'http://qr.i-tongfang.com:8080/other.aspx?qr=424090A32499430244', 'http://qr.i-tongfang.com:8080/default.aspx?qr=424090A32499430244&qr=OTHER1234', 'http://qr.i-tongfang.com:8080/default.aspx?qr=424090A32499430244&token=secret', 'http://qr.i-tongfang.com:8080/default.aspx?qr=BAD']) assert.equal(deviceSerialFromCode(code), null);
  for (const code of ['http://qs.asus.com/T8NRKD00T364355', 'https://qs.asus.com/T8NRKD00T364355?token=secret', 'https://qs.asus.com/repair/T8NRKD00T364355', 'https://not-asus.example/T8NRKD00T364355']) assert.equal(deviceSerialFromCode(code), null);
  assert.equal(deviceSerialFromCode('{"SN":"TEST1234","PN":"OTHER1234"}'), 'TEST1234');
  assert.equal(deviceSerialFromCode('{"SN":"TEST1234","serial":"OTHER1234"}'), null);
  assert.equal(deviceSerialFromCode('https://example.invalid/?sn=TEST1234&sn=OTHER1234'), null);
  for (const raw of ['https://example.invalid/', 'javascript:alert(1)', 'pioneer:attendance:v1:SECRET', 'reserve020261015-12.abcd12345678', 'https://example.invalid/#private-token', 'https://example.invalid/repair?sn=TEST1234', '{bad json', 'X'.repeat(2049)]) assert.equal(deviceSerialFromCode(raw), null);
});

test('OCR prefers explicit serial labels, keeps ambiguous characters and offers multiple candidates', async () => {
  const { deviceSerialCandidatesFromText: candidates, labelledDeviceSerialCandidatesFromText: labelled } = await import('../shared/warranty.js');
  assert.deepEqual(candidates('Model: ABC12345678\nS/N: TEST0O1I2345\nP/N: XYZ12345678'), ['TEST0O1I2345']);
  assert.deepEqual(candidates('型号: FA401UM260-0ECGXHB8X10\n序号: T8NRKD00T364355'), ['T8NRKD00T364355']);
  assert.deepEqual(candidates('型号: FA401UM260-0ECGXHB8X10\n序 列 号：T8NRKD00T364355'), ['T8NRKD00T364355']);
  assert.deepEqual(labelled('型号: FA401UM260-0ECGXHB8X10'), []);
  assert.deepEqual(labelled('序号:\n型号: FA401UM260-0ECGXHB8X10'), []);
  assert.deepEqual(candidates('SN: TEST12345678\nSN: OTHER1234567'), ['TEST12345678', 'OTHER1234567']);
  assert.deepEqual(candidates('ABC23456789'), ['ABC23456789']);
  assert.deepEqual(candidates('reserve020261015-47\nAA:BB:CC:DD:EE:FF\nhttps://evil.invalid/?sn=TEST1234'), []);
  assert.deepEqual(candidates('ASUS LAPTOP\nMODEL ABC\n19V'), []);
});

test('official deep links carry serials only for verified manufacturer parameters', async () => {
  const { warrantyOfficialDestination: destination } = await import('../shared/warranty.js');
  assert.deepEqual(destination('asus', 'SN: TEST12345678'), { url: 'https://www.asus.com.cn/support/warranty-status-inquiry/?sn=TEST12345678', prefilled: true });
  assert.deepEqual(destination('lenovo', 'TEST12345678'), { url: 'https://consumerservice.lenovo.com.cn/deviceGuarantee.html?selname=TEST12345678', prefilled: true });
  assert.equal(destination('asus', 'ABC123/456').prefilled, false); // ASUS script reads the raw parameter without URL decoding.
  assert.equal(destination('msi', 'TEST12345678').prefilled, false);
  assert.equal(new URL(destination('msi', 'TEST12345678').url).search, '');
  assert.equal(destination('asus', 'TEST&ATTACK=1'), null);
  assert.equal(destination('unknown', 'TEST12345678'), null);
});

test('all brands describe a real consumer workflow and app channels do not pose as web warranty forms', async () => {
  const { warrantyConsumerChannel: channel } = await import('../shared/warranty.js');
  for (const brand of WARRANTY_BRANDS) {
    assert.ok(channel(brand.id).title);
    assert.ok(channel(brand.id).steps.length >= 2);
  }
  assert.equal(channel('hp').kind, 'web');
  assert.equal(channel('dell').kind, 'web');
  assert.match(WARRANTY_BRANDS.find(brand => brand.id === 'dell').url, /\/support\/home\/zh-cn$/);
  assert.equal(channel('xiaomi').kind, 'account');
  assert.equal(WARRANTY_BRANDS.find(brand => brand.id === 'xiaomi').url, 'https://www.mi.com/service/aftersale/front');
  assert.equal(channel('mechrevo').kind, 'miniapp');
  assert.match(channel('mechrevo').steps.join(' '), /网页本身不是 SN 查询表/);
  for (const unknown of ['__proto__', 'constructor', 'not-a-brand']) assert.equal(channel(unknown), null);
});
