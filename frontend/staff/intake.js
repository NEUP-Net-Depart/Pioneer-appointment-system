import { $, showToast } from '/shared/utils.js';
import { uploadAttachments, attachmentSize } from '/shared/attachments.js';
import { compressImage } from '/shared/image-compress.js';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

export function initIntake(start) {
  const modal = $('#intake-modal');
  let item, busy = false, previousFocus;
  const uploaded = {};
  const ready = {};   // input.id -> Promise<File>（压缩后的待上传文件）
  const tokens = {};  // input.id -> 序号，用于丢弃过期的压缩结果
  const inputs = ['front', 'back'].map(side => $('#intake-' + side));

  function previewOf(input) { return $('#' + input.id + '-preview'); }
  function metaOf(input) { return $('#' + input.id + '-meta'); }

  function setPreview(img, blob) {
    if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(blob);
  }

  function clearInput(input) {
    const preview = previewOf(input);
    if (preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
    preview.removeAttribute('src');
    preview.hidden = true;
    preview.classList.remove('is-pending');
    input.value = '';
    metaOf(input).textContent = '';
    delete ready[input.id];
    tokens[input.id] = (tokens[input.id] || 0) + 1;
  }

  function close() {
    if (busy) return;
    modal.hidden = true; item = undefined; previousFocus?.focus();
    for (const input of inputs) clearInput(input);
  }

  function prepare(input, file) {
    const preview = previewOf(input);
    const meta = metaOf(input);
    const token = tokens[input.id] = (tokens[input.id] || 0) + 1;
    if (!file) {
      delete ready[input.id];
      if (preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
      preview.removeAttribute('src');
      preview.hidden = true;
      preview.classList.remove('is-pending');
      meta.textContent = '';
      return;
    }
    preview.hidden = false;
    preview.classList.add('is-pending');
    setPreview(preview, file); // 立即预览原图，压缩完成后替换
    meta.textContent = '压缩中…';
    ready[input.id] = (async () => {
      let result;
      try { result = await compressImage(file); }
      catch { result = file; }
      if (token !== tokens[input.id]) return result;
      setPreview(preview, result);
      preview.classList.remove('is-pending');
      meta.textContent = result === file ? attachmentSize(result.size) : `${attachmentSize(file.size)} → ${attachmentSize(result.size)}`;
      return result;
    })();
  }

  for (const input of inputs) input.addEventListener('change', () => prepare(input, input.files[0]));

  $('#cancel-intake').addEventListener('click', close);
  modal.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  $('#intake-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!item || busy) return;
    for (const input of inputs) {
      const file = input.files[0];
      if (!file || !ACCEPTED_TYPES.includes(file.type)) {
        showToast('请分别选择电脑正面和反面照片，支持 JPG、PNG、WebP'); return;
      }
    }
    busy = true; $('#confirm-intake').disabled = true; inputs.forEach(input => input.disabled = true);
    try {
      const files = {};
      for (const input of inputs) {
        if (!ready[input.id]) ready[input.id] = compressImage(input.files[0]).catch(() => input.files[0]);
        files[input.id] = await ready[input.id];
        if (!files[input.id] || files[input.id].size > MAX_BYTES) throw new Error('照片压缩后仍超过 5 MB，请换一张更小的照片');
      }
      for (const input of inputs) if (!uploaded[input.id]) {
        const side = input.id.endsWith('front') ? 'front' : 'back';
        [uploaded[input.id]] = await uploadAttachments(item, [files[input.id]], 'intake_' + side);
      }
      await start(item, { frontPhotoId: uploaded['intake-front'].id, backPhotoId: uploaded['intake-back'].id });
      busy = false; close(); showToast('照片已保存，已签到并开始维修');
    } catch (error) { showToast(error.message); }
    finally { busy = false; $('#confirm-intake').disabled = false; inputs.forEach(input => input.disabled = false); }
  });
  return { open(value) { if (busy) return; previousFocus = document.activeElement; close(); item = value; for (const key of Object.keys(uploaded)) delete uploaded[key]; $('#intake-code').textContent = value.id; $('#intake-thermal-advice').hidden = value.faultType !== '清灰换硅脂'; modal.hidden = false; inputs[0].focus(); }, close };
}
