import { track as trackEvent, reportClientError } from '../../../shared/telemetry-client.js';
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

const STREAM_RELEASE_SETTLE_MS = 60;
const RECENT_RELEASE_WINDOW_MS = 1500;
const RECENT_RELEASE_RETRY_DELAYS_MS = [100, 220];
const COLD_START_RETRY_DELAYS_MS = [150];
const TRANSIENT_CAMERA_ERRORS = new Set(['NotReadableError', 'AbortError', 'TrackStartError']);
const PERMANENT_CONSTRAINT_ERRORS = new Set(['OverconstrainedError', 'NotFoundError']);
const FRONT_LABEL_PATTERN =
  /\b(front|user|selfie|facetime|truedepth)\b|前置|前摄|前镜头|前(?:主摄|超?广角)|自拍|原深感/i;
const BACK_LABEL_PATTERN =
  /\b(back|rear|environment|world)\b|后置|后摄|后镜头|后(?:主摄|超?广角|长焦|微距)/i;
const AUX_LABEL_PATTERN =
  /\b(depth|macro|tele|telephoto|ultrawide|ultra[- ]?wide|aux|auxiliary|bokeh|mono|tof)\b|景深|微距|超广角|长焦|虚化|黑白|辅摄/i;

let lastStreamReleaseAt = -Infinity;

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function normalizeFacing(value) {
  return value === 'user' || value === 'environment' ? value : null;
}

function isLiedExactFacing({
  previousActualFacing,
  previousActualDeviceId,
  nextActualFacing,
  nextActualDeviceId
}) {
  return Boolean(
    (previousActualFacing &&
      nextActualFacing &&
      nextActualFacing === previousActualFacing &&
      (!nextActualDeviceId || nextActualDeviceId === previousActualDeviceId)) ||
      (previousActualDeviceId &&
        nextActualDeviceId &&
        nextActualDeviceId === previousActualDeviceId &&
        (!nextActualFacing || nextActualFacing === previousActualFacing))
  );
}

function inferFacingFromLabel(label) {
  if (!label) return null;
  if (FRONT_LABEL_PATTERN.test(label)) return 'user';
  if (BACK_LABEL_PATTERN.test(label)) return 'environment';
  return null;
}

function cameraOrderKey(device, index) {
  const auxPenalty = AUX_LABEL_PATTERN.test(device.label || '') ? 1 : 0;
  const match = /\bcamera2?\s+(\d+)\b/i.exec(device.label || '');
  const numbered = match ? Number(match[1]) : index;
  return auxPenalty * 1000 + numbered * 10 + index;
}

function isMobileCameraEnvironment() {
  return Boolean(
    navigator.userAgentData?.mobile ||
      /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(navigator.userAgent || '') ||
      window.matchMedia?.('(pointer: coarse)')?.matches
  );
}

