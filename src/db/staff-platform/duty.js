import { rows, assignment, assignmentLeaveColumn } from './shared.js';

// A publication must use the same personnel, availability, pauses and existing
// assignments that were checked by the service, including other campuses.
const scheduleSnapshotSql = `WITH params AS (SELECT ? campus,? week), people AS (
  SELECT s.member_id FROM staff_accounts s JOIN staff_access_campuses g ON g.account=s.account WHERE g.campus=(SELECT name FROM campuses WHERE id=(SELECT campus FROM params))
), shifts AS (SELECT * FROM duty_assignments WHERE business_date BETWEEN (SELECT week FROM params) AND date((SELECT week FROM params),'+6 day') AND (campus_id=(SELECT campus FROM params) OR member_id IN people))
SELECT json_object(
 'weeks',(SELECT json_group_array(json_array(id,revision)) FROM (SELECT * FROM roster_weeks WHERE campus_id=(SELECT campus FROM params) AND week_start=(SELECT week FROM params) ORDER BY id)),
 'members',(SELECT json_group_array(json_array(m.id,m.revision,m.status,s.account,s.auth_version,s.status)) FROM members m JOIN staff_accounts s ON s.member_id=m.id WHERE m.id IN people ORDER BY m.id),
 'posts',(SELECT json_group_array(json_array(id,revision)) FROM (SELECT * FROM member_department_memberships WHERE member_id IN people ORDER BY id)),
 'departments',(SELECT json_group_array(json_array(id,revision,enabled)) FROM (SELECT * FROM departments ORDER BY id)),
 'access',(SELECT json_group_array(json_array(account,campus)) FROM (SELECT * FROM staff_access_campuses WHERE account IN (SELECT account FROM staff_accounts WHERE member_id IN people) ORDER BY account,campus)),
 'availability',(SELECT json_group_array(json_array(member_id,duty_type,week_start,revision)) FROM (SELECT * FROM member_availability WHERE member_id IN people AND week_start IN ('',(SELECT week FROM params)) ORDER BY member_id,duty_type,week_start)),
 'shifts',(SELECT json_group_array(json_array(id,revision,active)) FROM (SELECT * FROM shifts ORDER BY id)),
 'leaves',(SELECT json_group_array(json_array(id,revision)) FROM (SELECT * FROM roster_leaves WHERE assignment_id IN (SELECT id FROM shifts) ORDER BY id)),
 'pauses',(SELECT json_group_array(json_array(business_date,revision,paused)) FROM (SELECT * FROM service_day_overrides WHERE campus_id=(SELECT campus FROM params) AND business_date BETWEEN (SELECT week FROM params) AND date((SELECT week FROM params),'+6 day') ORDER BY business_date))
) snapshot`;

const daySnapshotSql = `WITH input AS (SELECT ? assignmentId) SELECT json_object(
 'assignment',(SELECT json_group_array(json_array(id,member_id,campus_id,business_date,start_at,end_at,revision,active)) FROM duty_assignments WHERE id=(SELECT assignmentId FROM input)),
 'member',(SELECT json_group_array(json_array(id,revision,status)) FROM members WHERE id=(SELECT member_id FROM duty_assignments WHERE id=(SELECT assignmentId FROM input))),
 'account',(SELECT json_group_array(json_array(account,auth_version,status)) FROM staff_accounts WHERE member_id=(SELECT member_id FROM duty_assignments WHERE id=(SELECT assignmentId FROM input))),
 'access',(SELECT json_group_array(campus) FROM staff_access_campuses WHERE account IN (SELECT account FROM staff_accounts WHERE member_id=(SELECT member_id FROM duty_assignments WHERE id=(SELECT assignmentId FROM input)))),
 'posts',(SELECT json_group_array(json_array(id,revision)) FROM member_department_memberships WHERE member_id=(SELECT member_id FROM duty_assignments WHERE id=(SELECT assignmentId FROM input))),
 'leaves',(SELECT json_group_array(json_array(id,revision)) FROM roster_leaves WHERE assignment_id=(SELECT assignmentId FROM input)),
 'review',(SELECT json_group_array(json_array(member_id,revision)) FROM attendance_reviews WHERE assignment_id=(SELECT assignmentId FROM input)),
 'pause',(SELECT json_group_array(json_array(s.revision,s.paused)) FROM service_day_overrides s JOIN duty_assignments a ON a.campus_id=s.campus_id AND a.business_date=s.business_date WHERE a.id=(SELECT assignmentId FROM input))
) snapshot`;

