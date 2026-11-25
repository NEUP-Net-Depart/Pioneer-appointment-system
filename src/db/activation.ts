import type { StaffRole } from '../../shared/staff-types.ts';
import type { SqlGuard } from './records.ts';

export type WhitelistStatus = 'open' | 'revoked' | 'activated';
type ReviewStatus = 'approved' | 'rejected';
type ApplicationStatus = 'pending' | ReviewStatus;

interface WhitelistRow {
  student_id: string;
  expected_name: string;
  expected_role: StaffRole;
  activation_member_id: string | null;
  status: WhitelistStatus;
  campuses: string;
  revision: number;
  created_at: string;
}

interface ApplicationRow extends Pick<WhitelistRow, 'student_id' | 'expected_role' | 'expected_name' | 'campuses' | 'created_at'> {
  id: string;
  name: string;
  home_campus: string;
  status: ApplicationStatus;
  review_note: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  whitelist_status: WhitelistStatus;
  whitelist_revision: number;
}

type ActivationGuard = SqlGuard & { value: string };
type RoleVersions = readonly { id: string; revision: number; enabled: boolean }[];
interface ActivationReviewGuard {
  snapshot: ActivationGuard;
  roleVersions: RoleVersions;
}
interface WhitelistUpdate {
  studentId: string;
  memberId: string;
  expectedName: string;
  expectedRole: StaffRole;
  authorizedCampuses: string[];
}

interface ActivationSubmission {
  id: string;
  studentId: string;
  name: string;
  homeCampus: string;
  passwordHash: string;
  receiptHash: string;
  createdAt: string;
}

import type { Database } from '../platform/environment.ts';
const whitelistSelect=`SELECT w.*,(SELECT member_id FROM activation_member_bindings WHERE student_id=w.student_id) AS activation_member_id,
  (SELECT json_group_array(campus) FROM whitelist_campus_grants WHERE student_id=w.student_id) AS campuses FROM staff_whitelist w`;
const requestSelect=`SELECT r.*,w.expected_role,w.expected_name,w.status AS whitelist_status,w.revision AS whitelist_revision,
  (SELECT json_group_array(campus) FROM whitelist_campus_grants WHERE student_id=r.student_id) AS campuses
  FROM activation_requests r JOIN staff_whitelist w ON w.student_id=r.student_id`;
