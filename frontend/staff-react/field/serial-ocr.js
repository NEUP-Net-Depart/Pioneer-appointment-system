import { createWorker } from 'tesseract.js';

/** @param {File} file @param {{signal?: AbortSignal, onProgress?: (message: string) => void}} [options] */
export async function recognizeSerialPhoto(file, { signal, onProgress = () => {} } = {}) {
  if (!file.type.startsWith('image/') || file.size > 12 * 1024 * 1024)
    throw new Error('请选择不超过 12 MB 的设备标签照片。');
  const url = URL.createObjectURL(file);
  let worker;
  let pending;
  let abort;
  const canceled = new Promise((_, reject) => {
    abort = () => {
      worker?.terminate().catch(() => {});
      reject(new DOMException('Canceled', 'AbortError'));
    };
  });
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) throw new DOMException('Canceled', 'AbortError');
    const image = new Image();
    image.src = url;
    await Promise.race([image.decode(), canceled]);
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 40_000_000)
      throw new Error('图片过大或无法读取，请靠近标签重新拍摄。');
    const scale = Math.min(1, 2200 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const base = new URL('/vendor/ocr/', window.location.origin).href;
    pending = createWorker('eng', 1, {
      workerPath: base + 'worker.min.js',
      corePath: base + 'core',
      langPath: base + 'lang',
      workerBlobURL: false,
      cacheMethod: 'none',
      logger: (message) => {
        if (!signal?.aborted)
          onProgress(
            message.status === 'recognizing text'
              ? `正在识别文字 ${Math.round((message.progress || 0) * 100)}%`
              : '正在准备文字识别…'
          );
      }
    });
    worker = await Promise.race([pending, canceled]);
    await Promise.race([worker.setParameters({ tessedit_pageseg_mode: '11' }), canceled]);
    const result = await Promise.race([worker.recognize(canvas), canceled]);
    return { text: result.data.text.slice(0, 20000), confidence: result.data.confidence };
  } finally {
    signal?.removeEventListener('abort', abort);
    URL.revokeObjectURL(url);
    if (worker) await worker.terminate().catch(() => {});
    else pending?.then((value) => value.terminate()).catch(() => {});
  }
}
