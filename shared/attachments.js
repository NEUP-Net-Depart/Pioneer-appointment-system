import { apiJson } from './api.js';
export function attachmentSize(size) {
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}
export function attachmentUrl(appointmentId, id) {
  const path = `/api/appointments/${encodeURIComponent(appointmentId)}/attachments/${encodeURIComponent(id)}`;
  return path;
}
export async function normalizeImageFile(file, { maxBytes = 4.5 * 1024 * 1024, maxDimension = 2400 } = {}) {
  const mime = String(file?.type || '').toLowerCase();
  if (!file || (mime && !mime.startsWith('image/'))) throw new Error('请选择图片文件');
  if (file.size <= maxBytes && ['image/jpeg','image/png','image/webp'].includes(mime)) return file;
  let bitmap;
  try {
    if (globalThis.createImageBitmap) bitmap = await createImageBitmap(file);
    else {
      const url = URL.createObjectURL(file);
      try { bitmap = await new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('图片无法读取，请改用 JPG 拍摄')); image.src = url; }); }
      finally { URL.revokeObjectURL(url); }
    }
  } catch { throw new Error('手机图片格式暂不支持，请在相册中选择 JPG 或 PNG'); }
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close?.();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!blob || blob.size > 5 * 1024 * 1024) throw new Error('照片压缩后仍超过 5 MB，请选择较小的照片');
  return new File([blob], `${String(file.name || 'photo').replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
}
export async function uploadAttachments(appointment, files, purpose = 'general') {
  const uploaded = [];
  for (const file of files) {
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    uploaded.push(await apiJson(`/api/appointments/${encodeURIComponent(appointment.id)}/attachments`, {
      method: 'POST', headers: appointment.accessToken ? { 'X-Appointment-Token':appointment.accessToken } : {}, json: { filename:file.name,mimeType:file.type,data,purpose }
    }));
  }
  return uploaded;
}
