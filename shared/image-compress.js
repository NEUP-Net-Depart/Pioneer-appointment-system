const MB = 1024 * 1024;
export const INTAKE_PHOTO_MAX_BYTES = 2 * MB;
const DEFAULTS = {
  maxBytes: INTAKE_PHOTO_MAX_BYTES,
  maxDimension: 2560,
  quality: 0.85,
  minQuality: 0.7,
  targetMinBytes: MB,
  targetMaxBytes: 1.5 * MB,
};

function namedFile(blob, name, lastModified) {
  try { return new File([blob], name, { type: blob.type, lastModified }); }
  catch {
    // Older Safari versions can read File objects but cannot construct them.
    blob.name = name;
    return blob;
  }
}

function readHeader(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = reader.onabort = () => reject(new Error('无法读取照片，请重新选择'));
    reader.readAsArrayBuffer(file.slice(0, 64));
  });
}

async function imageFile(file) {
  if (!file || !file.size) throw new Error('请选择有效的照片');
  const header = await readHeader(file);
  const text = String.fromCharCode(...header);
  let type;
  if (header[0] === 255 && header[1] === 216 && header[2] === 255) type = 'image/jpeg';
  else if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header[index] === byte)) type = 'image/png';
  else if (text.slice(0, 4) === 'RIFF' && text.slice(8, 12) === 'WEBP') type = 'image/webp';
  else if (text.slice(4, 8) === 'ftyp' && /(?:heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1)/.test(text.slice(8))) type = 'image/heic';
  else if (/\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/i.test(file.type)) {
    throw new Error('无法读取 HEIC/HEIF 照片，请转为 JPG，或在相机设置中选择“兼容性最佳”后重新拍摄');
  } else throw new Error('照片格式不支持，请选择 JPG、PNG 或 WebP');
  return file.type === type ? file : namedFile(new Blob([file], { type }), file.name, file.lastModified);
}

function loadCanvas(file, maxDimension) {
  return new Promise((resolve, reject) => {
    if (typeof window.loadImage !== 'function') { reject(new Error('图片处理组件加载失败')); return; }
    const loading = window.loadImage(file, (image, data) => {
      if (!image || image.type === 'error' || typeof image.getContext !== 'function' || !image.width || !image.height) {
        reject(new Error('图片解码失败，照片可能损坏或浏览器不支持此格式'));
      } else resolve({ canvas: image, data });
    }, {
      canvas: true, orientation: true, meta: true,
      maxWidth: maxDimension, maxHeight: maxDimension,
      imageSmoothingQuality: 'high',
    });
    if (!loading) reject(new Error('浏览器不支持图片读取'));
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    const complete = blob => blob?.size && blob.type === 'image/jpeg'
      ? resolve(blob) : reject(new Error('JPEG 编码失败'));
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob(complete, 'image/jpeg', quality);
      return;
    }
    // Use a data URL only when the browser has no native toBlob API.
    const url = canvas.toDataURL('image/jpeg', quality);
    if (!url.startsWith('data:image/jpeg;base64,')) throw new Error('浏览器不支持 JPEG 编码');
    const binary = atob(url.split(',')[1]);
    complete(new Blob([Uint8Array.from(binary, char => char.charCodeAt(0))], { type: 'image/jpeg' }));
  });
}

// Direction, decoding and scaling belong to blueimp-load-image. Only its
// already oriented canvas is re-used, so EXIF is never applied a second time.
export async function compressImage(file, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  const { maxBytes, maxDimension, minQuality, targetMinBytes, targetMaxBytes } = settings;
  const report = (value, label) => options.onProgress?.({ value, label });
  report(5, '正在读取照片');
  const original = await imageFile(file);
  let source, scaled;
  try {
    report(20, '正在解码并校正方向');
    const loaded = await loadCanvas(original, maxDimension);
    source = loaded.canvas;
    const context = source.getContext('2d');
    if (!context) throw new Error('浏览器不支持图片画布');
    context.globalCompositeOperation = 'destination-over';
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, source.width, source.height);
    context.globalCompositeOperation = 'source-over';
    let quality = settings.quality, dimension = Math.max(source.width, source.height), blob;
    scaled = source;
    for (let attempt = 0; attempt < 32; attempt++) {
      report(40 + Math.min(attempt * 2, 55), `正在压缩照片（第 ${attempt + 1} 次）`);
      blob = await canvasToBlob(scaled, quality);
      if (blob.size <= maxBytes) {
        // The size target is soft. Try one small quality adjustment, and keep
        // the clearer version if that would undershoot or still miss it.
        if (blob.size > targetMaxBytes && quality > minQuality) {
          report(96, '正在优化照片大小');
          const candidate = await canvasToBlob(scaled, Math.max(minQuality, Number((quality - 0.05).toFixed(2))));
          if (candidate.size >= targetMinBytes && candidate.size <= targetMaxBytes) blob = candidate;
        }
        const orientation = loaded.data?.exif?.get('Orientation') || 1;
        const originalDimension = Math.max(loaded.data?.originalWidth || source.width, loaded.data?.originalHeight || source.height);
        const keepOriginal = original.type !== 'image/heic' && original.size <= maxBytes
          && originalDimension <= maxDimension && orientation === 1 && original.size <= blob.size;
        const result = keepOriginal ? original : namedFile(blob, (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg', file.lastModified);
        report(100, '照片已准备好');
        return { file: result, warning: '' };
      }
      if (quality > minQuality) quality = Math.max(minQuality, Number((quality - 0.05).toFixed(2)));
      else {
        dimension = Math.max(1, Math.floor(dimension * 0.9));
        if (scaled !== source) { scaled.width = 0; scaled.height = 0; }
        scaled = window.loadImage.scale(source, { canvas: true, maxWidth: dimension, maxHeight: dimension, imageSmoothingQuality: 'high' });
        quality = settings.quality;
      }
    }
    throw new Error('照片压缩后仍超过 2 MB');
  } catch (error) {
    if (original.type === 'image/heic') throw new Error('当前浏览器无法处理 HEIC/HEIF 照片，请转为 JPG，或在相机设置中选择“兼容性最佳”后重新拍摄', { cause: error });
    if (original.size <= maxBytes) {
      const warning = `照片压缩失败（${error.message}），原图不超过 2 MB，将上传原图`;
      report(100, '将使用原图');
      return { file: original, warning };
    }
    throw new Error(`照片压缩失败（${error.message}），原图超过 2 MB，请重新选择或拍摄照片`, { cause: error });
  } finally {
    if (scaled && scaled !== source) { scaled.width = 0; scaled.height = 0; }
    if (source) { source.width = 0; source.height = 0; }
  }
}
