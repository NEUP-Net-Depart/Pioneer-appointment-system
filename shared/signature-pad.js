import SignaturePad from '/vendor/signature-pad.js';
import {
  SIGNATURE_LIMITS,
  SIGNATURE_PEN_WIDTH,
  signatureDocument,
  signatureBounds
} from './signature.js';

const color = '#172a36';
const copy = (value) => (value ? JSON.parse(JSON.stringify(value)) : null);
const clamp = (value, max) => Math.max(0, Math.min(max, value));
const rounded = (value) => Math.round(value * 1000) / 1000;

function fit(source, width, height) {
  const scale = Math.min(width / source.width, height / source.height);
  return { scale, x: (width - source.width * scale) / 2, y: (height - source.height * scale) / 2 };
}

function groups(document, frame) {
  const radius = (SIGNATURE_PEN_WIDTH * frame.scale) / 2;
  return document.strokes.map((stroke) => ({
    penColor: color,
    minWidth: radius,
    maxWidth: radius,
    dotSize: radius,
    velocityFilterWeight: 0.7,
    compositeOperation: 'source-over',
    points: stroke.map(([x, y], i) => ({
      x: x * frame.scale + frame.x,
      y: y * frame.scale + frame.y,
      time: i + 1,
      pressure: 0.5
    }))
  }));
}

function sizeCanvas(canvas) {
  const width = canvas.clientWidth,
    height = canvas.clientHeight;
  if (!width || !height) return null;
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  canvas.getContext('2d').setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  return { width, height };
}

function observeSize(canvas, resize) {
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(canvas);
  window.addEventListener('resize', resize);
  return () => {
    observer?.disconnect();
    window.removeEventListener('resize', resize);
  };
}

// Both frontends use this controller. The stored model is authoritative; the
// library's CSS pixel coordinates are only the current editing projection.
/**
 * @param {HTMLCanvasElement} canvas
 * @param {{value?: object|null, onChange?: (value: object|null) => void, onError?: (message: string) => void}} options
 */
