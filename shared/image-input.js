const MiB = 1024 * 1024;
export const PHOTO_SOURCE_MAX_BYTES = 32 * MiB;
export const PHOTO_SOURCE_MAX_PIXELS = 50_000_000;
export const PHOTO_SOURCE_MAX_DIMENSION = 16_384;
const inspected = new WeakMap();
const invalidDimensions = () => new Error('无法读取照片尺寸，文件可能损坏，请重新选择或转为 JPG');

// Read bounded chunks of metadata, never decode pixels just to check their size.
function metadataReader(file) {
  let start = 0, bytes = new Uint8Array();
  return async (offset, length) => {
    if (offset < 0 || offset + length > file.size) throw invalidDimensions();
    if (offset < start || offset + length > start + bytes.length) {
      start = offset;
      const blob = file.slice(start, start + Math.max(length, 64 * 1024));
      const buffer = typeof blob.arrayBuffer === 'function' ? await blob.arrayBuffer() : await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reader.onabort = () => reject(new Error('无法读取照片，请重新选择'));
        reader.readAsArrayBuffer(blob);
      });
      bytes = new Uint8Array(buffer);
    }
    return new DataView(bytes.buffer, bytes.byteOffset + offset - start, length);
  };
}

function text(view, offset, length) {
  return String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + offset, length));
}

function dimensions(width, height) {
  if (!width || !height) throw invalidDimensions();
  if (width * height > PHOTO_SOURCE_MAX_PIXELS || Math.max(width, height) > PHOTO_SOURCE_MAX_DIMENSION)
    throw new Error('照片分辨率过高，请选择不超过 5000 万像素、单边不超过 16384 像素的照片');
  return { width, height };
}

async function jpegDimensions(read, size) {
  let offset = 2;
  // Bound work even for malformed files containing thousands of tiny segments.
  for (let count = 0; count < 4096 && offset + 4 <= size; count++) {
    const marker = await read(offset, 4);
    if (marker.getUint8(0) !== 0xff) break;
    const code = marker.getUint8(1);
    if (code === 0xff) { offset++; continue; }
    if (code === 0xda || code === 0xd9) break;
    if (code === 0x01 || (code >= 0xd0 && code <= 0xd7)) { offset += 2; continue; }
    const length = marker.getUint16(2);
    if (length < 2 || offset + 2 + length > size) break;
    if (code >= 0xc0 && code <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(code)) {
      if (length < 8) break;
      const frame = await read(offset + 4, 5);
      return dimensions(frame.getUint16(3), frame.getUint16(1));
    }
    offset += 2 + length;
  }
  throw invalidDimensions();
}

async function webpDimensions(read, size) {
  for (let offset = 12, count = 0; count < 4096 && offset + 8 <= size; count++) {
    const chunk = await read(offset, 8), kind = text(chunk, 0, 4), length = chunk.getUint32(4, true);
    if (offset + 8 + length > size) break;
    const uint24 = (view, at) => view.getUint8(at) + (view.getUint8(at + 1) << 8) + (view.getUint8(at + 2) << 16);
    if (kind === 'VP8X' && length >= 10) {
      const frame = await read(offset + 8, 10);
      return dimensions(1 + uint24(frame, 4), 1 + uint24(frame, 7));
    }
    if (kind === 'VP8 ' && length >= 10) {
      const frame = await read(offset + 8, 10);
      if (uint24(frame, 3) !== 0x2a019d) break;
      return dimensions(frame.getUint16(6, true) & 0x3fff, frame.getUint16(8, true) & 0x3fff);
    }
    if (kind === 'VP8L' && length >= 5) {
      const frame = await read(offset + 8, 5);
      if (frame.getUint8(0) !== 0x2f) break;
      const packed = frame.getUint32(1, true);
      return dimensions(1 + (packed & 0x3fff), 1 + ((packed >>> 14) & 0x3fff));
    }
    offset += 8 + length + (length % 2);
  }
  throw invalidDimensions();
}

async function heicDimensions(read, size) {
  let remaining = 4096, largest;
  async function boxes(start, end, depth = 0) {
    if (depth > 4) throw invalidDimensions();
    for (let offset = start; offset + 8 <= end;) {
      if (--remaining < 0) throw invalidDimensions();
      const box = await read(offset, 8), kind = text(box, 4, 4);
      let length = box.getUint32(0), headerLength = 8;
      if (length === 1) {
        const extended = await read(offset + 8, 8);
        length = extended.getUint32(0) * 2 ** 32 + extended.getUint32(4);
        headerLength = 16;
      } else if (length === 0) length = end - offset;
      if (length < headerLength || offset + length > end) throw invalidDimensions();
      const body = offset + headerLength;
      if (kind === 'ispe') {
        if (length < headerLength + 12) throw invalidDimensions();
        const spatial = await read(body, 12);
        const current = dimensions(spatial.getUint32(4), spatial.getUint32(8));
        if (!largest || current.width * current.height > largest.width * largest.height) largest = current;
      } else if (['meta', 'iprp', 'ipco'].includes(kind)) {
        await boxes(body + (kind === 'meta' ? 4 : 0), offset + length, depth + 1);
      }
      offset += length;
    }
  }
  await boxes(0, size);
  if (!largest) throw invalidDimensions();
  return largest;
}

export async function inspectImage(file) {
  if (!file?.size) throw new Error('照片文件为空，请重新选择');
  if (file.size > PHOTO_SOURCE_MAX_BYTES) throw new Error('照片原文件过大，请选择不超过 32 MiB 的照片');
  if (inspected.has(file)) return inspected.get(file);
  const read = metadataReader(file), header = await read(0, Math.min(64, file.size));
  const signature = text(header, 0, header.byteLength);
  let type, size;
  if (signature.startsWith('\xff\xd8\xff')) {
    type = 'image/jpeg';
    size = await jpegDimensions(read, file.size);
  } else if (signature.startsWith('\x89PNG\r\n\x1a\n')) {
    type = 'image/png';
    const png = await read(8, 16);
    if (png.getUint32(0) !== 13 || text(png, 4, 4) !== 'IHDR') throw invalidDimensions();
    size = dimensions(png.getUint32(8), png.getUint32(12));
  } else if (signature.startsWith('RIFF') && signature.slice(8, 12) === 'WEBP') {
    type = 'image/webp';
    size = await webpDimensions(read, file.size);
  } else if (signature.slice(4, 8) === 'ftyp' && /(?:heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1)/.test(signature.slice(8))) {
    type = 'image/heic';
    try { size = await heicDimensions(read, file.size); }
    catch (error) {
      throw new Error(`HEIC/HEIF 照片处理失败（${error.message}），请转为 JPG，或在相机设置中选择“兼容性最佳”后重新拍摄`, { cause: error });
    }
  } else if (/\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/i.test(file.type)) {
    throw new Error('无法读取 HEIC/HEIF 照片，请转为 JPG，或在相机设置中选择“兼容性最佳”后重新拍摄');
  } else throw new Error('照片格式不支持，请选择 JPG、PNG 或 WebP');
  const result = { type, ...size };
  inspected.set(file, result);
  return result;
}
