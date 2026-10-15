import { scheduleStatement } from './slot-capacities.js';

const columns = {
  studentId: 'student_id', name: 'name', college: 'college', campus: 'campus', phone: 'phone', social: 'social',
  deviceType: 'device_type', brand: 'brand', deviceModel: 'device_model', serial: 'serial', warranty: 'warranty',
  faultType: 'fault_type', issue: 'issue', liquidDrop: 'liquid_drop', date: 'date', timeSlot: 'time_slot', note: 'note',
  status: 'status', assignedTo: 'assigned_to', repairNote: 'repair_note', createdAt: 'created_at',
  outcome: 'outcome', startedAt: 'started_at', completedAt: 'completed_at',
  agreementAt: 'agreement_at', agreementVersion: 'agreement_version', signature: 'signature',
  repairNumber: 'repair_number', frontPhotoId: 'front_photo_id', backPhotoId: 'back_photo_id'
};
function fromRow(row) {
  return row ? { id: row.id, revision: row.revision,
    ...Object.fromEntries(Object.entries(columns).map(([key, column]) => [key, row[column] ?? (['outcome','startedAt','completedAt','repairNumber','frontPhotoId','backPhotoId'].includes(key) ? null : '')])),
    source: row.source || 'booking', registeredBy: row.registered_by || '', registrationKey: row.registration_key || '' } : null;
}
export function appointmentRepository(db) {
  return {
    async schedule(date, campus) {
      return (await scheduleStatement(db, date, date, [campus]).all()).results;
    },
    async currentRepair(account) {
      const row = await db.prepare(`SELECT a.* FROM active_repairs ar JOIN appointments a ON a.id=ar.appointment_id
        WHERE ar.account=? AND a.status='in_progress' LIMIT 1`).bind(account).first();
      return fromRow(row);
    },
    async intakePhotos(id, account, front, back, now) {
      if (!front || !back || front === back) return false;
      const row = await db.prepare(`SELECT COUNT(*) AS total FROM appointment_attachments
        WHERE appointment_id=? AND uploaded_by=? AND expires_at>? AND mime_type LIKE 'image/%'
        AND ((id=? AND purpose='intake_front') OR (id=? AND purpose='intake_back'))`)
        .bind(id, account, now, front, back).first();
      return row.total === 2;
    },
    async countNoShows(beforeDate) {
      return (await db.prepare("SELECT COUNT(*) AS total FROM appointments WHERE source='booking' AND status='booked' AND date<=?").bind(beforeDate).first()).total;
    },
    async endNoShows(beforeDate, instant, { id, campuses } = {}) {
      const where = ["source='booking'", "status='booked'", 'date<=?'], args = [instant, beforeDate];
      if (id) { where.push('id=?'); args.push(id); }
      if (campuses) { where.push(campuses.length ? `campus IN (${campuses.map(() => '?').join(',')})` : '0'); args.push(...campuses); }
      return db.prepare(`UPDATE appointments SET status='completed',outcome='no_show',completed_at=?,revision=revision+1 WHERE ${where.join(' AND ')}`).bind(...args).run();
    },
    async expirePending(beforeDate, instant, scope = {}) {
      const common = (source, outcome) => {
        const where = [`source=?`, "status='booked'", 'date<=?']; const args = [source, beforeDate];
        if (scope.id) { where.push('id=?'); args.push(scope.id); }
        if (scope.campuses) { where.push(scope.campuses.length ? `campus IN (${scope.campuses.map(() => '?').join(',')})` : '0'); args.push(...scope.campuses); }
        return db.prepare(`UPDATE appointments SET status='completed',outcome=?,completed_at=?,revision=revision+1 WHERE ${where.join(' AND ')}`).bind(outcome, instant, ...args);
      };
      const [booking, onsite] = await db.batch([common('booking', 'no_show'), common('onsite', 'expired')]);
      return { meta: { changes: (booking.meta?.changes || 0) + (onsite.meta?.changes || 0) } };
    },
    async find(id) { return fromRow(await db.prepare('SELECT * FROM appointments WHERE id=?').bind(id).first()); },
    async findByCode(code) { return fromRow(await db.prepare('SELECT * FROM appointments WHERE id=? OR repair_number=? LIMIT 1').bind(code,code).first()); },
    async findOnsiteByKey(account, registrationKey) {
      return fromRow(await db.prepare("SELECT * FROM appointments WHERE source='onsite' AND registered_by=? AND registration_key=? LIMIT 1").bind(account,registrationKey).first());
    },
    async createOnsite(item) {
      const values = [item.id, ...Object.keys(columns).map(key => key === 'assignedTo' ? item[key] || null : item[key] ?? null), 'onsite', item.registeredBy, item.registrationKey, item.accessTokenHash, item.credentialRotatedAt];
      const fields = ['id', ...Object.values(columns), 'source', 'registered_by', 'registration_key', 'access_token_hash', 'credential_rotated_at'];
      const row = await db.prepare(`INSERT INTO appointments(${fields.join(',')}) VALUES(${values.map(() => '?').join(',')}) RETURNING *`).bind(...values).first();
      return fromRow(row);
    },
    async findByCredential(id, hash) {
      // A legacy repair number is only an alias; the credential selects its owner
      // even when the same text is another appointment's historical primary key.
      return fromRow(await db.prepare('SELECT * FROM appointments WHERE (id=? OR repair_number=?) AND access_token_hash=?').bind(id,id,hash).first());
    },
    async rotateCredential(item, hash, actor, reason, instant) {
      const results = await db.batch([
        db.prepare(`INSERT INTO credential_recoveries(id,appointment_id,actor,reason,created_at)
          SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM appointments WHERE id=? AND revision=?)`)
          .bind(crypto.randomUUID(),item.id,actor,reason,instant,item.id,item.revision),
        db.prepare('UPDATE appointments SET access_token_hash=?,credential_rotated_at=?,revision=revision+1 WHERE id=? AND revision=? RETURNING id')
          .bind(hash,instant,item.id,item.revision)
      ]);
      return results.at(-1).results.length>0;
    },
    async list(query,{campuses,technician}) {
      const campusScope=campuses.length ? `campus IN (${campuses.map(()=>'?').join(',')})` : '0';
      const scope=campusScope+(technician ? " AND (assigned_to=? OR status='booked')" : '');
      const scopeArgs=[...campuses,...(technician ? [technician] : [])];
      const where = [scope], args = [...scopeArgs];
      for (const [key,column] of [['campus','campus'],['date','date'],['timeSlot','time_slot']]) if (query[key]) { where.push(`${column}=?`); args.push(query[key]); }
      if (query.dateFrom && query.dateTo) { where.push('date>=? AND date<=?'); args.push(query.dateFrom,query.dateTo); }
      if (query.q) {
        where.push("(instr(id,?)>0 OR instr(repair_number,?)>0 OR instr(lower(device_model),?)>0 OR instr(campus,?)>0 OR ((?='' OR (assigned_to=? AND status<>'booked')) AND (instr(lower(name),?)>0 OR instr(student_id,?)>0)))");
        const text=query.q.toLowerCase();
        args.push(text,text,text,text,technician,technician,text,text);
      }
      const filteredWhere = where.join(' AND '), filteredArgs = [...args];
      if (query.status === 'pending') where.push("status IN ('booked','in_progress')");
      else if (query.status !== 'all') { where.push('status=?'); args.push(query.status); }
      // Only fixed expressions reach ORDER BY; query values are validated at the route.
      const sortColumns = { createdAt: ['created_at'], date: ['date','time_slot'], status: ["CASE status WHEN 'booked' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END"], campus: ['campus'] };
      const sorts = query.sorts ?? [{key:query.sort || 'createdAt',direction:query.direction || 'desc'}];
      if (query.sorts === undefined && query.sort === 'campus') sorts.push({key:'date',direction:query.direction || 'desc'});
      const order = sorts.flatMap(item => (sortColumns[item.key] || []).map(column => `${column} ${item.direction === 'asc' ? 'ASC' : 'DESC'}`));
      order.push('created_at DESC','id DESC');
      const [items, counts, filteredCounts] = await db.batch([
        db.prepare(`SELECT * FROM appointments WHERE ${where.join(' AND ')} ORDER BY ${order.join(',')}`).bind(...args),
        db.prepare(`SELECT COUNT(*) AS allCount, COUNT(CASE WHEN status='booked' THEN 1 END) AS booked,
          COUNT(CASE WHEN status='in_progress' THEN 1 END) AS in_progress, COUNT(CASE WHEN status='completed' THEN 1 END) AS completed
          FROM appointments WHERE ${scope}`).bind(...scopeArgs),
        db.prepare(`SELECT COUNT(*) AS allCount, COUNT(CASE WHEN status='booked' THEN 1 END) AS booked,
          COUNT(CASE WHEN status='in_progress' THEN 1 END) AS in_progress, COUNT(CASE WHEN status='completed' THEN 1 END) AS completed
          FROM appointments WHERE ${filteredWhere}`).bind(...filteredArgs)
      ]);
      const { allCount, ...totals } = counts.results[0];
      const { allCount: filteredTotal, ...filteredTotals } = filteredCounts.results[0];
      return { items: items.results.map(fromRow), counts: { all: allCount, ...totals }, filteredCounts: { all: filteredTotal, ...filteredTotals } };
    },
    async overview(start, end, campuses) {
      const scope = campuses.length ? `campus IN (${campuses.map(() => '?').join(',')})` : '0';
      const [totals, capacities] = await db.batch([
        db.prepare(`SELECT campus,date,time_slot,COUNT(*) AS occupied,
          COUNT(CASE WHEN status='booked' THEN 1 END) AS booked,
          COUNT(CASE WHEN status='in_progress' THEN 1 END) AS in_progress
          FROM appointments WHERE ${scope} AND date>=? AND date<=? AND source='booking'
          AND NOT (status='completed' AND outcome='cancelled') GROUP BY campus,date,time_slot`).bind(...campuses,start,end),
        scheduleStatement(db, start, end, campuses)
      ]);
      return { totals: totals.results, capacities: capacities.results };
    },
    async create(item) {
      const suffix = `${item.campus === '浑南' ? '1' : '0'}${item.date.replaceAll('-', '')}-`;
      const prefix = `reserve${suffix}`;
      // One D1 statement allocates the ID and runs capacity/uniqueness constraints atomically.
      // Include historical booking prefixes so their suffixes are never reused.
      const row = await db.prepare(`INSERT INTO appointments(id,${Object.values(columns).join(',')},access_token_hash,credential_rotated_at)
        SELECT ? || printf('%02d',COALESCE(MAX(CAST(substr(id,instr(id,'-')+1) AS INTEGER)),0)+1),${Object.keys(columns).map(() => '?').join(',')},?,?
        FROM appointments WHERE id LIKE ? OR id LIKE ? OR id LIKE ? RETURNING *`)
        .bind(prefix, ...Object.keys(columns).map(key => key === 'assignedTo' ? item[key] || null : item[key] ?? null), item.accessTokenHash,item.credentialRotatedAt,`${prefix}%`,`reverse${suffix}%`,`${suffix}%`).first();
      return fromRow(row);
    },
    async update(item, patch) {
      const fields = [], args = [];
      for (const [key, column] of Object.entries({ status: 'status', assignedTo: 'assigned_to', repairNote: 'repair_note', outcome: 'outcome', startedAt: 'started_at', completedAt: 'completed_at', frontPhotoId: 'front_photo_id', backPhotoId: 'back_photo_id' })) {
        if (patch[key] !== undefined) { fields.push(`${column}=?`); args.push(key === 'assignedTo' ? patch[key] || null : patch[key]); }
      }
      const start = patch.status === 'in_progress' && patch.frontPhotoId && patch.backPhotoId && patch.assignedTo;
      if (!start) return fromRow(await db.prepare(`UPDATE appointments SET ${fields.join(',')},revision=revision+1 WHERE id=? AND revision=? RETURNING *`).bind(...args, item.id, item.revision).first());
      const intakeId = `intake-${item.id}-${item.revision + 1}`;
      const result = await db.batch([
        db.prepare(`UPDATE appointments SET ${fields.join(',')},revision=revision+1 WHERE id=? AND revision=? RETURNING *`).bind(...args, item.id, item.revision),
        db.prepare(`INSERT INTO repair_intake_records(id,appointment_id,member_id,account,front_photo_id,back_photo_id,verified_at)
          SELECT ?,?,(SELECT member_id FROM staff_accounts WHERE account=?),?,?,?,? WHERE changes()>0`).bind(intakeId,item.id,patch.assignedTo,patch.assignedTo,patch.frontPhotoId,patch.backPhotoId,patch.startedAt || new Date().toISOString())
      ]);
      return fromRow(result[0]?.results?.[0]);
    },
    async exportPage(cursor,limit,campuses) {
      const campusScope=campuses.length ? `campus IN (${campuses.map(()=>'?').join(',')})` : '0';
      const where=campusScope+(cursor ? ' AND (created_at<? OR (created_at=? AND id<?))' : '');
      const args=[...campuses,...(cursor ? [cursor.createdAt,cursor.createdAt,cursor.id] : []),limit];
      return (await db.prepare(`SELECT * FROM appointments WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ?`).bind(...args).all()).results.map(fromRow);
    }
  };
}
