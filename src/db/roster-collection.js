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
    await db.batch([
      guard(record,`EXISTS(SELECT 1 FROM roster_tasks WHERE id=? AND revision=? AND collection_closed_at IS NULL AND julianday(deadline)>julianday(?)) AND COALESCE((SELECT revision FROM roster_submissions WHERE task_id=? AND member_id=?),-1)=?`,[task.id,task.revision,nowIso(),task.id,memberId,input.revision ?? -1]),
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
  async function protectedRosterAssignments(taskId) {
    return list(`SELECT da.member_id AS memberId,da.business_date AS businessDate,da.campus_id AS campusId,da.start_at AS startAt,da.end_at AS endAt,da.duty_type AS dutyType,COALESCE(dr.role_kind,'') AS roleKind
      FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id AND rv.status='published'
      LEFT JOIN duty_roles dr ON dr.assignment_id=da.id WHERE rv.task_id=? AND (da.business_date<? OR EXISTS (
        SELECT 1 FROM attendance_records ar JOIN attendance_events ae ON ae.id=ar.event_id WHERE ar.member_id=da.member_id AND ae.business_date=da.business_date AND ae.campus_id=da.campus_id AND ae.type='duty'))`,taskId,dateKey());
  }
  async function addRosterParticipants(task,input,record) {
    await db.batch([guard(record,'EXISTS(SELECT 1 FROM roster_tasks WHERE id=? AND revision=?)',[task.id,input.revision]),receipt(record,'participants',task.id,input),
      db.prepare('UPDATE roster_tasks SET member_ids=?,revision=revision+1 WHERE id=? AND revision=?').bind(JSON.stringify([...new Set([...task.memberIds,...input.memberIds])].sort()),task.id,input.revision),
      audit(record,'rosters.participants.added',task.id,input),db.prepare('DELETE FROM roster_command_guards')]);
  }
  async function rosterSeries(id) {return db.prepare('SELECT * FROM roster_collection_series WHERE id=?').bind(id).first();}
  async function dueRosterSeries(at) {return list('SELECT * FROM roster_collection_series WHERE enabled=1 AND julianday(next_publish_at)<=julianday(?) ORDER BY next_publish_at LIMIT 20',at);}
  async function advanceRosterSeries(series,nextWeek,nextPublishAt,error='') {
    await db.prepare('UPDATE roster_collection_series SET next_week=?,next_publish_at=?,last_error=?,revision=revision+1 WHERE id=? AND revision=?').bind(nextWeek,nextPublishAt,error,series.id,series.revision).run();
  }
  async function updateRosterSeries(series,input,record) {
    await db.batch([guard(record,'EXISTS(SELECT 1 FROM roster_collection_series WHERE id=? AND revision=?)',[series.id,input.revision]),
      db.prepare('UPDATE roster_collection_series SET enabled=?,revision=revision+1,last_error=? WHERE id=? AND revision=?').bind(input.enabled?1:0,'',series.id,input.revision),audit(record,'rosters.series.updated',series.template_task_id,input),db.prepare('DELETE FROM roster_command_guards')]);
  }
  async function rosterPreferences(memberId) {return list('SELECT * FROM roster_availability_preferences WHERE member_id=?',memberId);}
  async function pendingRosterPreferences(taskId) {return list(`SELECT p.* FROM roster_availability_preferences p JOIN roster_tasks t ON t.id=? AND t.duty_type=p.duty_type
    WHERE p.enabled=1 AND NOT EXISTS(SELECT 1 FROM roster_submissions s WHERE s.task_id=t.id AND s.member_id=p.member_id)
    AND (json_array_length(t.member_ids)=0 OR EXISTS(SELECT 1 FROM json_each(t.member_ids) WHERE value=p.member_id))`,taskId);}
  async function disableRosterPreference(memberId,dutyType) {await db.prepare('UPDATE roster_availability_preferences SET enabled=0,revision=revision+1,updated_at=? WHERE member_id=? AND duty_type=?').bind(nowIso(),memberId,dutyType).run();}
  return {rosterAudience,rosterSubmissions,rosterCommandReceipt,changeCollection,replaceRosterAvailability,protectedRosterAssignments,addRosterParticipants,rosterSeries,dueRosterSeries,advanceRosterSeries,updateRosterSeries,rosterPreferences,pendingRosterPreferences,disableRosterPreference,rosterVersionReceipt:receipt,rosterVersionGuard:guard,rosterAudit:audit};
}
