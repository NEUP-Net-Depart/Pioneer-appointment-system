import { $, showToast } from '/shared/utils.js';
import { uploadAttachments, attachmentSize } from '/shared/attachments.js';
import { compressImage, INTAKE_PHOTO_MAX_BYTES } from '/shared/image-compress.js';

export function initIntake(start) {
  const modal = $('#intake-modal');
  let item, busy = false, previousFocus;
  const uploaded = {};
  const ready = {};
  const tokens = {};
  const inputs = ['front', 'back'].map(side => $('#intake-' + side));

  function previewOf(input) { return $('#' + input.id + '-preview'); }
  function metaOf(input) { return $('#' + input.id + '-meta'); }
  function progressOf(input) { return $('#' + input.id + '-progress'); }
  function showPrepared(input, result, status = '照片已准备好') {
    metaOf(input).textContent = [
      `${attachmentSize(input.files[0].size)} → ${attachmentSize(result.file.size)}`,
      result.warning, status,
    ].filter(Boolean).join(' · ');
  }

  function clearPreview(input) {
    const preview = previewOf(input);
    if (preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
    preview.removeAttribute('src');
    preview.hidden = true;
    preview.classList.remove('is-pending');
  }

  function clearInput(input) {
    clearPreview(input);
    input.value = '';
    metaOf(input).textContent = '';
    metaOf(input).classList.remove('is-error');
    progressOf(input).hidden = true;
    progressOf(input).value = 0;
    delete ready[input.id];
    delete uploaded[input.id];
    tokens[input.id] = (tokens[input.id] || 0) + 1;
  }

  function close() {
    if (busy) return;
    modal.hidden = true; item = undefined; previousFocus?.focus();
    for (const input of inputs) clearInput(input);
  }

  function prepare(input, file) {
    clearPreview(input);
    const preview = previewOf(input), meta = metaOf(input), progress = progressOf(input);
    const token = tokens[input.id] = (tokens[input.id] || 0) + 1;
    // A retry can reuse uploads only while the corresponding file is unchanged.
    delete uploaded[input.id];
    delete ready[input.id];
    meta.classList.remove('is-error');
    meta.textContent = '';
    progress.hidden = !file;
    progress.value = 0;
    if (!file) return;
    preview.classList.add('is-pending');
    ready[input.id] = (async () => {
      try {
        const result = await compressImage(file, { onProgress({ value, label }) {
          if (token !== tokens[input.id]) return;
          progress.value = value;
          meta.textContent = `${attachmentSize(file.size)} · ${label}`;
        } });
        if (token !== tokens[input.id]) return null;
        preview.src = URL.createObjectURL(result.file);
        preview.hidden = false;
        preview.classList.remove('is-pending');
        showPrepared(input, result);
        if (result.warning) showToast(result.warning);
        return result;
      } catch (error) {
        if (token !== tokens[input.id]) return null;
        clearPreview(input);
        progress.hidden = true;
        meta.textContent = error.message;
        meta.classList.add('is-error');
        showToast(error.message);
        // Keep a settled error result: selecting a file must never create an
        // unhandled rejection, and submitting must not silently retry it.
        return { error };
      }
    })();
  }

  for (const input of inputs) input.addEventListener('change', () => prepare(input, input.files[0]));

  $('#cancel-intake').addEventListener('click', close);
  modal.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  $('#intake-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!item || busy) return;
    if (inputs.some(input => !input.files[0])) {
      showToast('请分别选择电脑正面和反面照片'); return;
    }
    busy = true; $('#confirm-intake').disabled = true; inputs.forEach(input => input.disabled = true);
    const prepared = {};
    let uploadingInput;
    try {
      const files = {};
      for (const input of inputs) {
        if (!ready[input.id]) prepare(input, input.files[0]);
        const result = await ready[input.id];
        if (result?.error) throw result.error;
        if (!result?.file || result.file.size > INTAKE_PHOTO_MAX_BYTES) throw new Error('照片压缩后仍超过 2 MB，请换一张更小的照片');
        prepared[input.id] = result;
        files[input.id] = result.file;
      }
      for (const input of inputs) if (!uploaded[input.id]) {
        const side = input.id.endsWith('front') ? 'front' : 'back';
        uploadingInput = input;
        showPrepared(input, prepared[input.id], '正在上传');
        [uploaded[input.id]] = await uploadAttachments(item, [files[input.id]], 'intake_' + side);
        showPrepared(input, prepared[input.id], '已上传');
        uploadingInput = undefined;
      }
      await start(item, { frontPhotoId: uploaded['intake-front'].id, backPhotoId: uploaded['intake-back'].id });
      busy = false; close(); showToast('照片已保存，已签到并开始维修');
    } catch (error) {
      if (uploadingInput) showPrepared(uploadingInput, prepared[uploadingInput.id], '上传失败，请重试');
      showToast(error.message);
    } finally { busy = false; $('#confirm-intake').disabled = false; inputs.forEach(input => input.disabled = false); }
  });
  return { open(value) {
    if (busy) return;
    previousFocus = document.activeElement; close(); item = value;
    $('#intake-code').textContent = value.id;
    $('#intake-thermal-advice').hidden = value.faultType !== '清灰换硅脂';
    modal.hidden = false; inputs[0].focus();
  }, close };
}