export function createSignaturePad(
  canvas,
  { value = null, onChange = () => {}, onError = () => {} } = {}
) {
  let model = copy(value),
    frame,
    size,
    active = false,
    enabled = true,
    disposed = false;
  let completedPoints = 0,
    lastSize = '';
  if (model && signatureDocument(model)?.version !== 2) throw new Error('无法编辑此签名格式');
  const pad = new SignaturePad(canvas, {
    penColor: color,
    minWidth: 1.5,
    maxWidth: 1.5,
    minDistance: 1.5,
    throttle: 0
  });

  function snapshot() {
    if (!frame || !model) return model;
    return {
      ...model,
      strokes: pad
        .toData()
        .map((group) =>
          group.points.map((point) => [
            clamp(rounded((point.x - frame.x) / frame.scale), model.width),
            clamp(rounded((point.y - frame.y) / frame.scale), model.height)
          ])
        )
    };
  }
  function bind() {
    // on() also resets an interrupted stroke and its active pointer identity.
    pad.off();
    pad.on();
    if (!enabled || disposed || !size) pad.off();
    canvas.style.touchAction = 'none';
    canvas.style.userSelect = 'none';
    canvas.style.webkitUserSelect = 'none';
  }
  function render() {
    if (!size || !model) return;
    frame = fit(model, size.width, size.height);
    pad.minWidth = pad.maxWidth = pad.dotSize = (SIGNATURE_PEN_WIDTH * frame.scale) / 2;
    pad.fromData(groups(model, frame));
    completedPoints = model.strokes.reduce((total, stroke) => total + stroke.length, 0);
  }
  function finish() {
    if (!active) return;
    model = snapshot();
    active = false;
    bind();
    render();
    onChange(copy(model));
  }
  function resize() {
    if (disposed) return;
    const nextSize = `${canvas.clientWidth}:${canvas.clientHeight}:${window.devicePixelRatio}`;
    if (lastSize === nextSize) return;
    finish();
    lastSize = nextSize;
    size = sizeCanvas(canvas);
    if (size) {
      if (!model?.strokes.length)
        model = { version: 2, width: size.width, height: size.height, strokes: [] };
      render();
    }
    bind();
  }
  function begin(event) {
    function reject() {
      event.preventDefault();
      // A cancelled beginStroke still leaves the library's pointer selected.
      // Reset after its event handler returns so the next gesture can start.
      queueMicrotask(() => {
        if (!active && !disposed) {
          bind();
          render();
        }
      });
    }
    const box = canvas.getBoundingClientRect(),
      x = event.detail.x - box.left,
      y = event.detail.y - box.top;
    if (
      !enabled ||
      !frame ||
      x < frame.x ||
      y < frame.y ||
      x > frame.x + model.width * frame.scale ||
      y > frame.y + model.height * frame.scale
    ) {
      reject();
      return;
    }
    if (
      model.strokes.length >= SIGNATURE_LIMITS.strokes ||
      completedPoints >= SIGNATURE_LIMITS.points
    ) {
      reject();
      onError('签名笔迹已达上限，请撤销一笔或清空后重写。');
      return;
    }
    active = true;
    onError('');
  }
  function constrain(event) {
    const box = canvas.getBoundingClientRect();
    event.detail.x =
      box.left + frame.x + clamp(event.detail.x - box.left - frame.x, model.width * frame.scale);
    event.detail.y =
      box.top + frame.y + clamp(event.detail.y - box.top - frame.y, model.height * frame.scale);
  }
  function limit() {
    const data = pad.toData(),
      stroke = data[data.length - 1];
    if (active && completedPoints + stroke.points.length >= SIGNATURE_LIMITS.points) {
      finish();
      onError('签名笔迹已达上限，请撤销一笔或清空后重写。');
    }
  }
  function visibility() {
    if (document.hidden) finish();
  }
  pad.addEventListener('beginStroke', begin);
  pad.addEventListener('beforeUpdateStroke', constrain);
  pad.addEventListener('afterUpdateStroke', limit);
  pad.addEventListener('endStroke', finish);
  window.addEventListener('blur', finish);
  document.addEventListener('visibilitychange', visibility);
  const unobserve = observeSize(canvas, resize);
  resize();
  return {
    value() {
      finish();
      return copy(model);
    },
    clear() {
      finish();
      model = null;
      lastSize = '';
      resize();
      onError('');
      onChange(copy(model));
    },
    undo() {
      finish();
      model?.strokes.pop();
      render();
      onError('');
      onChange(copy(model));
    },
    setEnabled(next) {
      finish();
      enabled = next;
      bind();
    },
    resize,
    dispose() {
      if (disposed) return;
      finish();
      disposed = true;
      pad.off();
      unobserve();
      window.removeEventListener('blur', finish);
      document.removeEventListener('visibilitychange', visibility);
    }
  };
}

export function createSignaturePreview(canvas, value) {
  const document = signatureDocument(value);
  if (!document || !document.strokes.length) throw new Error('历史签名格式无法展示');
  const pad = new SignaturePad(canvas);
  pad.off();
  function render() {
    const size = sizeCanvas(canvas);
    if (!size) return;
    // Trim only the preview's surrounding whitespace, never the stored model.
    const bounds = signatureBounds(document),
      padding = SIGNATURE_PEN_WIDTH * 3;
    const source = { width: bounds.width + padding * 2, height: bounds.height + padding * 2 };
    const frame = fit(source, size.width, size.height);
    frame.x += (padding - bounds.left) * frame.scale;
    frame.y += (padding - bounds.top) * frame.scale;
    pad.fromData(groups(document, frame));
  }
  const unobserve = observeSize(canvas, render);
  render();
  return {
    dispose() {
      unobserve();
      pad.off();
    }
  };
}
