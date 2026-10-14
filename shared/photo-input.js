import { showToast } from './utils.js';
import { attachmentSize } from './attachments.js';
import { compressImage, INTAKE_PHOTO_MAX_BYTES } from './image-compress.js';

// Both intake entry points use this controller; upload IDs remain owned by
// each workflow so the scanner can persist them across reloads and retries.
export function createPhotoInput({ input, preview, meta, progress, onChange, getContext = () => null }) {
  let version = 0, ready, prepared, originalSize;

  function clearPreview() {
    if (preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
    preview.removeAttribute('src'); preview.hidden = true;
  }
  function reset() {
    version++; ready = prepared = undefined; originalSize = undefined;
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
  function prepare() {
    const file = input.files[0], current = ++version, context = getContext();
    const isCurrent = () => current === version && context === getContext();
    clearPreview(); ready = prepared = undefined; originalSize = file?.size;
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
        prepared = result;
        preview.src = URL.createObjectURL(result.file); preview.hidden = false;
        setStatus();
        if (result.warning) showToast(result.warning);
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
  input.addEventListener('change', prepare);
  return {
    reset, setStatus,
    hasFile() { return !!input.files[0]; },
    async getFile() {
      if (!input.files[0]) throw new Error('请分别选择电脑正面和反面照片');
      const pending = ready || prepare(), current = version, context = getContext();
      const result = await pending;
      if (current !== version || context !== getContext() || !result) throw new Error('照片已更换，请重新确认');
      if (result.error) throw result.error;
      if (!result.file || result.file.size > INTAKE_PHOTO_MAX_BYTES) throw new Error('照片压缩后仍超过 2 MB，请换一张更小的照片');
      return result.file;
    },
  };
}
