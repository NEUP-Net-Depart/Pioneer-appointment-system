import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAttachment } from '../src/lib/attachment-input.js';

const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const url = 'https://app.test/api/appointments/example/attachments';
function binary(body = png, headers = {}) {
  return new Request(url, { method: 'POST', body, duplex: 'half', headers: {
    'Content-Type': 'image/png', 'X-Attachment-Filename': encodeURIComponent('设备正面.png'),
    'X-Attachment-Purpose': 'intake_front', ...headers
  } });
}

test('binary and legacy JSON uploads produce identical validated bytes and Unicode names', async () => {
  const old = new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: '设备正面.png', mimeType: 'image/png', purpose: 'intake_front', data: png.toString('base64') }) });
  const actual = await readAttachment(binary());
  assert.deepEqual(actual, await readAttachment(old));
  assert.deepEqual(actual.bytes, png);
});

test('binary uploads reject spoofed types, invalid metadata and empty bodies', async () => {
  for (const request of [
    binary(Buffer.from('not an image')),
    binary(png, { 'Content-Type': 'image/jpeg' }),
    binary(png, { 'X-Attachment-Filename': '%broken' }),
    binary(png, { 'X-Attachment-Filename': '' }),
    binary(png, { 'X-Attachment-Purpose': 'invalid' }),
    binary(new Uint8Array())
  ]) await assert.rejects(readAttachment(request), { status: 400 });
});

test('binary photo limits count actual streamed bytes even without an honest Content-Length', async () => {
  const oversized = Buffer.alloc(2 * 1024 * 1024 + 1);
  for (const headers of [{}, { 'Content-Length': '1' }, { 'Content-Length': String(oversized.length) }])
    await assert.rejects(readAttachment(binary(oversized, headers)), { status: 413 });
  let cancelled = false;
  const chunks = [png, new Uint8Array(2 * 1024 * 1024), new Uint8Array(1)];
  const stream = new ReadableStream({
    pull(controller) { const chunk = chunks.shift(); if (chunk) controller.enqueue(chunk); else controller.close(); },
    cancel() { cancelled = true; }
  });
  await assert.rejects(readAttachment(binary(stream)), { status: 413 });
  assert.equal(cancelled, true);
});
