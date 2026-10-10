import { fail } from '../lib/http.js';
import { nowIso } from '../../shared/time.js';
import { guestAppointment } from './access.js';
import { requireAppointmentAccess } from './permissions.js';

function metadata(item) {
  return { id: item.id, appointmentId: item.appointmentId, filename: item.filename, mimeType: item.mimeType, size: item.size, createdAt: item.createdAt, expiresAt: item.expiresAt };
}
export function attachmentService(appointments, attachments, bucket, maxBytes) {
  async function authorize(id, user, accessToken) {
    if (!user) { await guestAppointment(appointments,id,accessToken); return; }
    const item = await appointments.find(id);
    if (!item) fail(404, '预约或附件不存在');
    requireAppointmentAccess(user,item);
  }
  return {
    async list(id, user, accessToken) {
      await authorize(id, user, accessToken);
      return { items: (await attachments.list(id, nowIso())).map(metadata) };
    },
    async upload(id, input, user, accessToken) {
      await authorize(id, user, accessToken);
      const attachmentId = crypto.randomUUID();
      const objectKey = `appointments/${id}/${attachmentId}`;
      const { filename, mimeType, bytes } = input;
      const createdAt = nowIso();
      const expiresAt = new Date(Date.parse(createdAt) + 180 * 86400000).toISOString();
      const item = { id: attachmentId, appointmentId: id, filename, mimeType, size: bytes.length, objectKey, createdAt, expiresAt };
      if (!await attachments.reserve(item, maxBytes)) fail(507, '附件存储空间已满');
      try {
        await bucket.put(objectKey, bytes, { httpMetadata: { contentType: mimeType } });
        return metadata(await attachments.create(item));
      } catch (error) {
        // This is compensation, not a cross-service transaction. Keep the original failure.
        // D1 may have committed create() before its response was lost. Persist cleanup
        // intent and hide metadata before deleting R2, so every later failure is retryable.
        try { await attachments.markDeleting(attachmentId); await bucket.delete(objectKey); await attachments.release(attachmentId); }
        catch { console.error('Attachment compensation incomplete; retained storage reservation', attachmentId); }
        throw error;
      }
    },
    async download(id, attachmentId, user, accessToken) {
      await authorize(id, user, accessToken);
      const attachment = await attachments.find(attachmentId, nowIso());
      if (!attachment || attachment.appointmentId !== id) fail(404, '附件不存在');
      const object = await bucket.get(attachment.objectKey);
      if (!object) fail(404, '附件文件不存在');
      return { body: object.body, size: object.size, metadata: metadata(attachment) };
    }
  };
}
