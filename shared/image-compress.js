import { track, reportClientError } from './telemetry-client.js';
import { inspectImage } from './image-input.js';
const MB = 1024 * 1024;
export const INTAKE_PHOTO_MAX_BYTES = 2 * MB;
const DEFAULTS = {
  maxBytes: MB,
  maxDimension: 1920,
  quality: 0.85,
  minQuality: 0.7,
  targetMinBytes: 800 * 1024,
  targetMaxBytes: MB,
};
const preparedImages = new WeakSet();

export async function uploadImage(file) {
  return preparedImages.has(file) ? file : (await compressImage(file, { strict: true })).file;
}

function namedFile(blob, name, lastModified) {
  try { return new File([blob], name, { type: blob.type, lastModified }); }
  catch {
    // Older Safari versions can read File objects but cannot construct them.
    blob.name = name;
    return blob;
  }
}

async function imageFile(file) {
  const { type } = await inspectImage(file);
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
async function compressImageOperation(file, options = {}) {
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
        preparedImages.add(result);
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
    throw new Error('照片压缩后仍过大，请重新选择或拍摄');
  } catch (error) {
    if (original.type === 'image/heic') throw new Error('当前浏览器无法处理 HEIC/HEIF 照片，请转为 JPG，或在相机设置中选择“兼容性最佳”后重新拍摄', { cause: error });
    if (!settings.strict && original.size <= maxBytes) {
      const warning = `照片压缩失败（${error.message}），将上传符合大小限制的原图`;
      report(100, '将使用原图');
      return { file: original, warning };
    }
    throw new Error(`照片压缩失败（${error.message}），请重新选择或拍摄照片`, { cause: error });
  } finally {
    if (scaled && scaled !== source) { scaled.width = 0; scaled.height = 0; }
    if (source) { source.width = 0; source.height = 0; }
  }
}

export async function compressImage(file, options = {}) {
  const started = Date.now();
  track('flow.step', { control: 'photo.compress', result: 'start' });
  try {
    const result = await compressImageOperation(file, options);
    track('flow.result', { control: 'photo.compress', result: result.warning ? 'rejected' : 'ok', durationMs: Date.now() - started });
    return result;
  } catch (error) {
    reportClientError(error, 'PHOTO_PROCESSING_ERROR', { control: 'photo.compress' });
    throw error;
  }
}
