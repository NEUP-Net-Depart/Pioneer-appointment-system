// A manual correction is a historical fact, not a live arrival. It never
// changes presence, and its fact, audit and retry receipt commit together.
const fingerprintSql = `SELECT json_object(
  'event',(SELECT json_group_array(json_array(id,type,policy_code,policy_version,rule_snapshot,campus_id,business_date,starts_at,ends_at,source_ref,revision)) FROM attendance_events WHERE id=?),
  'member',(SELECT json_group_array(json_array(id,name,student_id,status,revision)) FROM members WHERE id=?),
  'departments',(SELECT json_group_array(json_array(id,department_id,department_name,is_primary,effective_from,effective_to,revision)) FROM
    (SELECT mm.*,d.name AS department_name FROM member_department_memberships mm JOIN departments d ON d.id=mm.department_id
      WHERE member_id=? AND effective_from<=date(?,'+8 hours')
      AND (effective_to IS NULL OR effective_to>date(?,'+8 hours')) ORDER BY mm.id)),
  'duties',(SELECT json_group_array(json_array(id,version_id,revision)) FROM
    (SELECT da.* FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id
      WHERE da.member_id=? AND da.business_date=(SELECT business_date FROM attendance_events WHERE id=?) AND rv.status='published' ORDER BY da.id)),
  'actorDuties',(SELECT json_group_array(json_array(id,version_id,campus_id,duty_type,start_at,end_at,revision,role_kind,effective_range)) FROM
    (SELECT da.*,dr.role_kind,dr.effective_range FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id
      LEFT JOIN duty_roles dr ON dr.assignment_id=da.id WHERE da.member_id=? AND da.business_date=? AND rv.status='published' ORDER BY da.id,dr.id))
) AS fingerprint`;

const snapshotArgs = (memberId,eventId,actorMemberId,businessDate,occurredAt) => [eventId,memberId,memberId,occurredAt,occurredAt,memberId,eventId,actorMemberId,businessDate];
const resultSql = `SELECT json_object('id',ar.id,'memberId',ar.member_id,'eventId',ar.event_id,'dedupeKey',ar.dedupe_key,
  'occurredAt',ar.occurred_at,'recordedAt',ar.recorded_at,'method',ar.method,'sourceRef',json(ar.source_ref),
  'businessDate',e.business_date,'type',e.type,'campusId',e.campus_id,
  'primaryDepartmentIdSnapshot',ar.primary_department_id_snapshot,'primaryDepartmentNameSnapshot',ar.primary_department_name_snapshot,
  'identitySnapshot',json(ar.identity_snapshot),'nonScheduled',json(CASE ar.non_scheduled WHEN 1 THEN 'true' ELSE 'false' END),'revision',ar.revision)
  FROM attendance_records ar JOIN attendance_events e ON e.id=ar.event_id WHERE ar.id=?`;

export function attendanceCorrections(db,{auditStatement,commandAuthorization}) {
  async function attendanceCorrectionFingerprint(memberId,eventId,actorMemberId,businessDate,occurredAt) {
    return (await db.prepare(fingerprintSql).bind(...snapshotArgs(memberId,eventId,actorMemberId,businessDate,occurredAt)).first()).fingerprint;
  }
  async function correctAttendance(record,audit,receipt,fingerprint) {
    const marker = JSON.stringify({command:crypto.randomUUID()});
    const key = [audit.actorMemberId,receipt.action,receipt.id,receipt.hash,marker];
    const authorization = commandAuthorization(audit);
    const gate = `EXISTS(SELECT 1 FROM operation_receipts WHERE actor_member_id=? AND action=? AND request_id=? AND payload_hash=? AND resource_ref=? AND result_status='pending')`;
    const recordGuard=record.previous
      ? {sql:'EXISTS(SELECT 1 FROM attendance_records WHERE id=? AND member_id=? AND event_id=? AND revision=?)',args:[record.id,record.memberId,record.eventId,record.previous.revision]}
      : {sql:'NOT EXISTS(SELECT 1 FROM attendance_records WHERE dedupe_key=?)',args:[record.dedupeKey]};
    const factStatement=record.previous
      ? db.prepare(`UPDATE attendance_records SET occurred_at=?,recorded_at=?,revision=revision+1 WHERE id=? AND revision=? AND ${gate}`)
        .bind(record.occurredAt,record.recordedAt,record.id,record.previous.revision,...key)
      : db.prepare(`INSERT INTO attendance_records(id,member_id,event_id,dedupe_key,occurred_at,recorded_at,method,source_ref,primary_department_id_snapshot,primary_department_name_snapshot,identity_snapshot,non_scheduled)
        SELECT ?,?,?,?,?,?,'manual',?,?,?,?,? WHERE ${gate}`)
        .bind(record.id,record.memberId,record.eventId,record.dedupeKey,record.occurredAt,record.recordedAt,JSON.stringify(record.sourceRef || {}),record.departmentId || null,
          record.departmentName || null,JSON.stringify(record.identitySnapshot),record.nonScheduled ? 1 : 0,...key);
    const statements = [db.prepare(`INSERT OR IGNORE INTO operation_receipts(actor_member_id,action,request_id,payload_hash,resource_ref,result_json,result_status,created_at)
      SELECT ?,?,?,?,?,'{}','pending',? WHERE (${fingerprintSql})=?
      AND ${recordGuard.sql} AND date(?,'+8 hours')=? ${authorization.sql}`)
      .bind(...key,record.recordedAt,...snapshotArgs(record.memberId,record.eventId,audit.actorMemberId,audit.businessDate,record.occurredAt),fingerprint,...recordGuard.args,record.recordedAt,audit.businessDate,...authorization.args),
    factStatement,
    auditStatement({...audit,sourceRef:{module:'attendance',type:'record',id:record.id},before:record.previous || undefined,after:{memberId:record.memberId,eventId:record.eventId,occurredAt:record.occurredAt}},true),
    db.prepare(`UPDATE operation_receipts SET result_status='success',resource_ref=?,result_json=(${resultSql})
      WHERE actor_member_id=? AND action=? AND request_id=? AND payload_hash=? AND resource_ref=? AND result_status='pending'`)
      .bind(JSON.stringify({module:'attendance',type:'record',id:record.id}),record.id,...key)];
    const results = await db.batch(statements);
    if (!results[0]?.meta?.changes) return null;
    return JSON.parse((await db.prepare(`SELECT (${resultSql}) AS result`).bind(record.id).first()).result);
  }
  return {attendanceCorrectionFingerprint,correctAttendance};
}