function whitelist(row: WhitelistRow) {
  return {studentId:row.student_id,expectedName:row.expected_name,expectedRole:row.expected_role,activationMemberId:row.activation_member_id || null,status:row.status,authorizedCampuses: JSON.parse(row.campuses) as string[],revision:row.revision,createdAt:row.created_at};
}
function application(row: ApplicationRow) {
  return {id:row.id,studentId:row.student_id,name:row.name,homeCampus:row.home_campus,
    status:row.status,reviewNote:row.review_note,reviewedBy:row.reviewed_by,reviewedAt:row.reviewed_at,createdAt:row.created_at,
    expectedRole:row.expected_role,expectedName:row.expected_name,authorizedCampuses: JSON.parse(row.campuses) as string[],
    whitelistStatus:row.whitelist_status,whitelistRevision:row.whitelist_revision};
}
export function activationRepository(db: Database){
  return {
    async configureMemberWhitelist(item: WhitelistUpdate, actor: { actorAccount: string; actorMemberId: string; authVersion: number }, guard: ActivationGuard, roleVersions: RoleVersions, instant: string){
      await db.batch([
        db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM staff_accounts a JOIN members m ON m.id=a.member_id
          WHERE a.account=? AND a.member_id=? AND a.auth_version=? AND a.status='enabled' AND m.status='active')
          AND (${guard.sql})=? AND NOT EXISTS(SELECT 1 FROM json_each(?) v LEFT JOIN roles r ON r.id=json_extract(v.value,'$.id')
            WHERE r.id IS NULL OR r.revision<>json_extract(v.value,'$.revision') OR r.enabled<>json_extract(v.value,'$.enabled'))
          THEN 1 ELSE abs(-9223372036854775808) END`)
          .bind(actor.actorAccount,actor.actorMemberId,actor.authVersion,...guard.args,guard.value,JSON.stringify(roleVersions)),
        db.prepare(`INSERT INTO staff_whitelist(student_id,expected_name,expected_role,created_by,created_at) VALUES(?,?,?,?,?)
          ON CONFLICT(student_id) DO UPDATE SET expected_name=excluded.expected_name,expected_role=excluded.expected_role,status='open',revision=staff_whitelist.revision+1`)
          .bind(item.studentId,item.expectedName,item.expectedRole,actor.actorAccount,instant),
        db.prepare('INSERT OR IGNORE INTO activation_member_bindings(student_id,member_id) VALUES(?,?)').bind(item.studentId,item.memberId),
        db.prepare('DELETE FROM whitelist_campus_grants WHERE student_id=?').bind(item.studentId),
        ...item.authorizedCampuses.map(campus=>db.prepare('INSERT INTO whitelist_campus_grants(student_id,campus) VALUES(?,?)').bind(item.studentId,campus)),
        db.prepare("UPDATE activation_requests SET status='rejected',password_hash='',review_note='人员姓名已更新，请重新提交激活申请',reviewed_by=?,reviewed_at=? WHERE student_id=? AND status='pending' AND name<>?")
          .bind(actor.actorAccount,instant,item.studentId,item.expectedName),
        db.prepare(`INSERT INTO audit_events(id,actor_member_id,actor_account,action,source_ref,after_json,occurred_at)
          VALUES(?,?,?,'authorization.member_activation.updated',?,?,?)`)
          .bind(crypto.randomUUID(),actor.actorMemberId,actor.actorAccount,JSON.stringify({module:'identity',type:'member',id:item.memberId}),JSON.stringify(item),instant)
      ]);
    },
    async findWhitelist(id: string) { const row = await db.prepare(`${whitelistSelect} WHERE w.student_id=?`).bind(id).first<WhitelistRow>(); return row ? whitelist(row) : null; },
    async listWhitelist(){return (await db.prepare(`${whitelistSelect} ORDER BY w.created_at DESC,w.student_id`).all<WhitelistRow>()).results.map(whitelist);},
    async changeWhitelist(target: { studentId: string; revision: number }, status: Exclude<WhitelistStatus, 'activated'>, actor: string, instant: string){
      const statements=[];
      if(status==='revoked')statements.push(db.prepare(`UPDATE activation_requests SET status='rejected',password_hash='',review_note='白名单资格已撤销',reviewed_by=?,reviewed_at=?
        WHERE student_id=? AND status='pending' AND EXISTS(SELECT 1 FROM staff_whitelist WHERE student_id=? AND revision=?)`)
        .bind(actor,instant,target.studentId,target.studentId,target.revision));
      statements.push(db.prepare("UPDATE staff_whitelist SET status=?,revision=revision+1 WHERE student_id=? AND revision=? AND status<>'activated' RETURNING student_id")
        .bind(status,target.studentId,target.revision));
      const results=await db.batch(statements);return (results.at(-1)?.results.length ?? 0) > 0;
    },
    async submit(input: ActivationSubmission, whitelistRevision: number){
      const row=await db.prepare(`INSERT INTO activation_requests(id,student_id,name,home_campus,contact,password_hash,receipt_hash,created_at)
        SELECT ?,?,?,?,'',?,?,? FROM staff_whitelist w WHERE student_id=? AND status='open' AND revision=?
        AND NOT EXISTS(SELECT 1 FROM staff_accounts WHERE account=w.student_id) RETURNING id`)
        .bind(input.id,input.studentId,input.name,input.homeCampus,input.passwordHash,input.receiptHash,input.createdAt,input.studentId,whitelistRevision).first<{ id: string }>();
      return row?.id;
    },
    async publicStatus(id: string, receiptHash: string){
      return db.prepare('SELECT id,status,review_note AS reviewNote,reviewed_at AS reviewedAt FROM activation_requests WHERE id=? AND receipt_hash=?').bind(id,receiptHash).first<{ id: string; status: ApplicationStatus; reviewNote: string; reviewedAt: string | null }>();
    },
    async findRequest(id: string) { const row = await db.prepare(`${requestSelect} WHERE r.id=?`).bind(id).first<ApplicationRow>(); return row ? application(row) : null; },
    async listRequests(){return (await db.prepare(`${requestSelect} ORDER BY r.created_at DESC,r.id`).all<ApplicationRow>()).results.map(application);},
    async review(items: { id: string; studentId: string; whitelistRevision: number }[], status: ReviewStatus, note: string, actor: string, instant: string, guards: ActivationReviewGuard[] = [], authorization?: { memberId: string; authVersion: number }){
      const checks=[];
      if(authorization)checks.push(db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM staff_accounts a JOIN members m ON m.id=a.member_id WHERE a.account=? AND a.member_id=? AND a.auth_version=? AND a.status='enabled' AND m.status='active') THEN 1 ELSE abs(-9223372036854775808) END`).bind(actor,authorization.memberId,authorization.authVersion));
      for(const guard of guards) checks.push(db.prepare(`SELECT CASE WHEN (${guard.snapshot.sql})=? AND NOT EXISTS(SELECT 1 FROM json_each(?) v LEFT JOIN roles r ON r.id=json_extract(v.value,'$.id') WHERE r.id IS NULL OR r.revision<>json_extract(v.value,'$.revision') OR r.enabled<>json_extract(v.value,'$.enabled')) THEN 1 ELSE abs(-9223372036854775808) END`).bind(...guard.snapshot.args,guard.snapshot.value,JSON.stringify(guard.roleVersions)));
      const results=(await db.batch<{ id: string }>([...checks,...items.map(item=>db.prepare(`UPDATE activation_requests
        SET status=?,review_note=?,reviewed_by=?,reviewed_at=?,password_hash=CASE WHEN ?='rejected' THEN '' ELSE password_hash END
        WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM staff_whitelist WHERE student_id=? AND revision=?)
        RETURNING id`).bind(status,note,actor,instant,status,item.id,item.studentId,item.whitelistRevision))])).slice(checks.length);
      return {applied:results.flatMap(result=>result.results.map(row=>row.id)),conflicts:items.filter((_,n)=>!results[n].results.length).map(item=>item.id)};
    }
  };
}
