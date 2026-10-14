import { $, showToast } from '/shared/utils.js';
import { uploadAttachments } from '/shared/attachments.js';
import { createPhotoInput } from '/shared/photo-input.js';

export function initIntake(start) {
  const modal = $('#intake-modal');
  let item, busy = false, previousFocus;
  const uploaded = {};
  const slots = ['front', 'back'].map(side => {
    const input = $('#intake-' + side);
    return { side, input, photo: createPhotoInput({
      input, preview: $('#' + input.id + '-preview'), meta: $('#' + input.id + '-meta'), progress: $('#' + input.id + '-progress'),
      getContext: () => item?.id,
      onChange() { delete uploaded[side]; },
    }) };
  });

  function close() {
    if (busy) return;
    modal.hidden = true; item = undefined; previousFocus?.focus();
    for (const slot of slots) { slot.photo.reset(); delete uploaded[slot.side]; }
  }
  $('#cancel-intake').addEventListener('click', close);
  modal.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  $('#intake-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!item || busy) return;
    if (slots.some(slot => !slot.photo.hasFile())) { showToast('请分别选择电脑正面和反面照片'); return; }
    busy = true; $('#confirm-intake').disabled = true; slots.forEach(slot => slot.input.disabled = true);
    let uploading;
    try {
      const files = {};
      for (const slot of slots) files[slot.side] = await slot.photo.getFile();
      for (const slot of slots) if (!uploaded[slot.side]) {
        uploading = slot.photo; uploading.setStatus('正在上传');
        [uploaded[slot.side]] = await uploadAttachments(item, [files[slot.side]], 'intake_' + slot.side);
        uploading.setStatus('已上传'); uploading = undefined;
      }
      await start(item, { frontPhotoId: uploaded.front.id, backPhotoId: uploaded.back.id });
      busy = false; close(); showToast('照片已保存，已签到并开始维修');
    } catch (error) {
      uploading?.setStatus('上传失败，请重试'); showToast(error.message);
    } finally { busy = false; $('#confirm-intake').disabled = false; slots.forEach(slot => slot.input.disabled = false); }
  });
  return { open(value) {
    if (busy) return;
    previousFocus = document.activeElement; close(); item = value;
    $('#intake-code').textContent = value.id;
    $('#intake-thermal-advice').hidden = value.faultType !== '清灰换硅脂';
    modal.hidden = false; slots[0].input.focus();
  }, close };
}
