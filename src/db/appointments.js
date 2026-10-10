const columns = {
  studentId: 'student_id', name: 'name', college: 'college', campus: 'campus', phone: 'phone', social: 'social',
  deviceType: 'device_type', brand: 'brand', deviceModel: 'device_model', serial: 'serial', warranty: 'warranty',
  faultType: 'fault_type', issue: 'issue', liquidDrop: 'liquid_drop', date: 'date', timeSlot: 'time_slot', note: 'note',
  status: 'status', assignedTo: 'assigned_to', repairNote: 'repair_note', createdAt: 'created_at',
  agreementAt: 'agreement_at', agreementVersion: 'agreement_version'
};
function fromRow(row) {
  return row ? { id: row.id, revision: row.revision, ...Object.fromEntries(Object.entries(columns).map(([key, column]) => [key, row[column] ?? ''])) } : null;
}
export function appointmentRepository(db) {
  return {
    async find(id) { return fromRow(await db.prepare('SELECT * FROM appointments WHERE id=?').bind(id).first()); },
    async findQueueEntry(id) {
      return db.prepare('SELECT id,student_id AS studentId,campus,date,time_slot AS timeSlot,created_at AS createdAt,status FROM appointments WHERE id=?').bind(id).first();
    },
    async list(query) {
      const scope = '1=1';
      const scopeArgs = [];
      const where = [scope], args = [...scopeArgs];
      for (const key of ['campus','date']) if (query[key]) { where.push(`${key}=?`); args.push(query[key]); }
      if (query.status === 'pending') where.push("status IN ('pending','awaiting_claim')");
      else if (query.status !== 'all') { where.push('status=?'); args.push(query.status); }
      if (query.q) {
        where.push("(instr(lower(name),?)>0 OR instr(student_id,?)>0 OR instr(id,?)>0 OR instr(lower(device_model),?)>0 OR instr(campus,?)>0)");
        args.push(...Array(5).fill(query.q.toLowerCase()));
      }
      const [items, counts] = await db.batch([
        db.prepare(`SELECT * FROM appointments WHERE ${where.join(' AND ')} ORDER BY created_at DESC,id DESC`).bind(...args),
        db.prepare(`SELECT COUNT(*) AS allCount, COUNT(CASE WHEN status IN ('pending','awaiting_claim') THEN 1 END) AS pending,
          COUNT(CASE WHEN status='in_progress' THEN 1 END) AS in_progress, COUNT(CASE WHEN status='completed' THEN 1 END) AS completed
          FROM appointments WHERE ${scope}`).bind(...scopeArgs)
      ]);
      const { allCount, ...totals } = counts.results[0];
      return { items: items.results.map(fromRow), counts: { all: allCount, ...totals } };
    },
    async create(item) {
      const prefix = `${item.campus === '浑南' ? '1' : '0'}${item.date.replaceAll('-', '')}-`;
      // One D1 statement allocates the ID and runs capacity/uniqueness constraints atomically.
      const row = await db.prepare(`INSERT INTO appointments(id,${Object.values(columns).join(',')},access_token_hash,credential_rotated_at)
        SELECT ? || printf('%02d',COALESCE(MAX(CAST(substr(id,instr(id,'-')+1) AS INTEGER)),0)+1),${Object.keys(columns).map(() => '?').join(',')},?,?
        FROM appointments WHERE campus=? AND date=? RETURNING *`)
        .bind(prefix, ...Object.keys(columns).map(key => key === 'assignedTo' ? item[key] || null : item[key]), item.accessTokenHash,item.credentialRotatedAt,item.campus, item.date).first();
      return fromRow(row);
    },
    async update(item, patch) {
      const fields = [], args = [];
      for (const [key, column] of Object.entries({ status: 'status', assignedTo: 'assigned_to', repairNote: 'repair_note' })) {
        if (patch[key] !== undefined) { fields.push(`${column}=?`); args.push(key === 'assignedTo' ? patch[key] || null : patch[key]); }
      }
      return fromRow(await db.prepare(`UPDATE appointments SET ${fields.join(',')},revision=revision+1 WHERE id=? AND revision=? RETURNING *`).bind(...args, item.id, item.revision).first());
    },
    async exportPage(cursor = null, limit = 200) {
      const where = cursor ? 'WHERE created_at<? OR (created_at=? AND id<?)' : '';
      const args = cursor ? [cursor.createdAt, cursor.createdAt, cursor.id, limit] : [limit];
      return (await db.prepare(`SELECT * FROM appointments ${where} ORDER BY created_at DESC,id DESC LIMIT ?`).bind(...args).all()).results.map(fromRow);
    }
  };
}
