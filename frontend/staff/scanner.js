import { readQr } from '/shared/zxing.js';

export function createScanner({ video, status, torch, switchCamera, onCode }) {
  let stream, timer, generation = 0, facing = 'environment', cameras = [], deviceId, lit = false;
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d', { willReadFrequently: true });
  function stop() {
    generation++; clearTimeout(timer);
    stream?.getTracks().forEach(track => track.stop()); stream = undefined;
    video.srcObject = null; lit = false; torch.disabled = true; torch.setAttribute('aria-pressed', 'false');
  }
  async function start() {
    stop(); const current = generation;
    status.textContent = '正在打开摄像头…';
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器无法使用摄像头');
      const media = await navigator.mediaDevices.getUserMedia({ audio: false, video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: facing }, width: { ideal: 1280 } } });
      if (current !== generation) { media.getTracks().forEach(track => track.stop()); return; }
      stream = media; video.srcObject = stream; await video.play();
      if (current !== generation) return;
      const track = stream.getVideoTracks()[0];
      torch.disabled = !track.getCapabilities?.().torch;
      cameras = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
      if (current !== generation) return;
      deviceId = track.getSettings().deviceId;
      status.textContent = '将维修二维码放入框内';
      async function frame() {
        if (current !== generation) return;
        try {
          if (video.readyState >= 2 && video.videoWidth) {
            const scale = Math.min(1, 960 / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const codes = await readQr(context.getImageData(0, 0, canvas.width, canvas.height));
            if (current !== generation) return;
            if (codes[0]?.text) { stop(); await onCode(codes[0].text); return; }
          }
          timer = setTimeout(frame, 220);
        } catch (error) { if (current === generation) { stop(); status.textContent = `识别失败：${error.message}。可重试摄像头、选择图片或手动输入编号。`; } }
      }
      frame();
    } catch (error) {
      if (current !== generation) return;
      stop(); status.textContent = `摄像头不可用（${error.name === 'NotAllowedError' ? '未获得权限' : error.message}），请使用图片识别或手动输入编号。`;
    }
  }
  torch.addEventListener('click', async () => {
    const track = stream?.getVideoTracks()[0]; if (!track) return;
    try { await track.applyConstraints({ advanced: [{ torch: !lit }] }); lit = !lit; torch.setAttribute('aria-pressed', String(lit)); }
    catch { status.textContent = '此摄像头无法开启手电筒'; }
  });
  switchCamera.addEventListener('click', () => {
    if (cameras.length > 1) deviceId = cameras[(cameras.findIndex(device => device.deviceId === deviceId) + 1) % cameras.length].deviceId;
    else { deviceId = undefined; facing = facing === 'environment' ? 'user' : 'environment'; }
    start();
  });
  return { start, stop, async image(file) {
    stop();
    const current = generation;
    if (!file || !file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) throw new Error('请选择不超过 10 MB 的二维码图片');
    const codes = await readQr(file);
    if (current !== generation) return;
    if (!codes[0]?.text) throw new Error('图片中未找到二维码，请重试或手动输入编号');
    await onCode(codes[0].text);
  } };
}
