import { nowIso } from '../platform/time.js';

// The same snapshot used for validation is compared inside the write batch.
// This keeps preview and commands on one business validator without trusting a
// pre-transaction read. A concurrent qualification, leave or roster change makes
// the whole command a no-op; no receipt or partial publication is left behind.
const fingerprintSql = `WITH selected AS (SELECT * FROM duty_assignments WHERE id IN (?,?)),
  period AS (SELECT date(MIN(business_date),'weekday 0','-6 day') AS first FROM selected),
  current AS (SELECT da.* FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id
    WHERE rv.status='published' AND da.business_date BETWEEN (SELECT first FROM period) AND date((SELECT first FROM period),'+6 day'))
  SELECT json_object(
    'original',(SELECT json_group_array(json_array(id,member_id,version_id,revision,origin_assignment_id)) FROM (SELECT * FROM selected ORDER BY id)),
    'assignments',(SELECT json_group_array(json_array(id,version_id,member_id,business_date,campus_id,duty_type,start_at,end_at,revision,origin_assignment_id)) FROM (SELECT * FROM current ORDER BY id)),
    'versions',(SELECT json_group_array(json_array(id,task_id,status,version,rule_version,algorithm_version,input_snapshot_ref,validation_result))
      FROM (SELECT * FROM roster_versions WHERE id IN (SELECT version_id FROM current UNION SELECT version_id FROM selected) ORDER BY id)),
    'roles',(SELECT json_group_array(json_array(id,assignment_id,role_kind,effective_range)) FROM (SELECT * FROM duty_roles WHERE assignment_id IN (SELECT id FROM current) ORDER BY id)),
    'leaves',(SELECT json_group_array(json_array(id,origin_assignment_id,member_id,status,revision)) FROM (SELECT * FROM roster_leave_facts
      WHERE origin_assignment_id IN (SELECT COALESCE(origin_assignment_id,id) FROM current) ORDER BY id)),
    'members',(SELECT json_group_array(json_array(id,name,status,revision)) FROM (SELECT * FROM members WHERE id IN (SELECT member_id FROM selected) ORDER BY id)),
    'accounts',(SELECT json_group_array(json_array(account,member_id,status,auth_version)) FROM (SELECT * FROM staff_accounts WHERE member_id IN (SELECT member_id FROM selected) ORDER BY account)),
    'campuses',(SELECT json_group_array(json_array(account,campus)) FROM (SELECT * FROM staff_campus_grants WHERE account IN (SELECT account FROM staff_accounts WHERE member_id IN (SELECT member_id FROM selected)) ORDER BY account,campus)),
    'profiles',(SELECT json_group_array(json_array(id,member_id,profile_code,effective_from,effective_to,revision)) FROM (SELECT * FROM member_work_profiles WHERE member_id IN (SELECT member_id FROM selected) ORDER BY id))
  ) AS fingerprint`;

const storedResultSql = `SELECT json_object('id',id,'from_assignment_id',from_assignment_id,'to_assignment_id',to_assignment_id,
  'from_member_id',from_member_id,'to_member_id',to_member_id,'from_revision',from_revision,'to_revision',to_revision,
  'note',note,'status',status,'revision',revision,'created_at',created_at,'decided_at',decided_at,
  'applied_from_assignment_id',applied_from_assignment_id,'applied_to_assignment_id',applied_to_assignment_id) FROM swap_requests WHERE id=?`;

