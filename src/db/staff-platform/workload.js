import { rows } from './shared.js';

export function workloadRepository({ db }) {
  async function memberRepairWorkload(memberIds, monthStart, asOf) {
    if (!memberIds.length) return [];
    return rows(
      await db
        .prepare(
          `
        WITH requested AS (SELECT value AS member_id FROM json_each(?)),
        handled AS MATERIALIZED (
          SELECT actor_member_id AS member_id,
            json_extract(source_ref,'$.id') AS appointment_id, occurred_at AS handled_at
          FROM audit_events INDEXED BY idx_audit_events_actor_time
          WHERE actor_member_id IN (SELECT member_id FROM requested)
            AND action IN ('repairs.started','repairs.transferred')
            AND json_extract(source_ref,'$.module')='repairs'
            AND json_extract(source_ref,'$.type')='appointment'
            AND json_extract(source_ref,'$.id') IS NOT NULL
            AND julianday(occurred_at)<=julianday(?)
        ), known AS (
          SELECT member_id,appointment_id,handled_at FROM handled
          UNION ALL
          SELECT s.member_id,a.id,a.started_at
          FROM staff_accounts s JOIN appointments a ON a.assigned_to=s.account
          WHERE s.member_id IN (SELECT member_id FROM requested)
            AND a.started_at IS NOT NULL AND julianday(a.started_at)<=julianday(?)
            AND NOT EXISTS (
              SELECT 1 FROM handled h WHERE h.member_id=s.member_id AND h.appointment_id=a.id
            )
        ), first_handled AS (
          SELECT member_id,appointment_id,MIN(julianday(handled_at)) AS handled_at
          FROM known GROUP BY member_id,appointment_id
        )
        SELECT requested.member_id AS memberId,
          COUNT(first_handled.appointment_id) AS total,
          COALESCE(SUM(first_handled.handled_at>=julianday(?)),0) AS monthly
        FROM requested LEFT JOIN first_handled USING(member_id)
        GROUP BY requested.member_id
      `
        )
        .bind(JSON.stringify(memberIds), asOf, asOf, monthStart)
        .all()
    );
  }
  return { memberRepairWorkload };
}
