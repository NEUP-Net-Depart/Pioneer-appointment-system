import type { DutyAssignmentRow } from './shared.ts';
import type { Database } from '../../platform/environment.ts';
import { rows, assignment } from './shared.ts';

// A publication must use the same personnel, availability, pauses and existing
// assignments that were checked by the service, including other campuses.
const scheduleSnapshotSql = `WITH params AS (SELECT ? campus,? week), people AS (
  SELECT s.member_id FROM staff_accounts s JOIN staff_access_campuses g ON g.account=s.account WHERE g.campus=(SELECT name FROM campuses WHERE id=(SELECT campus FROM params))
), shifts AS (SELECT * FROM duty_assignments WHERE business_date BETWEEN (SELECT week FROM params) AND date((SELECT week FROM params),'+6 day') AND (campus_id=(SELECT campus FROM params) OR member_id IN people))
SELECT json_object(
 'weeks',(SELECT json_group_array(json_array(id,revision)) FROM (SELECT * FROM roster_weeks WHERE campus_id=(SELECT campus FROM params) AND week_start=(SELECT week FROM params) ORDER BY id)),
 'members',(SELECT json_group_array(json_array(m.id,m.revision,m.home_campus_id,m.status,s.account,s.auth_version,s.status)) FROM members m JOIN staff_accounts s ON s.member_id=m.id WHERE m.id IN people ORDER BY m.id),
 'posts',(SELECT json_group_array(json_array(id,revision)) FROM (SELECT * FROM member_department_memberships WHERE member_id IN people ORDER BY id)),
 'departments',(SELECT json_group_array(json_array(id,revision,enabled)) FROM (SELECT * FROM departments ORDER BY id)),
 'access',(SELECT json_group_array(json_array(account,campus)) FROM (SELECT * FROM staff_access_campuses WHERE account IN (SELECT account FROM staff_accounts WHERE member_id IN people) ORDER BY account,campus)),
 'availability',(SELECT json_group_array(json_array(member_id,duty_type,week_start,revision)) FROM (SELECT * FROM member_availability WHERE member_id IN people AND week_start IN ('',(SELECT week FROM params)) ORDER BY member_id,duty_type,week_start)),
 'shifts',(SELECT json_group_array(json_array(id,revision,active)) FROM (SELECT * FROM shifts ORDER BY id)),
 'pauses',(SELECT json_group_array(json_array(campus_id,business_date,revision,paused)) FROM (SELECT * FROM service_day_overrides s WHERE business_date BETWEEN (SELECT week FROM params) AND date((SELECT week FROM params),'+6 day') AND (campus_id=(SELECT campus FROM params) OR EXISTS(SELECT 1 FROM shifts a WHERE a.active=1 AND a.campus_id=s.campus_id AND a.business_date=s.business_date)) ORDER BY campus_id,business_date))
) snapshot`;

export function dutyRepository({ db }: { db: Database }) {
  const scheduleSnapshot = async (campus: string, week: string) => {
    const snapshot = (
      await db.prepare(scheduleSnapshotSql).bind(campus, week).first<{ snapshot: string }>()
    )?.snapshot;
    if (snapshot == null) throw new Error('Missing schedule snapshot');
    return snapshot;
  };
  async function dutyDay(day: string, campus: string, end = day) {
    const result = await db.batch<
      DutyAssignmentRow & { student_id: string | null; member_status: 'active' | 'inactive' }
    >([
      db
        .prepare(
          `SELECT da.*,m.name member_name,m.student_id,c.name campus_name,m.status member_status
        FROM duty_assignments da JOIN members m ON m.id=da.member_id JOIN campuses c ON c.id=da.campus_id
        WHERE da.active=1 AND da.business_date BETWEEN ? AND ? AND da.campus_id=? ORDER BY m.name,da.business_date,da.start_at,da.id`
        )
        .bind(day, end, campus)
    ]);
    return {
      assignments: rows(result[0]).map((row) => ({
        ...assignment(row),
        studentId: row.student_id || '',
        memberStatus: row.member_status
      }))
    };
  }
  async function ownVolunteerStart(memberId: string) {
    return (
      (
        await db
          .prepare(
            `SELECT MIN(day) day FROM (
      SELECT e.business_date day FROM attendance_records ar JOIN attendance_events e ON e.id=ar.event_id WHERE ar.member_id=? AND e.type='duty'
      UNION ALL SELECT effective_from FROM member_department_memberships WHERE member_id=?)`
          )
          .bind(memberId, memberId)
          .first<{ day: string | null }>()
      )?.day ?? null
    );
  }
  return {
    scheduleSnapshot,
    dutyDay,
    ownVolunteerStart,
    scheduleSnapshotGuard: (campus: string, week: string, snapshot: string) => ({
      sql: `(${scheduleSnapshotSql})=?`,
      args: [campus, week, snapshot]
    })
  };
}