export function rosterSwapCommands(db, { auditStatement, commandAuthorization }) {
  async function swapFingerprint(fromId, toId) {
    return (await db.prepare(fingerprintSql).bind(fromId,toId).first()).fingerprint;
  }
  function command(audit, receipt, guard, guardArgs) {
    const marker = JSON.stringify({ command: crypto.randomUUID() }), at = nowIso();
    const authorization = commandAuthorization(audit);
    const key = [audit.actorMemberId,receipt.action,receipt.id,receipt.hash,marker];
    const gate = `EXISTS(SELECT 1 FROM operation_receipts WHERE actor_member_id=? AND action=? AND request_id=? AND payload_hash=? AND resource_ref=? AND result_status='pending')`;
    const statements = [db.prepare(`INSERT OR IGNORE INTO operation_receipts(actor_member_id,action,request_id,payload_hash,resource_ref,result_json,result_status,created_at)
      SELECT ?,?,?,?,?, '{}','pending',? WHERE ${guard} ${authorization.sql}`)
      .bind(...key,at,...guardArgs,...authorization.args)];
    const finish = id => statements.push(db.prepare(`UPDATE operation_receipts SET result_status='success',resource_ref=?,result_json=(${storedResultSql})
      WHERE actor_member_id=? AND action=? AND request_id=? AND payload_hash=? AND resource_ref=? AND result_status='pending'`)
      .bind(JSON.stringify({ module:'rosters',type:'swap',id }),id,...key));
    return { at, key, gate, statements, finish };
  }
  async function createSwap(input, audit, receipt, snapshot) {
    const id = crypto.randomUUID();
    const state = command(audit,receipt,`(${fingerprintSql})=? AND NOT EXISTS(
      SELECT 1 FROM swap_requests s JOIN duty_assignments a ON a.id=s.from_assignment_id JOIN duty_assignments b ON b.id=s.to_assignment_id
      WHERE s.status='pending' AND ((COALESCE(a.origin_assignment_id,a.id)=? AND COALESCE(b.origin_assignment_id,b.id)=?)
        OR (COALESCE(a.origin_assignment_id,a.id)=? AND COALESCE(b.origin_assignment_id,b.id)=?)))`,
    [input.fromAssignmentId,input.toAssignmentId,snapshot.fingerprint,
      snapshot.from.originAssignmentId || snapshot.from.id,snapshot.to.originAssignmentId || snapshot.to.id,
      snapshot.to.originAssignmentId || snapshot.to.id,snapshot.from.originAssignmentId || snapshot.from.id]);
    state.statements.push(db.prepare(`INSERT INTO swap_requests(id,from_assignment_id,to_assignment_id,from_member_id,to_member_id,from_revision,to_revision,note,created_at)
      SELECT ?,?,?,?,?,?,?,?,? WHERE ${state.gate}`)
      .bind(id,input.fromAssignmentId,input.toAssignmentId,audit.actorMemberId,input.toMemberId,input.fromRevision,input.toRevision,input.note,state.at,...state.key));
    state.statements.push(auditStatement({ ...audit,sourceRef:{ module:'rosters',type:'swap',id },after:{ ...input,id,status:'pending' } },true));
    state.finish(id);
    const results = await db.batch(state.statements);
    return results[0]?.meta?.changes ? db.prepare('SELECT * FROM swap_requests WHERE id=?').bind(id).first() : null;
  }
  async function updateSwap(request, status, revision, audit, receipt, snapshot) {
    const guard = `EXISTS(SELECT 1 FROM swap_requests WHERE id=? AND to_member_id=? AND status='pending' AND revision=?)`;
    const state = command(audit,receipt,`${guard}${status === 'accepted' ? ` AND (${fingerprintSql})=?` : ''}`,
      [request.id,audit.actorMemberId,revision,...(status === 'accepted' ? [request.from_assignment_id,request.to_assignment_id,snapshot.fingerprint] : [])]);
    let appliedFrom = null, appliedTo = null;
    if (status === 'accepted') {
      const { from,to } = snapshot;
      appliedFrom = crypto.randomUUID(); appliedTo = crypto.randomUUID();
      const versions = new Map([...new Set([from.versionId,to.versionId])].map(id => [id,crypto.randomUUID()]));
      for (const [oldId,newId] of versions) {
        state.statements.push(db.prepare(`INSERT INTO roster_versions(id,task_id,status,version,rule_version,algorithm_version,input_snapshot_ref,solver_status,validation_result,created_at)
          SELECT ?,rv.task_id,'draft',(SELECT MAX(v.version)+1 FROM roster_versions v WHERE v.task_id=rv.task_id),rv.rule_version,'mutual-swap-v1',
            json_set(rv.input_snapshot_ref,'$.swapRequestId',?,'$.previousVersionId',rv.id),'feasible',?,? FROM roster_versions rv WHERE rv.id=? AND ${state.gate}`)
          .bind(newId,request.id,JSON.stringify({ valid:true,swapRequestId:request.id }),state.at,oldId,...state.key));
        state.statements.push(db.prepare(`INSERT INTO duty_assignments(id,version_id,member_id,business_date,campus_id,duty_type,start_at,end_at,revision,origin_assignment_id,previous_assignment_id)
          SELECT CASE da.id WHEN ? THEN ? WHEN ? THEN ? ELSE lower(hex(randomblob(16))) END,?,
            CASE da.id WHEN ? THEN ? WHEN ? THEN ? ELSE da.member_id END,da.business_date,da.campus_id,da.duty_type,da.start_at,da.end_at,
            da.revision+CASE WHEN da.id IN (?,?) THEN 1 ELSE 0 END,
            CASE WHEN da.id IN (?,?) THEN NULL ELSE COALESCE(da.origin_assignment_id,da.id) END,da.id
          FROM duty_assignments da WHERE da.version_id=? AND ${state.gate}`)
          .bind(from.id,appliedFrom,to.id,appliedTo,newId,from.id,to.memberId,to.id,from.memberId,from.id,to.id,from.id,to.id,oldId,...state.key));
        state.statements.push(db.prepare(`INSERT INTO duty_roles(id,assignment_id,role_kind,effective_range)
          SELECT lower(hex(randomblob(16))),next.id,dr.role_kind,dr.effective_range FROM duty_assignments next JOIN duty_roles dr ON dr.assignment_id=next.previous_assignment_id
          WHERE next.version_id=? AND next.previous_assignment_id NOT IN (?,?) AND ${state.gate}`).bind(newId,from.id,to.id,...state.key));
      }
      for (const [index,id] of [appliedFrom,appliedTo].entries()) if (snapshot.after[index].roleKind) {
        state.statements.push(db.prepare(`INSERT INTO duty_roles(id,assignment_id,role_kind) SELECT ?,?,? WHERE ${state.gate}`)
          .bind(crypto.randomUUID(),id,snapshot.after[index].roleKind,...state.key));
      }
      // Supersede both sources before either successor is published. Otherwise
      // the publication trigger would see a false conflict across source tasks.
      for (const oldId of versions.keys()) state.statements.push(db.prepare(`UPDATE roster_versions SET status='superseded' WHERE id=? AND status='published' AND ${state.gate}`).bind(oldId,...state.key));
      for (const newId of versions.values()) state.statements.push(db.prepare(`UPDATE roster_versions SET status='published',published_at=? WHERE id=? AND status='draft' AND ${state.gate}`).bind(state.at,newId,...state.key));
    }
    state.statements.push(db.prepare(`UPDATE swap_requests SET status=?,revision=revision+1,decided_at=?,applied_from_assignment_id=?,applied_to_assignment_id=?
      WHERE id=? AND status='pending' AND revision=? AND ${state.gate}`).bind(status,state.at,appliedFrom,appliedTo,request.id,revision,...state.key));
    state.statements.push(auditStatement({ ...audit,sourceRef:{ module:'rosters',type:'swap',id:request.id },
      after:{ status,appliedFromAssignmentId:appliedFrom,appliedToAssignmentId:appliedTo } },true));
    state.finish(request.id);
    const results = await db.batch(state.statements);
    return results[0]?.meta?.changes ? db.prepare('SELECT * FROM swap_requests WHERE id=?').bind(request.id).first() : null;
  }
  return { swapFingerprint,createSwap,updateSwap };
}
