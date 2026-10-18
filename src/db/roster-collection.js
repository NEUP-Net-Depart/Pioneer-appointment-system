import { dateKey, nowIso } from '../platform/time.js';

export function rosterCollectionRepository(db) {
  const list = async (sql,...args) => (await db.prepare(sql).bind(...args).all()).results || [];
  async function rosterAudience() {
    return (await list("SELECT DISTINCT m.id FROM members m JOIN staff_accounts a ON a.member_id=m.id WHERE m.status='active' AND a.status='enabled' ORDER BY m.id")).map(row=>row.id);
  }
  async function rosterSubmissions(taskId) {
    return list('SELECT member_id AS memberId,revision,submitted_at AS submittedAt,unavailable,source FROM roster_submissions WHERE task_id=?',taskId);
  }
  async function rosterCommandReceipt(actor,command,requestId) {
    return db.prepare('SELECT resource_id AS resourceId,payload FROM roster_command_receipts WHERE actor_member_id=? AND command=? AND request_id=?').bind(actor,command,requestId).first();
  }
  function receipt(record,command,resource,payload) {
    return db.prepare('INSERT INTO roster_command_receipts(request_id,actor_member_id,command,resource_id,payload,created_at) VALUES(?,?,?,?,?,?)')
      .bind(record.requestId,record.actorMemberId,command,resource,JSON.stringify(payload),nowIso());
  }
  function guard(record,condition,args) {
    return db.prepare(`INSERT INTO roster_command_guards(id,valid) SELECT ?,CASE WHEN (${condition}) AND EXISTS(SELECT 1 FROM staff_accounts a JOIN members m ON m.id=a.member_id WHERE member_id=? AND a.status='enabled' AND m.status='active' AND auth_version=?) THEN 1 ELSE 0 END`)
      .bind(crypto.randomUUID(),...args,record.actorMemberId,record.authVersion);
  }
  function audit(record,action,resource,after) {
    return db.prepare(`INSERT INTO audit_events(id,actor_member_id,actor_account,action,source_ref,before_json,after_json,request_id,occurred_at) VALUES(?,?,?,?,?,'{}',?,?,?)`)
      .bind(crypto.randomUUID(),record.actorMemberId,record.actorAccount,action,JSON.stringify({module:'rosters',type:'task',id:resource}),JSON.stringify(after),record.requestId,nowIso());
  }
  async function changeCollection(task,input,record) {
    const reopen=input.action==='reopen',closedAt=reopen ? null : nowIso();
    await db.batch([
      guard(record,'EXISTS(SELECT 1 FROM roster_tasks WHERE id=? AND revision=?)',[task.id,input.revision]),
      receipt(record,'collection',task.id,input),
      db.prepare('UPDATE roster_tasks SET collection_closed_at=?,deadline=?,revision=revision+1 WHERE id=? AND revision=?').bind(closedAt,reopen ? input.deadline : task.deadline,task.id,input.revision),
      audit(record,reopen ? 'rosters.collection.reopened' : 'rosters.collection.closed',task.id,input),
      db.prepare('DELETE FROM roster_command_guards')
    ]);
  }
  async function replaceRosterAvailability(task,memberId,input,record) {
    const current=await db.prepare('SELECT revision FROM roster_submissions WHERE task_id=? AND member_id=?').bind(task.id,memberId).first();
    const retrospective=input.carried&&record.continuationClosed;
    await db.batch([
      guard(record,`EXISTS(SELECT 1 FROM roster_tasks WHERE id=? AND revision=? ${retrospective?'':'AND collection_closed_at IS NULL AND julianday(deadline)>julianday(?)'}) AND COALESCE((SELECT revision FROM roster_submissions WHERE task_id=? AND member_id=?),-1)=?`,[task.id,task.revision,...(retrospective?[]:[nowIso()]),task.id,memberId,input.revision ?? -1]),
      ...(input.carried ? [guard(record,retrospective?`EXISTS(SELECT 1 FROM roster_preference_history h WHERE member_id=? AND duty_type=? AND enabled=1 AND revision=? AND julianday(updated_at)<=julianday(?) AND NOT EXISTS(SELECT 1 FROM roster_preference_history newer WHERE newer.member_id=h.member_id AND newer.duty_type=h.duty_type AND newer.revision>h.revision AND julianday(newer.updated_at)<=julianday(?)))`:'EXISTS(SELECT 1 FROM roster_availability_preferences WHERE member_id=? AND duty_type=? AND enabled=1 AND revision=?)',[memberId,task.dutyType,record.preferenceRevision ?? -1,...(retrospective?[record.continuationAt,record.continuationAt]:[])])] : []),
      receipt(record,'availability',task.id,input),
      db.prepare('DELETE FROM availability WHERE task_id=? AND member_id=?').bind(task.id,memberId),
      ...input.windows.map(window=>db.prepare('INSERT INTO availability(id,task_id,member_id,business_date,start_at,end_at,campus_id) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),task.id,memberId,window.businessDate,window.startAt,window.endAt,window.campusId)),
      db.prepare('INSERT INTO roster_submissions(task_id,member_id,revision,submitted_at,unavailable,source) VALUES(?,?,?,?,?,?) ON CONFLICT(task_id,member_id) DO UPDATE SET revision=excluded.revision,submitted_at=excluded.submitted_at,unavailable=excluded.unavailable,source=excluded.source')
        .bind(task.id,memberId,(current?.revision ?? -1)+1,nowIso(),input.unavailable ? 1 : 0,input.carried ? 'carried':'manual'),
      ...(!input.carried&&typeof input.autoContinue==='boolean' ? [db.prepare(`INSERT INTO roster_availability_preferences(member_id,duty_type,enabled,windows,unavailable,source_task_id,updated_at) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(member_id,duty_type) DO UPDATE SET enabled=excluded.enabled,windows=excluded.windows,unavailable=excluded.unavailable,source_task_id=excluded.source_task_id,revision=roster_availability_preferences.revision+1,updated_at=excluded.updated_at`)
        .bind(memberId,task.dutyType,input.autoContinue?1:0,JSON.stringify(input.windows.map(window=>({...window,weekday:new Date(`${window.businessDate}T12:00:00Z`).getUTCDay(),businessDate:undefined}))),input.unavailable?1:0,task.id,nowIso())] : []),
      audit(record,'rosters.availability.submitted',task.id,{memberId,...input}),
      db.prepare('DELETE FROM roster_command_guards')
    ]);
  }
  async function protectedRosterAssignments(taskId, weekStart) {
    return list(`SELECT da.member_id AS memberId,da.business_date AS businessDate,da.campus_id AS campusId,da.start_at AS startAt,da.end_at AS endAt,da.duty_type AS dutyType,COALESCE(dr.role_kind,'') AS roleKind
      FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id AND rv.status='published'
      LEFT JOIN duty_roles dr ON dr.assignment_id=da.id WHERE ${weekStart ? "da.business_date BETWEEN ? AND date(?,'+6 day')" : 'rv.task_id=?'} AND (da.business_date<? OR EXISTS (
        SELECT 1 FROM attendance_records ar JOIN attendance_events ae ON ae.id=ar.event_id WHERE ar.member_id=da.member_id AND ae.business_date=da.business_date AND ae.campus_id=da.campus_id AND ae.type='duty'))`,...(weekStart ? [weekStart,weekStart] : [taskId]),dateKey());
  }
  async function addRosterParticipants(task,input,record) {
    await db.batch([guard(record,'EXISTS(SELECT 1 FROM roster_tasks WHERE id=? AND revision=?)',[task.id,input.revision]),receipt(record,'participants',task.id,input),
      db.prepare('UPDATE roster_tasks SET member_ids=?,revision=revision+1 WHERE id=? AND revision=?').bind(JSON.stringify([...new Set([...task.memberIds,...input.memberIds])].sort()),task.id,input.revision),
      audit(record,'rosters.participants.added',task.id,input),db.prepare('DELETE FROM roster_command_guards')]);
  }
  async function rosterSeries(id) {return db.prepare('SELECT * FROM roster_collection_series WHERE id=?').bind(id).first();}
  async function updateRosterSeries(series,input,record) {
    const recurrence=input.recurrence;
    await db.batch([guard(record,'EXISTS(SELECT 1 FROM roster_collection_series WHERE id=? AND revision=?) AND EXISTS(SELECT 1 FROM roster_tasks WHERE id=? AND revision=?)',[series.id,input.revision,input.templateTaskId,input.templateRevision]),
      receipt(record,'series',series.id,{signature:input.signature}),
      db.prepare('UPDATE roster_collection_series SET enabled=?,name=?,template_task_id=?,owner_member_id=?,publish_weekday=?,publish_time=?,deadline_weekday=?,deadline_time=?,revision=revision+1,last_error=? WHERE id=? AND revision=?')
        .bind(input.enabled?1:0,input.name,input.templateTaskId,record.actorMemberId,recurrence.publishWeekday,recurrence.publishTime,recurrence.deadlineWeekday,recurrence.deadlineTime,'',series.id,input.revision),
      audit(record,'rosters.series.updated',series.template_task_id,{...input,signature:undefined}),db.prepare('DELETE FROM roster_command_guards')]);
  }
  async function rosterPreferences(memberId) {return list('SELECT * FROM roster_availability_preferences WHERE member_id=?',memberId);}
  async function pendingRosterPreferences(taskId,at=nowIso()) {return list(`SELECT p.* FROM roster_preference_history p JOIN roster_tasks t ON t.id=? AND t.duty_type=p.duty_type JOIN roster_tasks origin ON origin.id=p.source_task_id AND origin.week_start<t.week_start
    WHERE p.enabled=1 AND NOT EXISTS(SELECT 1 FROM roster_submissions s WHERE s.task_id=t.id AND s.member_id=p.member_id)
    AND julianday(p.updated_at)<=julianday(?) AND NOT EXISTS(SELECT 1 FROM roster_preference_history newer WHERE newer.member_id=p.member_id AND newer.duty_type=p.duty_type AND newer.revision>p.revision AND julianday(newer.updated_at)<=julianday(?))
    AND (json_array_length(t.member_ids)=0 OR EXISTS(SELECT 1 FROM json_each(t.member_ids) WHERE value=p.member_id))`,taskId,at,at);}
  async function disableRosterPreference(memberId,dutyType) {await db.prepare('UPDATE roster_availability_preferences SET enabled=0,revision=revision+1,updated_at=? WHERE member_id=? AND duty_type=?').bind(nowIso(),memberId,dutyType).run();}
  return {rosterAudience,rosterSubmissions,rosterCommandReceipt,changeCollection,replaceRosterAvailability,protectedRosterAssignments,addRosterParticipants,rosterSeries,updateRosterSeries,rosterPreferences,pendingRosterPreferences,disableRosterPreference,rosterVersionReceipt:receipt,rosterVersionGuard:guard,rosterAudit:audit};
}
