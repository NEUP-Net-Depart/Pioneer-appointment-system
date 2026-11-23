import { apiJson } from '/shared/api.js';
import { qrImage } from '/shared/zxing.js';
import { credentialHeaders } from './credentials.js';

async function loadRepairQrImage(endpoint, item) {
  const { code } = await apiJson(endpoint, { headers: credentialHeaders(item), timeoutMs: 15000 });
  let encodingTimer;
  try {
    return await Promise.race([
      qrImage(code),
      new Promise((_, reject) => { encodingTimer = setTimeout(() => reject(new Error('二维码生成超时')), 15000); })
    ]);
  } finally {
    clearTimeout(encodingTimer);
  }
}

export async function renderRepairQr(container, item, { cache, onReady } = {}) {
  container.replaceChildren();
  const image = document.createElement('img'); image.alt = `${item.id} 维修二维码`; image.width = image.height = 240;
  image.hidden = true;
  const hint = document.createElement('p'); hint.className = 'repair-qr-status'; hint.setAttribute('role','status');
  const button = document.createElement('button');button.setAttribute('data-track','student.repair-qr.dynamic.button'); button.type = 'button'; button.className = 'secondary-btn'; button.textContent = '重新生成二维码'; button.hidden = true;
  container.append(image, hint, button);
  const endpoint = item.scanParentId
    ? '/api/appointments/' + encodeURIComponent(item.scanParentId) + '/related/' + encodeURIComponent(item.id) + '/scan-code'
    : '/api/appointments/' + encodeURIComponent(item.id) + '/scan-code';
  const key = `${endpoint}/${item.accessToken}`;
  const showFailure = () => {
    image.hidden = true;
    hint.textContent = '二维码暂不可用，可向工作人员报预约编号。';
    button.hidden = false;
  };
  async function load() {
    image.hidden = true;
    button.disabled = true;
    hint.textContent = '正在生成维修二维码…';
    let pending = cache?.get(key);
    if (!pending) {
      pending = loadRepairQrImage(endpoint, item);
      cache?.set(key, pending);
    }
    try {
      const blob = await pending;
      if (!image.isConnected || !container.contains(image)) return;
      const url = URL.createObjectURL(blob);
      image.onload = () => {
        URL.revokeObjectURL(url);
        image.hidden = false;
        hint.textContent = '';
        button.hidden = true;
        onReady?.();
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        cache?.delete(key);
        showFailure();
      };
      image.src = url;
    } catch {
      if (cache?.get(key) === pending) cache.delete(key);
      showFailure();
    } finally {
      button.disabled = false;
    }
  }
  button.addEventListener('click', load);
  await load();
}
