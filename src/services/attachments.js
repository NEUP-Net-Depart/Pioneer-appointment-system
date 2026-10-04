import { fail } from '../lib/http.js';
import { roleLevel } from '../../shared/constants.js';
import { nowIso } from '../../shared/time.js';

function metadata(item) {
  return { id: item.id, appointmentId: item.appointmentId, filename: item.filename, mimeType: item.mimeType, size: item.size, createdAt: item.createdAt };
}
export function attachmentService(appointments, attachments, bucket) {
  async function authorize(id, user, studentId) {
    const item = await appointments.findQueueEntry(id);
    if (!item) fail(404, '预约或附件不存在');
    const staff = user && ((roleLevel[user.role] ?? -1) >= 1 || (user.role === 'student' && user.account === item.studentId));
    if (!staff && !(!user && studentId === item.studentId)) fail(404, '预约或附件不存在');
  }
  return {
    async list(id, user, studentId) {
      await authorize(id, user, studentId);
      return { items: (await attachments.list(id)).map(metadata) };
    },
    async upload(id, input, user, studentId) {
      await authorize(id, user, studentId);
      const attachmentId = crypto.randomUUID();
      const objectKey = `appointments/${id}/${attachmentId}`;
      const { filename, mimeType, bytes } = input;
      await bucket.put(objectKey, bytes, { httpMetadata: { contentType: mimeType } });
      try {
        return metadata(await attachments.create({ id: attachmentId, appointmentId: id, filename, mimeType, size: bytes.length, objectKey, createdAt: nowIso() }));
      } catch (error) {
        // This is compensation, not a cross-service transaction. Keep the original failure.
        try { await bucket.delete(objectKey); }
        catch { console.error('R2 compensation failed; reconcile object', objectKey); }
        throw error;
      }
    },
    async download(id, attachmentId, user, studentId) {
      await authorize(id, user, studentId);
      const attachment = await attachments.find(attachmentId);
      if (!attachment || attachment.appointmentId !== id) fail(404, '附件不存在');
      const object = await bucket.get(attachment.objectKey);
      if (!object) fail(404, '附件文件不存在');
      return { body: object.body, size: object.size, metadata: metadata(attachment) };
    }
  };
}
