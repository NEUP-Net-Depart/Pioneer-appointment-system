import { readQr, readDeviceCode } from '/shared/zxing.js';
import { deviceSerialFromCode } from '/shared/warranty.js';

async function readDeviceSerial(
  image,
  width,
  height,
  surface,
  isCurrent = () => true,
  enhance = false
) {
  const scale = Math.min(1, 960 / Math.max(width, height));
  surface.width = Math.round(width * scale);
  surface.height = Math.round(height * scale);
  const drawing = surface.getContext('2d', { willReadFrequently: true });
  let foundOtherCode = false;
  const unrecognizedCodes = new Set();
  function consume(codes) {
    foundOtherCode ||= codes.length > 0;
    const candidates = new Set();
    for (const code of codes) {
      const serial = deviceSerialFromCode(code.text);
      if (serial) candidates.add(serial);
      else unrecognizedCodes.add(code.text.slice(0, 2048));
    }
    return [...candidates];
  }
  for (const mirrored of [false, true]) {
    if (!isCurrent()) return { candidates: [], foundOtherCode, unrecognizedCodes: [] };
    drawing.setTransform(mirrored ? -1 : 1, 0, 0, 1, mirrored ? surface.width : 0, 0);
    drawing.drawImage(image, 0, 0, surface.width, surface.height);
    drawing.resetTransform();
    const codes = await readDeviceCode(drawing.getImageData(0, 0, surface.width, surface.height));
    if (!isCurrent()) return { candidates: [], foundOtherCode, unrecognizedCodes: [] };
    const candidates = consume(codes);
    if (candidates.length)
      return { candidates, foundOtherCode, unrecognizedCodes: [...unrecognizedCodes] };
  }
  if (enhance) {
    const enlarged = Math.min(2, 2000 / width, 1400 / height);
    surface.width = Math.round(width * enlarged);
    surface.height = Math.round(height * enlarged);
    drawing.imageSmoothingEnabled = false;
    for (const mirrored of [false, true]) {
      if (!isCurrent()) return { candidates: [], foundOtherCode, unrecognizedCodes: [] };
      drawing.setTransform(mirrored ? -1 : 1, 0, 0, 1, mirrored ? surface.width : 0, 0);
      drawing.drawImage(image, 0, 0, surface.width, surface.height);
      drawing.resetTransform();
      const pixels = drawing.getImageData(0, 0, surface.width, surface.height);
      for (let index = 0; index < pixels.data.length; index += 4) {
        const value =
          pixels.data[index] * 0.2126 +
            pixels.data[index + 1] * 0.7152 +
            pixels.data[index + 2] * 0.0722 >=
          160
            ? 255
            : 0;
        pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = value;
      }
      const candidates = consume(await readDeviceCode(pixels));
      if (!isCurrent()) return { candidates: [], foundOtherCode, unrecognizedCodes: [] };
      if (candidates.length)
        return { candidates, foundOtherCode, unrecognizedCodes: [...unrecognizedCodes] };
    }
  }
  return { candidates: [], foundOtherCode, unrecognizedCodes: [...unrecognizedCodes] };
}

export async function inspectDeviceImage(file, isCurrent = () => true) {
  if (!file || !file.type.startsWith('image/') || file.size > 10 * 1024 * 1024)
    throw new Error('请选择不超过 10 MB 的设备标签图片');
  const bitmap = await createImageBitmap(file);
  try {
    return await readDeviceSerial(
      bitmap,
      bitmap.width,
      bitmap.height,
      document.createElement('canvas'),
      isCurrent,
      true
    );
  } finally {
    bitmap.close();
  }
}

export async function readDeviceSerialImage(file, isCurrent = () => true) {
  const result = await inspectDeviceImage(file, isCurrent);
  if (!isCurrent()) return [];
  if (result.candidates.length) return result.candidates;
  throw new Error('图片中未找到设备序列号条码，请切换 OCR 识别文字。');
}

