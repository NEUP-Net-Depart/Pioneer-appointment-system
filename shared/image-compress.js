// 客户端图片压缩：上传前限制尺寸、按需降低质量，并修正 EXIF 方向，
// 让手机相机拍的原图也能直接上传，避免照片旋转或超过 5 MB 被拒绝。
const DEFAULTS = {
  maxBytes: 5 * 1024 * 1024,
  maxDimension: 2000,
  quality: 0.85,
  minQuality: 0.5,
};

export async function compressImage(file, options = {}) {
  const { maxBytes, maxDimension, quality, minQuality } = { ...DEFAULTS, ...options };
  if (!file || !file.type.startsWith('image/')) return file;

  const orientation = await readOrientation(file);

  // 快速路径：体积已达标且无需修正方向时原样返回，避免无损重编码造成画质损失。
  if (file.size <= maxBytes && orientation === 1) return file;

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await createImageBitmap(file); // 旧浏览器：退回不修方向
  }

  const srcW = bitmap.width;
  const srcH = bitmap.height;
  let scale = Math.min(1, maxDimension / Math.max(srcW, srcH));
  let q = quality;
  let blob;

  do {
    const width = Math.max(1, Math.round(srcW * scale));
    const height = Math.max(1, Math.round(srcH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // 透明 PNG 转 JPEG 时铺白底，避免黑背景
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    blob = await canvasToBlob(canvas, 'image/jpeg', q);
    if (blob.size <= maxBytes) break;
    if (q > minQuality) q = Math.max(minQuality, q - 0.15);
    else scale *= 0.8;
  } while (scale > 0.05);

  bitmap.close?.();

  // 压缩没有更小（例如极小的 PNG），保留原图避免画质损失。
  if (!blob || blob.size >= file.size) return file;

  const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return new File([blob], name, { type: 'image/jpeg' });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('图片压缩失败'))), type, quality);
  });
}

// 读取 JPEG 的 EXIF 方向（1–8），其他格式或无 EXIF 返回 1。
function readOrientation(file) {
  if (file.type !== 'image/jpeg') return Promise.resolve(1);
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const view = new DataView(reader.result);
        if (view.getUint16(0, false) !== 0xffd8) return resolve(1);
        let offset = 2;
        while (offset + 4 < view.byteLength) {
          if (view.getUint8(offset) !== 0xff) return resolve(1);
          const marker = view.getUint8(offset + 1);
          if (marker === 0xe1) {
            const length = view.getUint16(offset + 2, false);
            if (length >= 14 && view.getUint32(offset + 4, false) === 0x45786966) {
              const tiff = offset + 10;
              const little = view.getUint16(tiff, false) === 0x4949;
              if (view.getUint16(tiff, little) !== 0x2a) return resolve(1);
              const ifd0 = tiff + view.getUint32(tiff + 4, little);
              const count = view.getUint16(ifd0, little);
              for (let i = 0; i < count; i++) {
                const entry = ifd0 + 2 + i * 12;
                if (entry + 12 > view.byteLength) break;
                if (view.getUint16(entry, little) === 0x0112) return resolve(view.getUint16(entry + 8, little) || 1);
              }
            }
            offset += 2 + length;
          } else if (marker === 0xda) {
            return resolve(1); // 已到图像数据，不再有 EXIF
          } else {
            offset += 2 + view.getUint16(offset + 2, false);
          }
        }
        resolve(1);
      } catch { resolve(1); }
    };
    reader.onerror = () => resolve(1);
    reader.readAsArrayBuffer(file.slice(0, 128 * 1024));
  });
}
