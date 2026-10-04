import { fail } from '../lib/http.js';
import { roleLevel } from '../../shared/constants.js';
import { nowIso } from '../../shared/time.js';

function metadata(item) {
  return { id: item.id, appointmentId: item.appointmentId, filename: item.filename, mimeType: item.mimeType, size: item.size, createdAt: item.createdAt, expiresAt: item.expiresAt };
}
export function attachmentService(appointments, attachments, bucket, maxBytes) {
  async function authorize(id, user, studentId) {
    const item = await appointments.findQueueEntry(id);
    if (!item) fail(404, '预约或附件不存在');
    const staff = user && ((roleLevel[user.role] ?? -1) >= 1 || (user.role === 'student' && user.account === item.studentId));
    if (!staff && !(!user && studentId === item.studentId)) fail(404, '预约或附件不存在');
  }
  return {
    async list(id, user, studentId) {
      await authorize(id, user, studentId);
      return { items: (await attachments.list(id, nowIso())).map(metadata) };
    },
    async upload(id, input, user, studentId) {
      await authorize(id, user, studentId);
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
    async download(id, attachmentId, user, studentId) {
      await authorize(id, user, studentId);
      const attachment = await attachments.find(attachmentId, nowIso());
      if (!attachment || attachment.appointmentId !== id) fail(404, '附件不存在');
      const object = await bucket.get(attachment.objectKey);
      if (!object) fail(404, '附件文件不存在');
      return { body: object.body, size: object.size, metadata: metadata(attachment) };
    }
  };
}