export function createScanner({
  video,
  status = null,
  torch,
  switchCamera,
  mirrorCamera = null,
  mode = 'qr',
  onCode,
  onCandidates,
  onUnrecognized,
  onImage,
  onState = (state) => {
    void state;
  },
  canStart = () => true
}) {
  const codeLabel = mode === 'device' ? '设备序列号' : '二维码';
  let stream,
    timer,
    generation = 0,
    facing = 'environment',
    cameras = [],
    deviceId,
    lit = false,
    mirrorOverride = null,
    singleCamera = false,
    switching = false,
    deviceFrame = 0,
    disposed = false;
  let lastUnrecognized = '';
  const canvas = document.createElement('canvas'),
    context = canvas.getContext('2d', { willReadFrequently: true });
  function setPreviewMirror(value) {
    video.dataset.mirrored = String(value);
    mirrorCamera?.setAttribute('aria-pressed', String(value));
  }
  function stop() {
    generation++;
    clearTimeout(timer);
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
    video.srcObject = null;
    setPreviewMirror(false);
    lit = false;
    torch.disabled = true;
    torch.setAttribute('aria-pressed', 'false');
    switchCamera.disabled = true;
    onState('idle');
  }
  async function start() {
    if (disposed || !canStart()) return false;
    stop();
    const current = generation;
    onState('opening');
    if (status) status.textContent = '正在开启摄像头…';
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器无法使用摄像头');
      const videoOptions = deviceId
        ? { deviceId: { exact: deviceId } }
        : { facingMode: { exact: facing }, width: { ideal: 1280 } };
      let media;
      try {
        media = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoOptions });
      } catch (error) {
        if (current !== generation) return false;
        if (deviceId || !['OverconstrainedError', 'NotFoundError'].includes(error.name))
          throw error;
        // Phones should choose the rear lens; single-camera devices may not expose facing modes.
        media = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { ...videoOptions, facingMode: { ideal: facing } }
        });
      }
      if (current !== generation || disposed || !canStart()) {
        media.getTracks().forEach((track) => track.stop());
        return false;
      }
      stream = media;
      video.srcObject = stream;
      await video.play();
      if (current !== generation) return false;
      const track = stream.getVideoTracks()[0];
      const front = (track.getSettings?.().facingMode || facing) === 'user';
      setPreviewMirror(mirrorOverride ?? front);
      torch.disabled = !track.getCapabilities?.().torch;
      cameras = ((await navigator.mediaDevices.enumerateDevices?.().catch(() => [])) || []).filter(
        (device) => device.kind === 'videoinput' && device.deviceId
      );
      if (current !== generation) return false;
      deviceId = track.getSettings?.().deviceId;
      if (cameras.length > 1) singleCamera = false;
      switchCamera.disabled = cameras.length === 1 || singleCamera;
      switchCamera.title = switchCamera.disabled ? '仅检测到一个可用镜头' : '切换摄像头';
      onState('running');
      if (status)
        status.textContent =
          mode === 'qr'
            ? `将${codeLabel}对准扫描框`
            : mode === 'device'
              ? '正在自动识别设备条码…'
              : '正在自动识别文字，也可以拍摄。';
      if (mode === 'photo') return true;
      async function frame() {
        if (current !== generation) return;
        try {
          if (video.readyState >= 2 && video.videoWidth) {
            let code;
            if (mode === 'device')
              code = await readDeviceSerial(
                video,
                video.videoWidth,
                video.videoHeight,
                canvas,
                () => current === generation,
                deviceFrame++ % 8 === 0
              );
            else {
              const scale = Math.min(1, 960 / video.videoWidth);
              canvas.width = Math.round(video.videoWidth * scale);
              canvas.height = Math.round(video.videoHeight * scale);
              context.drawImage(video, 0, 0, canvas.width, canvas.height);
              code = (await readQr(context.getImageData(0, 0, canvas.width, canvas.height)))[0]
                ?.text;
            }
            if (current !== generation) return;
            if (mode === 'device' && code?.foundOtherCode && !code.candidates.length) {
              if (status) status.textContent = '已扫到二维码，结果见下方。';
              const signature = code.unrecognizedCodes.join('\n');
              if (signature && signature !== lastUnrecognized) {
                lastUnrecognized = signature;
                onUnrecognized?.(code.unrecognizedCodes);
              }
            }
            if (mode === 'device' && code?.candidates.length > 1) {
              stop();
              await onCandidates?.(code.candidates);
              return;
            }
            const resolvedCode = mode === 'device' ? code?.candidates[0] : code;
            if (resolvedCode) {
              stop();
              await onCode?.(resolvedCode);
              return;
            }
          }
          timer = setTimeout(frame, 220);
        } catch {
          if (current === generation) {
            stop();
            onState('error');
            if (status) status.textContent = '条码识别中断，请重新开启摄像头或使用相册扫码。';
          }
        }
      }
      frame();
      return true;
    } catch {
      if (current !== generation) return false;
      stop();
      onState('error');
      if (status)
        status.textContent = `摄像头未能开启。若已阻止权限，请在浏览器的网站设置中允许摄像头，或使用相册和${mode === 'device' ? '手动输入序列号' : '编号查询'}。`;
      return false;
    }
  }
  async function toggleTorch() {
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !lit }] });
      lit = !lit;
      torch.setAttribute('aria-pressed', String(lit));
    } catch {
      /* Some cameras expose torch controls that cannot be applied. */
    }
  }
  async function switchLens() {
    if (!stream || disposed || !canStart() || switching) return;
    if (cameras.length === 1 || singleCamera) return;
    switching = true;
    switchCamera.disabled = true;
    const previousDeviceId = deviceId;
    const previousFacing = facing;
    const previousActualFacing = stream.getVideoTracks()[0]?.getSettings?.().facingMode;
    if (cameras.length > 1)
      deviceId =
        cameras[(cameras.findIndex((device) => device.deviceId === deviceId) + 1) % cameras.length]
          .deviceId;
    else {
      deviceId = undefined;
      facing = facing === 'environment' ? 'user' : 'environment';
    }
    try {
      const opened = await start();
      if (!opened) {
        deviceId = previousDeviceId;
        facing = previousFacing;
        if (!disposed && (await start())) {
          if (status) status.textContent = '切换失败，已恢复原镜头。';
        }
        return;
      }
      const currentFacing = stream?.getVideoTracks()[0]?.getSettings?.().facingMode;
      if (
        cameras.length === 0 &&
        ((previousDeviceId && deviceId === previousDeviceId) ||
          (previousActualFacing && currentFacing === previousActualFacing))
      ) {
        singleCamera = true;
        if (status) status.textContent = '当前只有一个可用摄像头。';
      }
    } finally {
      switching = false;
      switchCamera.disabled = disposed || !stream || cameras.length === 1 || singleCamera;
      switchCamera.title = switchCamera.disabled ? '仅检测到一个可用镜头' : '切换摄像头';
    }
  }
  function toggleMirror() {
    mirrorOverride = video.dataset.mirrored !== 'true';
    setPreviewMirror(mirrorOverride);
  }
  torch.addEventListener('click', toggleTorch);
  switchCamera.addEventListener('click', switchLens);
  mirrorCamera?.addEventListener('click', toggleMirror);
  return {
    start,
    stop,
    async snapshot() {
      if (mode !== 'photo' || !stream || video.readyState < 2 || !video.videoWidth)
        throw new Error('摄像头尚未准备好，请稍后重试。');
      const previewWidth = video.clientWidth || video.videoWidth;
      const previewHeight = video.clientHeight || video.videoHeight;
      const cover = Math.max(previewWidth / video.videoWidth, previewHeight / video.videoHeight);
      const visibleWidth = previewWidth / cover;
      const visibleHeight = previewHeight / cover;
      const sourceWidth = visibleWidth * 0.7;
      const sourceHeight = visibleHeight * 0.7;
      const sourceX = (video.videoWidth - sourceWidth) / 2;
      const sourceY = (video.videoHeight - sourceHeight) / 2;
      const scale = Math.min(1, 2200 / Math.max(sourceWidth, sourceHeight));
      const photo = document.createElement('canvas');
      photo.width = Math.max(1, Math.round(sourceWidth * scale));
      photo.height = Math.max(1, Math.round(sourceHeight * scale));
      photo
        .getContext('2d')
        .drawImage(
          video,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          photo.width,
          photo.height
        );
      const current = generation;
      const blob = await new Promise((resolve) => photo.toBlob(resolve, 'image/png'));
      if (current !== generation) return;
      if (!blob) throw new Error('照片生成失败，请重拍。');
      return new File([blob], 'serial-label.png', { type: 'image/png' });
    },
    async capture() {
      const file = await this.snapshot();
      if (!file) return;
      stop();
      if (status) status.textContent = '照片已拍摄，正在识别序列号…';
      await onImage?.(file);
    },
    dispose() {
      disposed = true;
      stop();
      torch.removeEventListener('click', toggleTorch);
      switchCamera.removeEventListener('click', switchLens);
      mirrorCamera?.removeEventListener('click', toggleMirror);
    },
    async image(file, keepCamera = false) {
      if (!keepCamera) stop();
      const current = generation;
      if (
        !file ||
        !file.type.startsWith('image/') ||
        file.size > (mode === 'photo' ? 12 : 10) * 1024 * 1024
      )
        throw new Error(
          `请选择不超过 ${mode === 'photo' ? 12 : 10} MB 的${mode === 'photo' ? '设备标签照片' : codeLabel + '图片'}`
        );
      if (mode === 'device') {
        const candidates = await readDeviceSerialImage(file, () => current === generation);
        if (current !== generation) return;
        if (candidates.length === 1) {
          await onCode?.(candidates[0]);
          return;
        }
        if (candidates.length > 1) await onCandidates?.(candidates);
        return;
      }
      if (mode === 'photo') {
        await onImage?.(file);
        return;
      }
      const codes = await readQr(file);
      if (current !== generation) return;
      if (!codes[0]?.text) throw new Error(`图片中未找到${codeLabel}，请重试或手动输入编号`);
      await onCode(codes[0].text);
    }
  };
}
