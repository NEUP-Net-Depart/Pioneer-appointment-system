import { apiJson } from '/shared/api.js';
import { qrImage } from '/shared/zxing.js';
import { credentialHeaders } from './credentials.js';

export async function renderRepairQr(container, item) {
  container.replaceChildren();
  const title = document.createElement('p'); title.textContent = '到场维修时向工作人员出示此二维码';
  const image = document.createElement('img'); image.alt = `${item.id} 维修二维码`; image.width = image.height = 240;
  const hint = document.createElement('p'); hint.textContent = '正在生成维修二维码…';
  const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-btn'; button.textContent = '重新生成二维码'; button.hidden = true;
  container.append(title, image, hint, button);
  async function load() {
    button.disabled = true;
    try {
      const { code } = await apiJson(`/api/appointments/${encodeURIComponent(item.id)}/scan-code`, { headers: credentialHeaders(item) });
      const blob = await qrImage(code);
      if (!container.contains(image)) return;
      const url = URL.createObjectURL(blob);
      image.onload = () => URL.revokeObjectURL(url); image.src = url;
      hint.textContent = '二维码仅供工作人员定位工单，不包含私人查询凭证。'; button.hidden = true;
    } catch { image.hidden = true; hint.textContent = '二维码暂不可用，到场后可报预约编号。'; button.hidden = false; }
    finally { button.disabled = false; }
  }
  button.addEventListener('click', () => { image.hidden = false; load(); });
  await load();
}
