import { apiJson } from '/shared/api.js';
import { qrImage } from '/shared/zxing.js';
import { credentialHeaders } from './credentials.js';

export async function renderRepairQr(container, item) {
  container.replaceChildren();
  const image = document.createElement('img'); image.alt = `${item.id} 维修二维码`; image.width = image.height = 240;
  const hint = document.createElement('p'); hint.className = 'repair-qr-status'; hint.setAttribute('role','status'); hint.textContent = '正在生成维修二维码…';
  const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-btn'; button.textContent = '重新生成二维码'; button.hidden = true;
  container.append(image, hint, button);
  async function load() {
    let encodingTimer;
    button.disabled = true;
    try {
      const endpoint = item.scanParentId
        ? '/api/appointments/' + encodeURIComponent(item.scanParentId) + '/repair-followups/' + encodeURIComponent(item.followupId) + '/scan-code'
        : '/api/appointments/' + encodeURIComponent(item.id) + '/scan-code';
      const { code } = await apiJson(endpoint, { headers: credentialHeaders(item), timeoutMs: 15000 });
      const blob = await Promise.race([qrImage(code),new Promise((_,reject)=>{encodingTimer=setTimeout(()=>reject(new Error('二维码生成超时')),15000);})]);
      if (!container.contains(image)) return;
      const url = URL.createObjectURL(blob);
      image.onload = () => URL.revokeObjectURL(url);
      image.onerror = () => { URL.revokeObjectURL(url); image.hidden = true; hint.textContent = '二维码暂不可用，到场后可报预约编号。'; button.hidden = false; };
      image.src = url;
      hint.textContent = ''; button.hidden = true;
    } catch { image.hidden = true; hint.textContent = '二维码暂不可用，到场后可报预约编号。'; button.hidden = false; }
    finally { clearTimeout(encodingTimer);button.disabled = false; }
  }
  button.addEventListener('click', () => { image.hidden = false; load(); });
  await load();
}
