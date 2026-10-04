function fromRow(row) {
  return row ? { id: row.id, appointmentId: row.appointment_id, filename: row.filename, mimeType: row.mime_type, size: row.size, createdAt: row.created_at, objectKey: row.object_key } : null;
}
export function attachmentRepository(db) {
  return {
    async create(item) {
      return fromRow(await db.prepare('INSERT INTO appointment_attachments(id,appointment_id,filename,mime_type,size,object_key,created_at) VALUES (?,?,?,?,?,?,?) RETURNING *')
        .bind(item.id, item.appointmentId, item.filename, item.mimeType, item.size, item.objectKey, item.createdAt).first());
    },
    async list(id) { return (await db.prepare('SELECT * FROM appointment_attachments WHERE appointment_id=? ORDER BY created_at').bind(id).all()).results.map(fromRow); },
    async find(id) { return fromRow(await db.prepare('SELECT * FROM appointment_attachments WHERE id=?').bind(id).first()); }
  };
}
