import type { AttachmentRecord } from './records.ts';

interface AttachmentRow {
  id: string; appointment_id: string; filename: string; mime_type: string;
  size: number; object_key: string; created_at: string; expires_at: string;
  purpose: AttachmentRecord['purpose']; uploaded_by: string | null;
}
import type { Database } from '../platform/environment.ts';
function fromRow(row: AttachmentRow): AttachmentRecord {
  return { id: row.id, appointmentId: row.appointment_id, filename: row.filename, mimeType: row.mime_type, size: row.size, createdAt: row.created_at, expiresAt: row.expires_at, objectKey: row.object_key, purpose: row.purpose, uploadedBy: row.uploaded_by };
}
const cleanupCondition = "(state='deleting' OR (state='complete' AND expires_at<=?) OR (state='pending' AND created_at<=?))";
export function attachmentRepository(db: Database) {
  return {
    async photoCount(id: string,now: string) {
      return (await db.prepare(`SELECT (SELECT COUNT(*) FROM appointment_attachments WHERE appointment_id=? AND expires_at>?
        AND purpose IN ('general','student_photo') AND mime_type LIKE 'image/%') +
        (SELECT COUNT(*) FROM attachment_storage WHERE appointment_id=? AND state='pending' AND purpose='student_photo') AS total`).bind(id,now,id).first<{ total: number }>())?.total ?? 0;
    },
    async reserve(item: AttachmentRecord, maxBytes: number) {
      return !!await db.prepare(`INSERT INTO attachment_storage(id,object_key,size,state,created_at,expires_at,appointment_id,purpose)
        SELECT ?,?,?,'pending',?,?,?,? FROM storage_quota WHERE id=1 AND used_bytes+?<=? AND (?<>'student_photo' OR
        (SELECT COUNT(*) FROM appointment_attachments WHERE appointment_id=? AND expires_at>? AND purpose IN ('general','student_photo') AND mime_type LIKE 'image/%') +
        (SELECT COUNT(*) FROM attachment_storage WHERE appointment_id=? AND state='pending' AND purpose='student_photo') < 4) RETURNING id`)
        .bind(item.id,item.objectKey,item.size,item.createdAt,item.expiresAt,item.appointmentId || null,item.purpose || 'general',item.size,maxBytes,item.purpose || 'general',item.appointmentId || null,item.createdAt,item.appointmentId || null).first();
    },
    async create(item: AttachmentRecord) {
      const results = await db.batch<AttachmentRow>([
        db.prepare(`INSERT INTO appointment_attachments(id,appointment_id,filename,mime_type,size,object_key,created_at,expires_at,purpose,uploaded_by)
          SELECT ?,?,?,?,?,?,?,?,?,? FROM attachment_storage WHERE id=? AND state='pending' RETURNING *`)
          .bind(item.id, item.appointmentId, item.filename, item.mimeType, item.size, item.objectKey, item.createdAt, item.expiresAt, item.purpose || 'general', item.uploadedBy || null, item.id),
        db.prepare(`UPDATE attachment_storage SET state='complete' WHERE id=? AND state='pending'
          AND EXISTS(SELECT 1 FROM appointment_attachments WHERE id=?)`).bind(item.id, item.id)
      ]);
      const row = results[0].results[0];
      if (!row) throw new Error('Attachment reservation no longer available');
      return fromRow(row);
    },
    async list(id: string, now: string) { return (await db.prepare('SELECT * FROM appointment_attachments WHERE appointment_id=? AND expires_at>? ORDER BY created_at').bind(id, now).all<AttachmentRow>()).results.map(fromRow); },
    async find(id: string, now: string) { const row = await db.prepare('SELECT * FROM appointment_attachments WHERE id=? AND expires_at>?').bind(id, now).first<AttachmentRow>(); return row ? fromRow(row) : null; },
    async markDeleting(id: string) {
      await db.batch([
        db.prepare("UPDATE attachment_storage SET state='deleting' WHERE id=?").bind(id),
        db.prepare('DELETE FROM appointment_attachments WHERE id=?').bind(id)
      ]);
    },
    async release(id: string) { await db.prepare('DELETE FROM attachment_storage WHERE id=?').bind(id).run(); },
    async cleanupCandidates(now: string, pendingBefore: string, cursor = '', limit = 100) {
      return (await db.prepare(`SELECT id,object_key FROM attachment_storage WHERE ${cleanupCondition} AND id>? ORDER BY id LIMIT ?`)
        .bind(now, pendingBefore, cursor, limit).all<{ id: string; object_key: string }>()).results.map(row => ({ id: row.id, objectKey: row.object_key }));
    },
    async claimCleanup(id: string, now: string, pendingBefore: string) {
      return !!await db.prepare(`UPDATE attachment_storage SET state='deleting' WHERE id=? AND ${cleanupCondition} RETURNING id`)
        .bind(id, now, pendingBefore).first();
    }
  };
}
