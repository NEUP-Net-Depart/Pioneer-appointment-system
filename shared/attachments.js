import { apiUpload } from './api.js';
import { uploadImage } from './image-compress.js';
export function attachmentSize(size) {
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}
export function attachmentUrl(appointmentId, id) {
  const path = `/api/appointments/${encodeURIComponent(appointmentId)}/attachments/${encodeURIComponent(id)}`;
  return path;
}
export async function uploadAttachments(appointment, files, purpose = 'general', options = {}) {
  const uploaded = [];
  for (const original of files) {
    const file = original.type.startsWith('image/') ? await uploadImage(original) : original;
    uploaded.push(await apiUpload(`/api/appointments/${encodeURIComponent(appointment.id)}/attachments`, {
      timeoutMs: purpose.startsWith('intake_') ? 0 : 30000,
      ...options,
      body: file,
      headers: {
        ...(appointment.accessToken ? { 'X-Appointment-Token': appointment.accessToken } : {}),
        'Content-Type': file.type,
        'X-Attachment-Filename': encodeURIComponent(file.name),
        'X-Attachment-Purpose': purpose
      }
    }));
  }
  return uploaded;
}
