import { $, showToast } from '/shared/utils.js';
import { normalizeImageFile, uploadAttachments } from '/shared/attachments.js';

export function initIntake(start) {
  const modal = $('#intake-modal');
  let item, busy = false, previousFocus;
  const uploads = {};
  const inputs = ['front', 'back'].map(side => $('#intake-' + side));
  function close() {
    if (busy) return;
    modal.hidden = true; item = undefined; previousFocus?.focus();
    for (const input of inputs) {
      const preview = $('#'+input.id+'-preview'); URL.revokeObjectURL(preview.src); preview.removeAttribute('src'); preview.hidden = true; input.value = '';
    }
  }
  for (const input of inputs) input.addEventListener('change', async () => {
    const preview = $('#'+input.id+'-preview'); URL.revokeObjectURL(preview.src);
    delete uploads[input.id]; const file = input.files[0];
    preview.hidden = !file;
    if (file) { try { const normalized = await normalizeImageFile(file); input._normalized = normalized; preview.src = URL.createObjectURL(normalized); } catch (error) { input.value = ''; input._normalized = undefined; preview.hidden = true; showToast(error.message); } } else { input._normalized = undefined; preview.removeAttribute('src'); }
  });
  $('#cancel-intake').addEventListener('click', close);
  modal.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  $('#intake-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!item || busy) return;
    if (inputs.some(input => !input.files[0] || !input._normalized)) {
      showToast('请分别选择电脑正面和反面照片；手机相册格式会自动转换'); return;
    }
    busy = true; $('#confirm-intake').disabled = true; inputs.forEach(input => input.disabled = true);
    try {
      for (const input of inputs) if (!uploads[input.id]) {
        const side = input.id.endsWith('front') ? 'front' : 'back';
        [uploads[input.id]] = await uploadAttachments(item, [input._normalized], 'intake_' + side);
      }
      await start(item, { frontPhotoId: uploads['intake-front'].id, backPhotoId: uploads['intake-back'].id });
      busy = false; close(); showToast('照片已保存，已签到并开始维修');
    } catch (error) { showToast(error.message); }
    finally { busy = false; $('#confirm-intake').disabled = false; inputs.forEach(input => input.disabled = false); }
  });
  return { open(value) { if (busy) return; previousFocus = document.activeElement; close(); item = value; for (const key of Object.keys(uploads)) delete uploads[key]; $('#intake-code').textContent = value.id; $('#intake-thermal-advice').hidden = value.faultType !== '清灰换硅脂'; modal.hidden = false; inputs[0].focus(); }, close };
}
