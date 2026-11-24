import type { R2Bucket } from '@cloudflare/workers-types';
import type { StaffAccountDto } from '../../shared/staff-types.ts';
import type { appointmentRepository } from '../db/appointments.ts';
import type { attachmentRepository } from '../db/attachments.ts';
import type { AttachmentRecord } from '../db/records.ts';
import type { readAttachment } from '../lib/attachment-input.ts';
import type { Observation } from '../platform/observability.ts';
import type { FieldWorkflow } from './field-workflow.ts';
import { fail } from '../lib/http.ts';
import { nowIso } from '../../shared/time.ts';
import { guestAppointment } from './access.ts';
import { requireRole } from './permissions.ts';

function metadata(item: AttachmentRecord, staff: boolean) {
  return { id: item.id, appointmentId: item.appointmentId, filename: item.filename, mimeType: item.mimeType, size: item.size, createdAt: item.createdAt, expiresAt: item.expiresAt, purpose: item.purpose, ...(staff ? {uploadedBy:item.uploadedBy} : {}) };
}
export function attachmentService(
  appointments: Pick<ReturnType<typeof appointmentRepository>, 'find' | 'findByCredential'>,
  attachments: Pick<ReturnType<typeof attachmentRepository>, 'list' | 'find' | 'create' | 'reserve' | 'photoCount' | 'markDeleting' | 'release'>,
  bucket: Pick<R2Bucket, 'get' | 'put' | 'delete'>,
  maxBytes: number,
  field?: Pick<FieldWorkflow, 'detail' | 'requireIntake'>,
  observation?: Pick<Observation, 'failure'>
) {
  async function authorize(id: string, user: StaffAccountDto | null, accessToken: string) {
    if (!user) return guestAppointment(appointments,id,accessToken);
    const item = await appointments.find(id);
    if (!item) fail(404, '预约或附件不存在');
    {
      if (!field) throw new Error('Missing staff attachment workflow');
      const visible=await field.detail(user,id);
      if(!visible.canReadDetails)fail(403,'没有该预约附件的访问权限');
    }
    return item;
  }
  return {
    async list(id: string, user: StaffAccountDto | null, accessToken: string) {
      const item = await authorize(id, user, accessToken);
      return { items: (await attachments.list(item.id, nowIso())).map(file=>metadata(file,!!user)) };
    },
    async upload(id: string, input: Awaited<ReturnType<typeof readAttachment>>, user: StaffAccountDto | null, accessToken: string) {
      if (input.purpose === 'intake_front' || input.purpose === 'intake_back') {
        user = requireRole(user, 'technician');
        const appointment = await appointments.find(id);
        if (!appointment) fail(404, '预约不存在');
        if (!field) throw new Error('Missing staff attachment workflow');
        await field.requireIntake(user,appointment);
        id = appointment.id;
      } else id = (await authorize(id, user, accessToken)).id;
      if (!user) {
        if (!input.mimeType.startsWith('image/')) fail(400,'学生端仅支持故障照片');
        if (input.bytes.length>2*1024*1024) fail(400,'故障照片大小不能超过 2 MB');
        input = {...input,purpose:'student_photo'};
      }
      const attachmentId = crypto.randomUUID();
      const objectKey = `appointments/${id}/${attachmentId}`;
      const { filename, mimeType, bytes } = input;
      const createdAt = nowIso();
      const expiresAt = new Date(Date.parse(createdAt) + 180 * 86400000).toISOString();
      const item: AttachmentRecord = { id: attachmentId, appointmentId: id, filename, mimeType, size: bytes.length, objectKey, createdAt, expiresAt, purpose: input.purpose || 'general', uploadedBy: user?.account || null };
      if (!await attachments.reserve(item, maxBytes)) {
        if (item.purpose==='student_photo' && await attachments.photoCount(id,createdAt)>=4) fail(409,'每个预约最多 4 张故障照片','PHOTO_LIMIT');
        fail(507, '附件存储空间已满');
      }
      try {
        await bucket.put(objectKey, bytes, { httpMetadata: { contentType: mimeType } });
        return metadata(await attachments.create(item),!!user);
      } catch (error) {
        // This is compensation, not a cross-service transaction. Keep the original failure.
        // D1 may have committed create() before its response was lost. Persist cleanup
        // intent and hide metadata before deleting R2, so every later failure is retryable.
        try { await attachments.markDeleting(attachmentId); await bucket.delete(objectKey); await attachments.release(attachmentId); }
        catch { observation?.failure('ATTACHMENT_COMPENSATION'); }
        throw error;
      }
    },
    async download(id: string, attachmentId: string, user: StaffAccountDto | null, accessToken: string) {
      const item = await authorize(id, user, accessToken);
      const attachment = await attachments.find(attachmentId, nowIso());
      if (!attachment || attachment.appointmentId !== item.id) fail(404, '附件不存在');
      const object = await bucket.get(attachment.objectKey);
      if (!object) fail(404, '附件文件不存在');
      return { body: object.body, size: object.size, metadata: metadata(attachment,!!user) };
    }
  };
}
