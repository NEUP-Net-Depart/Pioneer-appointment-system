function fromRow(row) {
  return row ? { id: row.id, appointmentId: row.appointment_id, filename: row.filename, mimeType: row.mime_type, size: row.size, createdAt: row.created_at, expiresAt: row.expires_at, objectKey: row.object_key } : null;
}
const cleanupCondition = "(state='deleting' OR (state='complete' AND expires_at<=?) OR (state='pending' AND created_at<=?))";
export function attachmentRepository(db) {
  return {
    async reserve(item, maxBytes) {
      return !!await db.prepare(`INSERT INTO attachment_storage(id,object_key,size,state,created_at,expires_at)
        SELECT ?,?,?,'pending',?,? FROM storage_quota WHERE id=1 AND used_bytes+?<=? RETURNING id`)
        .bind(item.id, item.objectKey, item.size, item.createdAt, item.expiresAt, item.size, maxBytes).first();
    },
    async create(item) {
      const results = await db.batch([
        db.prepare(`INSERT INTO appointment_attachments(id,appointment_id,filename,mime_type,size,object_key,created_at,expires_at)
          SELECT ?,?,?,?,?,?,?,? FROM attachment_storage WHERE id=? AND state='pending' RETURNING *`)
          .bind(item.id, item.appointmentId, item.filename, item.mimeType, item.size, item.objectKey, item.createdAt, item.expiresAt, item.id),
        db.prepare(`UPDATE attachment_storage SET state='complete' WHERE id=? AND state='pending'
          AND EXISTS(SELECT 1 FROM appointment_attachments WHERE id=?)`).bind(item.id, item.id)
      ]);
      const created = fromRow(results[0].results[0]);
      if (!created) throw new Error('Attachment reservation no longer available');
      return created;
    },
    async list(id, now) { return (await db.prepare('SELECT * FROM appointment_attachments WHERE appointment_id=? AND expires_at>? ORDER BY created_at').bind(id, now).all()).results.map(fromRow); },
    async find(id, now) { return fromRow(await db.prepare('SELECT * FROM appointment_attachments WHERE id=? AND expires_at>?').bind(id, now).first()); },
    async markDeleting(id) {
      await db.batch([
        db.prepare("UPDATE attachment_storage SET state='deleting' WHERE id=?").bind(id),
        db.prepare('DELETE FROM appointment_attachments WHERE id=?').bind(id)
      ]);
    },
    async release(id) { await db.prepare('DELETE FROM attachment_storage WHERE id=?').bind(id).run(); },
    async cleanupCandidates(now, pendingBefore, cursor = '', limit = 100) {
      return (await db.prepare(`SELECT id,object_key FROM attachment_storage WHERE ${cleanupCondition} AND id>? ORDER BY id LIMIT ?`)
        .bind(now, pendingBefore, cursor, limit).all()).results.map(row => ({ id: row.id, objectKey: row.object_key }));
    },
    async claimCleanup(id, now, pendingBefore) {
      return !!await db.prepare(`UPDATE attachment_storage SET state='deleting' WHERE id=? AND ${cleanupCondition} RETURNING id`)
        .bind(id, now, pendingBefore).first();
    }
  };
}
