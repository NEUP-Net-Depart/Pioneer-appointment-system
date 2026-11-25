import type { UploadOptions } from './api.ts';
import type { AttachmentDto, AttachmentPurpose } from './appointment-types.ts';
import type { NamedUpload } from './image-compress.ts';
import { apiUpload } from './api.ts';
import { uploadImage } from './image-compress.ts';
export function attachmentSize(size: number) {
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}
export function attachmentUrl(appointmentId: string, id: string) {
  const path = `/api/appointments/${encodeURIComponent(appointmentId)}/attachments/${encodeURIComponent(id)}`;
  return path;
}
export async function uploadAttachments(appointment: { id: string; accessToken?: string }, files: readonly NamedUpload[], purpose: AttachmentPurpose = 'general', options: Omit<UploadOptions, 'body' | 'headers'> = {}) {
  const uploaded: AttachmentDto[] = [];
  for (const original of files) {
    const file = original.type.startsWith('image/') ? await uploadImage(original) : original;
    uploaded.push(await apiUpload<AttachmentDto>(`/api/appointments/${encodeURIComponent(appointment.id)}/attachments`, {
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