function detachAndStopStream(media, videoElement = null) {
  if (videoElement) {
    try {
      videoElement.pause?.();
    } catch {
      /* Detached or stubbed media elements may not support pause. */
    }
    if (videoElement.srcObject) videoElement.srcObject = null;
  }
  const tracks = media?.getTracks?.() || [];
  let stoppedAny = false;
  for (const track of tracks) {
    if (track.readyState !== 'ended') stoppedAny = true;
    track.stop();
  }
  if (stoppedAny) lastStreamReleaseAt = nowMs();
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

function createScannerOperation({
  video,
  guide = null,
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
    cancelWait = null,
    generation = 0,
    facing = 'environment',
    cameras = [],
    rawVideoInputCount = 0,
    multiFacingCapable = false,
    deviceId,
    lit = false,
    mirrorOverride = null,
    singleCamera = false,
    switching = false,
    deviceFrame = 0,
    disposed = false;
  let lastUnrecognized = '';
  const knownFacingByDeviceId = new Map();
  const unavailableDeviceIds = new Set();
  const canvas = document.createElement('canvas'),
    context = canvas.getContext('2d', { willReadFrequently: true });
  function setPreviewMirror(value) {
    video.dataset.mirrored = String(value);
    mirrorCamera?.setAttribute('aria-pressed', String(value));
  }
  function canSwitchCamera() {
    if (disposed || !stream || singleCamera) return false;
    if (cameras.length > 1 || rawVideoInputCount > 1 || multiFacingCapable) return true;
    if (rawVideoInputCount === 0) return true;
    return isMobileCameraEnvironment();
  }
  function syncSwitchCameraControl() {
    switchCamera.disabled = !canSwitchCamera();
    switchCamera.title = switchCamera.disabled ? '仅检测到一个可用镜头' : '切换摄像头';
  }
  function stop() {
    generation++;
    clearTimeout(timer);
    cancelWait?.();
    cancelWait = null;
    detachAndStopStream(stream, video);
    stream = undefined;
    switching = false;
    setPreviewMirror(false);
    lit = false;
    torch.disabled = true;
    torch.setAttribute('aria-pressed', 'false');
    switchCamera.disabled = true;
    onState('idle');
  }
  function waitMs(ms, current) {
    if (ms <= 0) return Promise.resolve(!disposed && current === generation && canStart());
    if (disposed || current !== generation || !canStart()) return Promise.resolve(false);
    return new Promise((resolve) => {
      cancelWait?.();
      const waitTimer = setTimeout(() => {
        if (cancelWait === abort) cancelWait = null;
        resolve(!disposed && current === generation && canStart());
      }, ms);
      function abort() {
        clearTimeout(waitTimer);
        cancelWait = null;
        resolve(false);
      }
      cancelWait = abort;
    });
  }
  function failOpen(current) {
    if (current !== generation) return;
    stop();
    onState('error');
    if (status)
      status.textContent = `摄像头未能开启。若已阻止权限，请在浏览器的网站设置中允许摄像头，或使用相册和${mode === 'device' ? '手动输入序列号' : '编号查询'}。`;
  }
  function startFrameLoop(current) {
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
            code = (await readQr(context.getImageData(0, 0, canvas.width, canvas.height)))[0]?.text;
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
  }
  async function acquireCameraStream({
    current,
    targetDeviceId,
    targetFacing,
    idealFacingHint = null,
    allowIdealFacingFallback = true,
    skipExactFacing = false
  }) {
    if (disposed || current !== generation || !canStart()) {
      if (current === generation) stop();
      return { outcome: 'aborted' };
    }
    if (!navigator.mediaDevices?.getUserMedia)
      return { outcome: 'failed', error: new Error('当前浏览器无法使用摄像头') };
    const initialElapsed = nowMs() - lastStreamReleaseAt;
    const retryDelays =
      initialElapsed >= 0 && initialElapsed < RECENT_RELEASE_WINDOW_MS
        ? RECENT_RELEASE_RETRY_DELAYS_MS
        : COLD_START_RETRY_DELAYS_MS;
    if (initialElapsed >= 0 && initialElapsed < STREAM_RELEASE_SETTLE_MS) {
      const ready = await waitMs(STREAM_RELEASE_SETTLE_MS - initialElapsed, current);
      if (!ready) {
        if (current === generation) stop();
        return { outcome: 'aborted' };
      }
    }
    async function requestWithTransientRetry(videoOptions) {
      for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
        if (disposed || current !== generation || !canStart()) {
          if (current === generation) stop();
          return { outcome: 'aborted' };
        }
        try {
          const media = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: videoOptions
          });
          if (disposed || current !== generation || !canStart()) {
            detachAndStopStream(media);
            if (current === generation) stop();
            return { outcome: 'aborted' };
          }
          const track = media.getVideoTracks?.()[0];
          if (!track) {
            detachAndStopStream(media);
            return { outcome: 'failed', error: new Error('未获取到视频轨道') };
          }
          return { outcome: 'opened', media, track };
        } catch (error) {
          if (disposed || current !== generation || !canStart()) {
            if (current === generation) stop();
            return { outcome: 'aborted' };
          }
          if (!TRANSIENT_CAMERA_ERRORS.has(error?.name || '') || attempt >= retryDelays.length)
            return { outcome: 'failed', error };
          const ready = await waitMs(retryDelays[attempt], current);
          if (!ready) {
            if (current === generation) stop();
            return { outcome: 'aborted' };
          }
        }
      }
      return { outcome: 'failed', error: new Error('摄像头开启失败') };
    }
    if (targetDeviceId) {
      const primaryVideo = idealFacingHint
        ? {
            deviceId: { exact: targetDeviceId },
            facingMode: { ideal: idealFacingHint },
            width: { ideal: 1280 }
          }
        : { deviceId: { exact: targetDeviceId }, width: { ideal: 1280 } };
      const primary = await requestWithTransientRetry(primaryVideo);
      if (primary.outcome === 'opened' || primary.outcome === 'aborted')
        return primary.outcome === 'opened'
          ? { ...primary, usedIdealFacingFallback: false }
          : primary;
      if (primary.error?.name !== 'OverconstrainedError') return primary;
      const bare = await requestWithTransientRetry({ deviceId: { exact: targetDeviceId } });
      return bare.outcome === 'opened' ? { ...bare, usedIdealFacingFallback: false } : bare;
    }
    const exactVideo = { facingMode: { exact: targetFacing }, width: { ideal: 1280 } };
    if (!skipExactFacing) {
      const exactResult = await requestWithTransientRetry(exactVideo);
      if (exactResult.outcome === 'opened' || exactResult.outcome === 'aborted')
        return exactResult.outcome === 'opened'
          ? { ...exactResult, usedIdealFacingFallback: false }
          : exactResult;
      if (
        !allowIdealFacingFallback ||
        !PERMANENT_CONSTRAINT_ERRORS.has(exactResult.error?.name || '')
      )
        return exactResult;
    } else if (!allowIdealFacingFallback)
      return { outcome: 'failed', error: new Error('摄像头开启失败') };
    // Phones should choose the rear lens; single-camera devices may not expose facing modes.
    const idealResult = await requestWithTransientRetry({
      ...exactVideo,
      facingMode: { ideal: targetFacing }
    });
    return idealResult.outcome === 'opened'
      ? { ...idealResult, usedIdealFacingFallback: true }
      : idealResult;
  }
  async function activateStream({
    media,
    track,
    current,
    requestedDeviceId,
    fallbackFacing = null
  }) {
    if (disposed || current !== generation || !canStart()) {
      detachAndStopStream(media);
      if (current === generation) stop();
      return { outcome: 'aborted' };
    }
    stream = media;
    video.srcObject = stream;
    try {
      await video.play();
    } catch (error) {
      detachAndStopStream(media, video);
      if (stream === media) stream = undefined;
      if (disposed || current !== generation || !canStart()) {
        if (current === generation) stop();
        return { outcome: 'aborted' };
      }
      return { outcome: 'failed', error };
    }
    if (disposed || current !== generation || !canStart()) {
      detachAndStopStream(media, video);
      if (stream === media) stream = undefined;
      if (current === generation) stop();
      return { outcome: 'aborted' };
    }
    const rawDevices = (await navigator.mediaDevices.enumerateDevices?.().catch(() => [])) || [];
    if (disposed || current !== generation || !canStart()) {
      detachAndStopStream(media, video);
      if (stream === media) stream = undefined;
      if (current === generation) stop();
      return { outcome: 'aborted' };
    }
    const videoInputs = rawDevices.filter((item) => item.kind === 'videoinput');
    if (rawVideoInputCount > 0 && videoInputs.length > rawVideoInputCount) {
      singleCamera = false;
      unavailableDeviceIds.clear();
    }
    rawVideoInputCount = videoInputs.length;
    cameras = videoInputs.filter((item) => Boolean(item.deviceId));
    const settings = track.getSettings?.() || {};
    const capabilities = track.getCapabilities?.() || {};
    multiFacingCapable =
      Array.isArray(capabilities.facingMode) && capabilities.facingMode.length > 1;
    torch.disabled = !capabilities.torch;
    const settingsDeviceId = settings.deviceId || '';
    let resolvedDeviceId;
    if (settingsDeviceId && cameras.some((item) => item.deviceId === settingsDeviceId))
      resolvedDeviceId = settingsDeviceId;
    else if (requestedDeviceId && cameras.some((item) => item.deviceId === requestedDeviceId))
      resolvedDeviceId = requestedDeviceId;
    else if (track.label) {
      const labelMatches = cameras.filter((item) => item.label === track.label);
      if (labelMatches.length === 1) resolvedDeviceId = labelMatches[0].deviceId;
    }
    deviceId = resolvedDeviceId || requestedDeviceId || settingsDeviceId || undefined;
    if (deviceId) unavailableDeviceIds.delete(deviceId);
    const matchedCamera = deviceId ? cameras.find((item) => item.deviceId === deviceId) : null;
    const detectedFacing =
      normalizeFacing(settings.facingMode) ||
      inferFacingFromLabel(track.label) ||
      inferFacingFromLabel(matchedCamera?.label) ||
      (deviceId ? knownFacingByDeviceId.get(deviceId) || null : null);
    if (detectedFacing) {
      facing = detectedFacing;
      if (deviceId) knownFacingByDeviceId.set(deviceId, detectedFacing);
    } else if (fallbackFacing) facing = fallbackFacing;
    const front =
      (detectedFacing || (fallbackFacing ? fallbackFacing : requestedDeviceId ? null : facing)) ===
      'user';
    setPreviewMirror(mirrorOverride ?? front);
    syncSwitchCameraControl();
    onState('running');
    if (status)
      status.textContent =
        mode === 'qr'
          ? `将${codeLabel}对准扫描框`
          : mode === 'device'
            ? '正在自动识别设备条码…'
            : '正在自动识别文字，也可以拍摄。';
    if (mode !== 'photo') startFrameLoop(current);
    return { outcome: 'opened' };
  }
  function resolveCameraFacing(camera) {
    return knownFacingByDeviceId.get(camera.deviceId) || inferFacingFromLabel(camera.label) || null;
  }
  function buildSwitchCandidates({
    activeDeviceId,
    activeTrackLabel,
    targetFacing,
    canDistinguishOriginal
  }) {
    if (cameras.length <= 1) return [];
    let currentIndex = activeDeviceId
      ? cameras.findIndex((item) => item.deviceId === activeDeviceId)
      : -1;
    if (currentIndex === -1 && activeTrackLabel) {
      const labelMatches = cameras.filter((item) => item.label === activeTrackLabel);
      if (labelMatches.length === 1)
        currentIndex = cameras.findIndex((item) => item.deviceId === labelMatches[0].deviceId);
    }
    const rotated =
      currentIndex >= 0
        ? [...cameras.slice(currentIndex + 1), ...cameras.slice(0, currentIndex)]
        : canDistinguishOriginal
          ? [...cameras.slice(1), cameras[0]]
          : cameras.slice(1);
    const available = rotated.filter(
      (item) => item.deviceId !== activeDeviceId && !unavailableDeviceIds.has(item.deviceId)
    );
    const oppositeFacing = [];
    const unknownFacing = [];
    const sameFacing = [];
    for (const item of available) {
      const itemFacing = resolveCameraFacing(item);
      if (itemFacing === targetFacing) oppositeFacing.push(item);
      else if (itemFacing === null) unknownFacing.push(item);
      else sameFacing.push(item);
    }
    oppositeFacing.sort(
      (a, b) => cameraOrderKey(a, cameras.indexOf(a)) - cameraOrderKey(b, cameras.indexOf(b))
    );
    return [
      ...oppositeFacing.map((device) => ({ device, group: 'opposite' })),
      ...unknownFacing.map((device) => ({ device, group: 'unknown' })),
      ...sameFacing.map((device) => ({ device, group: 'same' }))
    ];
  }
  async function start() {
    if (disposed || !canStart()) return false;
    stop();
    const current = generation;
    onState('opening');
    if (status) status.textContent = '正在开启摄像头…';
    try {
      let requestedId = deviceId;
      let acquired = await acquireCameraStream({
        current,
        targetDeviceId: requestedId,
        targetFacing: facing
      });
      if (acquired.outcome === 'aborted') return false;
      if (
        acquired.outcome === 'failed' &&
        requestedId &&
        PERMANENT_CONSTRAINT_ERRORS.has(acquired.error?.name || '')
      ) {
        unavailableDeviceIds.add(requestedId);
        deviceId = undefined;
        requestedId = undefined;
        acquired = await acquireCameraStream({
          current,
          targetDeviceId: undefined,
          targetFacing: facing
        });
        if (acquired.outcome === 'aborted') return false;
      }
      if (acquired.outcome !== 'opened') {
        failOpen(current);
        return false;
      }
      const activated = await activateStream({
        media: acquired.media,
        track: acquired.track,
        current,
        requestedDeviceId: requestedId,
        fallbackFacing: null
      });
      if (activated.outcome === 'aborted') return false;
      if (activated.outcome !== 'opened') {
        failOpen(current);
        return false;
      }
      return true;
    } catch {
      failOpen(current);
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
    if (!stream || disposed || !canStart() || switching || !canSwitchCamera()) return;
    const previousDeviceId = deviceId;
    const previousFacing = facing;
    const previousTrack = stream.getVideoTracks()[0];
    const previousSettings = previousTrack?.getSettings?.() || {};
    const previousActualDeviceId = previousSettings.deviceId || '';
    const previousActualFacing = normalizeFacing(previousSettings.facingMode);
    const previousTrackLabel = previousTrack?.label || '';
    const previousLabelWasUnique =
      Boolean(previousTrackLabel) &&
      cameras.filter((item) => item.label === previousTrackLabel).length === 1;
    const effectiveCurrentFacing =
      previousActualFacing ||
      inferFacingFromLabel(previousTrackLabel) ||
      (previousDeviceId ? knownFacingByDeviceId.get(previousDeviceId) || null : null) ||
      facing;
    const targetFacing = effectiveCurrentFacing === 'environment' ? 'user' : 'environment';
    const mobileEnv = isMobileCameraEnvironment();
    const canDistinguishOriginal = Boolean(previousActualDeviceId || previousLabelWasUnique);
    const candidates = buildSwitchCandidates({
      activeDeviceId: previousDeviceId,
      activeTrackLabel: previousTrackLabel,
      targetFacing,
      canDistinguishOriginal
    });
    const readActual = (track) => {
      const settings = track.getSettings?.() || {};
      return {
        nextActualDeviceId: settings.deviceId || '',
        nextActualFacing: normalizeFacing(settings.facingMode),
        nextTrackLabel: track.label || ''
      };
    };
    const transientUnavailableIds = new Set();
    stop();
    const current = generation;
    switching = true;
    switchCamera.disabled = true;
    onState('opening');
    if (status) status.textContent = '正在开启摄像头…';
    try {
      let exactFacingRejected = false;
      // Blind lenses cannot tell which enumerated device is live; let the browser pick by facing first.
      if (
        mobileEnv &&
        candidates.length > 0 &&
        !candidates.some((item) => item.group === 'opposite') &&
        !previousDeviceId &&
        !canDistinguishOriginal
      ) {
        const probe = await acquireCameraStream({
          current,
          targetDeviceId: undefined,
          targetFacing,
          allowIdealFacingFallback: false
        });
        if (probe.outcome === 'aborted') return;
        if (probe.outcome === 'opened') {
          const { nextActualDeviceId, nextActualFacing } = readActual(probe.track);
          if (
            isLiedExactFacing({
              previousActualFacing,
              previousActualDeviceId,
              nextActualFacing,
              nextActualDeviceId
            })
          )
            detachAndStopStream(probe.media);
          else {
            const activated = await activateStream({
              media: probe.media,
              track: probe.track,
              current,
              requestedDeviceId: undefined,
              fallbackFacing: targetFacing
            });
            if (activated.outcome === 'aborted' || activated.outcome === 'opened') return;
          }
        } else exactFacingRejected = PERMANENT_CONSTRAINT_ERRORS.has(probe.error?.name || '');
      }
      for (const { device, group } of candidates) {
        const candidateId = device.deviceId;
        const acquired = await acquireCameraStream({
          current,
          targetDeviceId: candidateId,
          idealFacingHint: mobileEnv && group !== 'same' ? targetFacing : null
        });
        if (acquired.outcome === 'aborted') return;
        if (acquired.outcome === 'failed') {
          unavailableDeviceIds.add(candidateId);
          if (TRANSIENT_CAMERA_ERRORS.has(acquired.error?.name || ''))
            transientUnavailableIds.add(candidateId);
          continue;
        }
        const { nextActualDeviceId, nextActualFacing, nextTrackLabel } = readActual(acquired.track);
        const isDuplicate =
          Boolean(
            previousActualDeviceId &&
              nextActualDeviceId &&
              nextActualDeviceId === previousActualDeviceId
          ) ||
          Boolean(
            !previousActualDeviceId &&
              !nextActualDeviceId &&
              previousLabelWasUnique &&
              nextTrackLabel === previousTrackLabel
          ) ||
          Boolean(
            group !== 'same' &&
              previousActualFacing &&
              nextActualFacing &&
              nextActualFacing === previousActualFacing &&
              (!nextActualDeviceId || nextActualDeviceId === previousActualDeviceId)
          );
        if (isDuplicate) {
          detachAndStopStream(acquired.media);
          unavailableDeviceIds.add(candidateId);
          continue;
        }
        const blindDualMobile =
          mobileEnv &&
          group !== 'same' &&
          cameras.length === 2 &&
          cameras.every((item) => !item.label);
        const activated = await activateStream({
          media: acquired.media,
          track: acquired.track,
          current,
          requestedDeviceId: candidateId,
          fallbackFacing: blindDualMobile ? targetFacing : null
        });
        if (activated.outcome === 'aborted') return;
        if (activated.outcome === 'opened') return;
        unavailableDeviceIds.add(candidateId);
        if (TRANSIENT_CAMERA_ERRORS.has(activated.error?.name || ''))
          transientUnavailableIds.add(candidateId);
      }

      const fallback = await acquireCameraStream({
        current,
        targetDeviceId: undefined,
        targetFacing,
        allowIdealFacingFallback: transientUnavailableIds.size === 0,
        skipExactFacing: exactFacingRejected
      });
      if (fallback.outcome === 'aborted') return;
      if (fallback.outcome === 'opened') {
        const { nextActualDeviceId, nextActualFacing, nextTrackLabel } = readActual(fallback.track);
        const liedExactFacing =
          !fallback.usedIdealFacingFallback &&
          isLiedExactFacing({
            previousActualFacing,
            previousActualDeviceId,
            nextActualFacing,
            nextActualDeviceId
          });
        const switchedOnFallback =
          !fallback.usedIdealFacingFallback && !liedExactFacing
            ? true
            : Boolean(
                (previousActualDeviceId &&
                  nextActualDeviceId &&
                  nextActualDeviceId !== previousActualDeviceId) ||
                  (nextActualFacing &&
                    nextActualFacing === targetFacing &&
                    nextActualFacing !== effectiveCurrentFacing) ||
                  (previousTrackLabel && nextTrackLabel && nextTrackLabel !== previousTrackLabel)
              );
        if (switchedOnFallback) {
          const activated = await activateStream({
            media: fallback.media,
            track: fallback.track,
            current,
            requestedDeviceId: undefined,
            fallbackFacing: targetFacing
          });
          if (activated.outcome === 'aborted' || activated.outcome === 'opened') return;
        } else if (transientUnavailableIds.size === 0) {
          facing = previousFacing;
          const activated = await activateStream({
            media: fallback.media,
            track: fallback.track,
            current,
            requestedDeviceId: previousDeviceId,
            fallbackFacing: previousFacing
          });
          if (activated.outcome === 'aborted') return;
          if (activated.outcome === 'opened') {
            singleCamera = true;
            if (status) status.textContent = '当前只有一个可用摄像头。';
            return;
          }
        } else {
          detachAndStopStream(fallback.media);
        }
      }

      for (const id of transientUnavailableIds) unavailableDeviceIds.delete(id);
      deviceId = previousDeviceId;
      facing = previousFacing;
      if (disposed || current !== generation || !canStart()) {
        if (current === generation) stop();
        return;
      }
      let recovered = await acquireCameraStream({
        current,
        targetDeviceId: previousDeviceId,
        targetFacing: previousFacing
      });
      if (recovered.outcome === 'aborted') return;
      if (recovered.outcome === 'failed' && previousDeviceId) {
        deviceId = undefined;
        recovered = await acquireCameraStream({
          current,
          targetDeviceId: undefined,
          targetFacing: previousFacing
        });
        if (recovered.outcome === 'aborted') return;
      }
      if (recovered.outcome === 'opened') {
        const activated = await activateStream({
          media: recovered.media,
          track: recovered.track,
          current,
          requestedDeviceId: deviceId,
          fallbackFacing: previousFacing
        });
        if (activated.outcome === 'aborted') return;
        if (activated.outcome === 'opened') {
          if (status) status.textContent = '切换失败，已恢复原镜头。';
          return;
        }
      }
      failOpen(current);
    } catch {
      failOpen(current);
    } finally {
      if (current === generation) {
        switching = false;
        syncSwitchCameraControl();
      }
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
      const preview = video.getBoundingClientRect();
      const frame = guide?.getBoundingClientRect();
      const sourceWidth = (frame?.width ?? previewWidth * 0.7) / cover;
      const sourceHeight = (frame?.height ?? previewHeight * 0.7) / cover;
      const sourceX =
        (video.videoWidth - visibleWidth) / 2 +
        (frame ? frame.left - preview.left : previewWidth * 0.15) / cover;
      const sourceY =
        (video.videoHeight - visibleHeight) / 2 +
        (frame ? frame.top - preview.top : previewHeight * 0.15) / cover;
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

export function createScanner(options) {
  return createScannerOperation({
    ...options,
    onState(state) {
      if (state === 'opening') trackEvent('flow.step', { control: 'device.scan', result: 'start' });
      if (state === 'error') reportClientError(null, 'SCANNER_ERROR', { control: 'device.scan' });
      options.onState?.(state);
    },
    onCode(value) {
      trackEvent('flow.result', { control: 'device.scan', result: 'ok' });
      return options.onCode?.(value);
    },
    onCandidates(values) {
      trackEvent('flow.result', { control: 'device.scan', result: 'ok' });
      return options.onCandidates?.(values);
    }
  });
}
