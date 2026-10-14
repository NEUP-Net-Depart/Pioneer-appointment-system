import { $, showToast } from '/shared/utils.js';
import { uploadAttachments } from '/shared/attachments.js';
import { createPhotoInput } from '/shared/photo-input.js';

export function initIntake(start) {
  const modal = $('#intake-modal');
  let item, busy = false, previousFocus;
  const slots = ['front', 'back'].map(side => {
    const input = $('#intake-' + side);
    return { side, input, photo: createPhotoInput({
      input, preview: $('#' + input.id + '-preview'), meta: $('#' + input.id + '-meta'), progress: $('#' + input.id + '-progress'),
      getContext: () => item?.id,
      async upload(file) {
        const [attachment] = await uploadAttachments(item, [file], 'intake_' + side);
        return attachment;
      },
    }) };
  });

  function close() {
    if (busy) return;
    modal.hidden = true; item = undefined; previousFocus?.focus();
    for (const slot of slots) slot.photo.reset();
  }
  $('#cancel-intake').addEventListener('click', close);
  modal.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  $('#intake-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!item || busy) return;
    if (slots.some(slot => !slot.photo.hasFile())) { showToast('请分别选择电脑正面和反面照片'); return; }
    busy = true; $('#confirm-intake').disabled = true; slots.forEach(slot => slot.input.disabled = true);
    try {
      const [front, back] = await Promise.all(slots.map(slot => slot.photo.getUploaded()));
      await start(item, { frontPhotoId: front.id, backPhotoId: back.id });
      busy = false; close(); showToast('照片已保存，已签到并开始维修');
    } catch (error) {
      showToast(error.message);
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
