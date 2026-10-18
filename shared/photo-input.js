import { showToast } from './utils.js';
import { attachmentSize } from './attachments.js';
import { compressImage, INTAKE_PHOTO_MAX_BYTES } from './image-compress.js';

// Both intake entry points share preparation and upload state. The scanner
// persists successful upload IDs through onUploaded for recovery after reload.
export function createPhotoInput({ input, preview, meta, progress, onChange, upload, onUploaded, getContext = () => null }) {
  let version = 0, ready, prepared, originalSize, uploading, uploaded;

  function clearPreview() {
    if (preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
    preview.removeAttribute('src'); preview.hidden = true;
  }
  function reset() {
    version++; ready = prepared = uploading = uploaded = undefined; originalSize = undefined;
    clearPreview(); input.value = '';
    meta.textContent = ''; meta.classList.remove('is-error');
    progress.hidden = true; progress.value = 0;
  }
  function setStatus(status = '照片已准备好') {
    meta.textContent = prepared ? [
      `${attachmentSize(originalSize)} → ${attachmentSize(prepared.file.size)}`,
      prepared.warning, status,
    ].filter(Boolean).join(' · ') : status;
  }
  function startUpload(file, current, context) {
    const isCurrent = () => current === version && context === getContext();
    meta.classList.remove('is-error'); setStatus('正在上传');
    uploading = (async () => {
      try {
        const attachment = await upload(file);
        if (!isCurrent()) return null;
        uploaded = attachment;
        onUploaded?.(attachment);
        setStatus('已上传');
        return { attachment };
      } catch (error) {
        if (!isCurrent()) return null;
        setStatus('上传失败，确认签到时重试'); meta.classList.add('is-error');
        showToast(error.message);
        return { error };
      } finally { if (isCurrent()) uploading = undefined; }
    })();
    return uploading;
  }
  function prepare() {
    const file = input.files[0], current = ++version, context = getContext();
    const isCurrent = () => current === version && context === getContext();
    clearPreview(); ready = prepared = uploading = uploaded = undefined; originalSize = file?.size;
    meta.textContent = ''; meta.classList.remove('is-error');
    progress.hidden = !file; progress.value = 0;
    onChange?.();
    if (!file) return;
    ready = (async () => {
      try {
        const result = await compressImage(file, { onProgress({ value, label }) {
          if (!isCurrent()) return;
          progress.value = value;
          meta.textContent = `${attachmentSize(file.size)} · ${label}`;
        } });
        if (!isCurrent()) return null;
        if (!result.file || result.file.size > INTAKE_PHOTO_MAX_BYTES) throw new Error('照片压缩后仍超过 2 MB，请换一张更小的照片');
        prepared = result;
        preview.src = URL.createObjectURL(result.file); preview.hidden = false;
        setStatus();
        if (result.warning) showToast(result.warning);
        if (upload) startUpload(result.file, current, context);
        return result;
      } catch (error) {
        if (!isCurrent()) return null;
        clearPreview(); progress.hidden = true;
        meta.textContent = error.message; meta.classList.add('is-error');
        showToast(error.message);
        // Selection settles errors locally; submission can report them again
        // without an unhandled rejection or a silent compression retry.
        return { error };
      }
    })();
    return ready;
  }
  async function getFile() {
    if (!input.files[0]) throw new Error('请分别选择电脑正面和反面照片');
    const pending = ready || prepare(), current = version, context = getContext();
    const result = await pending;
    if (current !== version || context !== getContext() || !result) throw new Error('照片已更换，请重新确认');
    if (result.error) throw result.error;
    return result.file;
  }
  input.addEventListener('change', prepare);
  return {
    reset, setStatus, getFile,
    hasFile() { return !!input.files[0]; },
    async getUploaded() {
      const file = await getFile(), current = version, context = getContext();
      if (uploaded) return uploaded;
      const result = await (uploading || startUpload(file, current, context));
      if (current !== version || context !== getContext() || !result) throw new Error('照片已更换，请重新确认');
      if (result.error) throw result.error;
      return result.attachment;
    },
  };
}
