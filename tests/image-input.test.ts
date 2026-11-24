import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectImage, PHOTO_SOURCE_MAX_BYTES } from '../shared/image-input.ts';
import { CORRUPT_JPEG, CORRUPT_HEIC } from './fixtures/photos.ts';
const PHOTO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');

const file = (bytes: BlobPart,  type = 'image/png') => new File([bytes], 'camera', { type });
function png(width: number, height: number) {
  const bytes = Buffer.from(PHOTO);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}
function jpeg(width: number, height: number, progressive = false) {
  const bytes = Buffer.from(CORRUPT_JPEG);
  bytes[3] = progressive ? 0xc2 : 0xc0;
  bytes.writeUInt16BE(height, 7);
  bytes.writeUInt16BE(width, 9);
  return bytes;
}
function webp(kind: string, width: number, height: number) {
  const bytes = Buffer.alloc(kind === 'VP8L' ? 26 : 30);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WEBP', 8); bytes.write(kind, 12); bytes.writeUInt32LE(kind === 'VP8L' ? 5 : 10, 16);
  if (kind === 'VP8X') {
    bytes.writeUIntLE(width - 1, 24, 3); bytes.writeUIntLE(height - 1, 27, 3);
  } else if (kind === 'VP8L') {
    bytes[20] = 0x2f; bytes.writeUInt32LE(((width - 1) | ((height - 1) << 14)) >>> 0, 21);
  } else {
    bytes.write('9d012a', 23, 'hex'); bytes.writeUInt16LE(width, 26); bytes.writeUInt16LE(height, 28);
  }
  return bytes;
}

test('source limits apply before reading metadata, allow 32 MiB and reject empty files', async () => {
  await assert.rejects(inspectImage(file(new Uint8Array())), /为空/);
  const oversized = new Blob();
  Object.defineProperty(oversized, 'size', { value: PHOTO_SOURCE_MAX_BYTES + 1 });
  oversized.slice = () => assert.fail('Must reject before reading');
  await assert.rejects(inspectImage(oversized), /32 MiB/);
  const exact = new File([PHOTO, new Uint8Array(PHOTO_SOURCE_MAX_BYTES - PHOTO.length)], 'camera.png');
  assert.deepEqual(await inspectImage(exact), { type: 'image/png', width: 1, height: 1 });
});

test('JPEG, PNG, WebP and HEIC dimensions are read without decoding or trusting MIME types', async () => {
  for (const [bytes, type] of [
    [png(48, 32), 'image/png'], [jpeg(48, 32), 'image/jpeg'],
    [jpeg(48, 32, true), 'image/jpeg'], [CORRUPT_HEIC, 'image/heic'],
    ...['VP8 ', 'VP8L', 'VP8X'].map(kind => [webp(kind, 48, 32), 'image/webp'])
  ]) assert.deepEqual(await inspectImage(file(bytes, 'application/octet-stream')), { type, width: 48, height: 32 });
});

test('pixel and single-side boundaries protect small files with enormous decoded dimensions', async () => {
  for (const make of [png, jpeg, (w: number, h: number) => jpeg(w, h, true), ...['VP8 ', 'VP8L', 'VP8X'].map(kind => (w: number, h: number) => webp(kind, w, h))]) {
    assert.equal((await inspectImage(file(make(10000, 5000)))).width, 10000);
    await assert.rejects(inspectImage(file(make(10001, 5000))), /5000 万像素/);
  }
  for (const make of [png, jpeg]) await assert.rejects(inspectImage(file(make(0, 5000))), /尺寸/);
  assert.equal((await inspectImage(file(png(16384, 1)))).width, 16384);
  await assert.rejects(inspectImage(file(png(16385, 1))), /16384/);
  const heic = Buffer.from(CORRUPT_HEIC);
  heic.writeUInt32BE(10001, heic.length - 8); heic.writeUInt32BE(5000, heic.length - 4);
  await assert.rejects(inspectImage(file(heic)), /5000 万像素/);
});

test('JPEG scanning skips large metadata rather than imposing a small header cutoff', async () => {
  const app = Buffer.alloc(65537);
  app.writeUInt16BE(0xffe1, 0); app.writeUInt16BE(65535, 2);
  const bytes = jpeg(8000, 6000);
  const original = file(Buffer.concat([bytes.subarray(0, 2), ...Array(5).fill(app), bytes.subarray(2)]));
  assert.deepEqual(await inspectImage(original), { type: 'image/jpeg', width: 8000, height: 6000 });
});

test('truncated, unknown and malformed containers fail with actionable errors', async () => {
  for (const bytes of [PHOTO.subarray(0, 20), CORRUPT_JPEG.subarray(0, 8), webp('VP8X', 48, 32).subarray(0, 25), CORRUPT_HEIC.subarray(0, 30)])
    await assert.rejects(inspectImage(file(bytes)), /尺寸|HEIC/);
  await assert.rejects(inspectImage(file(Buffer.from('not a photo'))), /格式不支持/);
  await assert.rejects(inspectImage(new File(['broken'], 'camera.heic', { type: 'image/heic' })), /HEIC\/HEIF.*转为 JPG/);
});
