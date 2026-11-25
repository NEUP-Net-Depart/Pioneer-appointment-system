import { deflateSync } from 'node:zlib';

function chunk(type: string, data: Buffer) {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length);
  chunk.write(type, 4);
  data.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return chunk;
}

// Real RGB pixels and a complete PNG stream, not a tiny image padded with junk.
// Uncompressed DEFLATE gives deterministic source sizes across browser encoders.
export function cameraPhoto(mib: number) {
  const width = 2048, height = Math.ceil(mib * 1024 * 1024 / (width * 3 + 1));
  const rows = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * (width * 3 + 1) + 1 + x * 3;
      rows[at] = (x >>> 2) & 255;
      rows[at + 1] = (y >>> 2) & 255;
      rows[at + 2] = (x ^ y) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 0 })), chunk('IEND', Buffer.alloc(0))
  ]);
}

// A header with known dimensions but no compressed pixels, for decode failures.
export const CORRUPT_JPEG = Buffer.from('ffd8ffc00011080020003003011100021100031100ffd9', 'hex');

// Dimensions are readable, so unsupported/corrupt HEIC still reaches decoding.
export const CORRUPT_HEIC = Buffer.from(
  '00000018667479706865696300000000686569636d696631' +
  '000000306d6574610000000000000024697072700000001c6970636f' +
  '0000001469737065000000000000003000000020', 'hex'
);
