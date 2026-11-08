import { createWorker } from 'tesseract.js';
import {
  deviceSerialCandidatesFromText,
  labelledDeviceSerialCandidatesFromText
} from '../../../shared/warranty.js';

function serialEvidence(result) {
  const text = result.data.text.slice(0, 20000);
  const candidates = deviceSerialCandidatesFromText(text);
  const labelled = labelledDeviceSerialCandidatesFromText(text).length > 0;
  return {
    text,
    candidates,
    confidence: result.data.confidence,
    score: candidates.length ? result.data.confidence + (labelled ? 40 : 0) : -Infinity,
    labelled
  };
}

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
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
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
    const result = serialEvidence(await Promise.race([worker.recognize(canvas), canceled]));
    onProgress('正在检查镜像文字…');
    context.setTransform(-1, 0, 0, 1, canvas.width, 0);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    context.resetTransform();
    const mirrored = serialEvidence(await Promise.race([worker.recognize(canvas), canceled]));
    let enhanced;
    if (!result.labelled && !mirrored.labelled) {
      onProgress('正在增强标签文字…');
      const enhancedScale = Math.min(2, 2200 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.round(image.naturalWidth * enhancedScale);
      canvas.height = Math.round(image.naturalHeight * enhancedScale);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < pixels.data.length; index += 4) {
        const gray =
          pixels.data[index] * 0.2126 +
          pixels.data[index + 1] * 0.7152 +
          pixels.data[index + 2] * 0.0722;
        const value = gray >= 160 ? 255 : 0;
        pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = value;
      }
      context.putImageData(pixels, 0, 0);
      await Promise.race([worker.setParameters({ tessedit_pageseg_mode: '6' }), canceled]);
      enhanced = serialEvidence(await Promise.race([worker.recognize(canvas), canceled]));
    }
    const ambiguous =
      result.candidates.length &&
      mirrored.candidates.length &&
      result.candidates.join() !== mirrored.candidates.join() &&
      Math.abs(result.score - mirrored.score) < 12;
    const selected = [result, mirrored, enhanced]
      .filter(Boolean)
      .reduce((best, current) => (current.score > best.score ? current : best));
    return {
      text: ambiguous ? (result.text + '\n' + mirrored.text).slice(0, 20000) : selected.text,
      confidence: selected.confidence,
      labelled: selected.labelled
    };
  } finally {
    signal?.removeEventListener('abort', abort);
    URL.revokeObjectURL(url);
    if (worker) await worker.terminate().catch(() => {});
    else pending?.then((value) => value.terminate()).catch(() => {});
  }
}