export function dutyRepository({ db, writeCommand }) {
  const scheduleSnapshot = async (campus, week) =>
    (await db.prepare(scheduleSnapshotSql).bind(campus, week).first()).snapshot;
  const dutySnapshot = async (id) => (await db.prepare(daySnapshotSql).bind(id).first()).snapshot;
  async function dutyDay(day, campus) {
    const result = await db.batch([
      db
        .prepare(
          `SELECT da.*,m.name member_name,c.name campus_name,m.status member_status,${assignmentLeaveColumn},r.decision review_decision,r.member_id review_member_id,r.revision review_revision,r.reason review_reason
        FROM duty_assignments da JOIN members m ON m.id=da.member_id JOIN campuses c ON c.id=da.campus_id
        LEFT JOIN attendance_reviews r ON r.assignment_id=da.id WHERE da.active=1 AND da.business_date=? AND da.campus_id=? ORDER BY m.name,da.start_at,da.id`
        )
        .bind(day, campus),
      db
        .prepare('SELECT * FROM staff_presence WHERE business_date=? AND campus_id=?')
        .bind(day, campus)
    ]);
    return {
      assignments: rows(result[0]).map((row) => ({
        ...assignment(row),
        memberStatus: row.member_status,
        review:
          row.review_revision === null
            ? null
            : {
                decision: row.review_member_id === row.member_id ? row.review_decision : 'cleared',
                revision: row.review_revision,
                reason: row.review_reason
              }
      })),
      presence: rows(result[1])
    };
  }
  async function reviewDuty(item, input, record, snapshot) {
    return writeCommand(
      record,
      `(${daySnapshotSql})=? AND NOT EXISTS(SELECT 1 FROM attendance_records WHERE dedupe_key=?)`,
      [item.id, snapshot, `duty:${item.memberId}:${item.businessDate}`],
      (gate, id) => [
        db
          .prepare(
            `INSERT INTO attendance_reviews(assignment_id,member_id,decision,revision,reason,reviewed_by,reviewed_at)
          SELECT ?,?,?,?,?,?,? WHERE ${gate} ON CONFLICT(assignment_id) DO UPDATE SET member_id=excluded.member_id,decision=excluded.decision,revision=excluded.revision,reason=excluded.reason,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at`
          )
          .bind(
            item.id,
            item.memberId,
            input.decision,
            input.revision + 1,
            input.reason || '',
            record.actorMemberId,
            record.at,
            id
          )
      ]
    );
  }
  async function confirmDuty(item, event, record, snapshot, department, identitySnapshot) {
    const dedupe = `duty:${item.memberId}:${item.businessDate}`;
    const attendanceId = record.result.id;
    return writeCommand(
      record,
      `(${daySnapshotSql})=? AND NOT EXISTS(SELECT 1 FROM attendance_records WHERE dedupe_key=?)
      AND date(?,'+8 hours')=? AND EXISTS(SELECT 1 FROM attendance_events WHERE id=? AND julianday(starts_at)<=julianday(?) AND julianday(ends_at)>=julianday(?))`,
      [item.id, snapshot, dedupe, record.at, item.businessDate, event.id, record.at, record.at],
      (gate, id) => [
        db
          .prepare(
            `INSERT INTO attendance_records(id,member_id,event_id,dedupe_key,occurred_at,recorded_at,method,source_ref,primary_department_id_snapshot,primary_department_name_snapshot,identity_snapshot,non_scheduled)
          SELECT ?,?,?,?,?,?,'manual',?,?,?,?,0 WHERE ${gate}`
          )
          .bind(
            attendanceId,
            item.memberId,
            event.id,
            dedupe,
            record.at,
            record.at,
            JSON.stringify({ module: 'rosters', type: 'assignment', id: item.id }),
            department?.departmentId || null,
            department?.departmentName || null,
            JSON.stringify(identitySnapshot),
            id
          ),
        db
          .prepare(
            `INSERT INTO staff_presence(member_id,business_date,campus_id,state,revision,updated_at)
          SELECT ?,?,?,'available',0,? WHERE ${gate} ON CONFLICT(member_id,business_date) DO UPDATE SET campus_id=excluded.campus_id,state='available',revision=staff_presence.revision+1,updated_at=excluded.updated_at`
          )
          .bind(item.memberId, item.businessDate, item.campusId, record.at, id),
        db
          .prepare(
            `INSERT INTO presence_events(id,member_id,business_date,from_state,to_state,occurred_at,actor_member_id,actor_account)
          SELECT ?,?,?,NULL,'available',?,?,? WHERE ${gate}`
          )
          .bind(
            crypto.randomUUID(),
            item.memberId,
            item.businessDate,
            record.at,
            record.actorMemberId,
            record.actorAccount,
            id
          )
      ]
    );
  }
  async function ownVolunteerStart(memberId) {
    return (
      await db
        .prepare(
          `SELECT MIN(day) day FROM (
      SELECT e.business_date day FROM attendance_records ar JOIN attendance_events e ON e.id=ar.event_id WHERE ar.member_id=? AND e.type='duty'
      UNION ALL SELECT effective_from FROM member_department_memberships WHERE member_id=?)`
        )
        .bind(memberId, memberId)
        .first()
    ).day;
  }
  return {
    scheduleSnapshot,
    dutySnapshot,
    dutyDay,
    reviewDuty,
    confirmDuty,
    ownVolunteerStart,
    scheduleSnapshotGuard: (campus, week, snapshot) => ({
      sql: `(${scheduleSnapshotSql})=?`,
      args: [campus, week, snapshot]
    })
  };
}
