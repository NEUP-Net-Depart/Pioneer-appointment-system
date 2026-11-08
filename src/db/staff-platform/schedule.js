import { addDays } from '../../platform/time.js';
import { dutyWindow } from '../../../shared/duty.js';
import { rows, assignment, membership, assignmentLeaveColumn } from './shared.js';
import { parseJson } from '../../platform/contracts.js';

export function scheduleRepository({ db, writeCommand: write }) {
  const list = async (sql, ...args) =>
    rows(
      await db
        .prepare(sql)
        .bind(...args)
        .all()
    );
  const shifts = `SELECT da.*,m.name AS member_name,c.name AS campus_name,${assignmentLeaveColumn} FROM duty_assignments da JOIN members m ON m.id=da.member_id JOIN campuses c ON c.id=da.campus_id`;
  async function scheduleWeek(week, campus, type) {
    const row = await db
      .prepare('SELECT * FROM roster_weeks WHERE week_start=? AND campus_id=? AND duty_type=?')
      .bind(week, campus, type)
      .first();
    return {
      id: row?.id || `week-${week}-${campus}-${type}`,
      weekStart: week,
      campusId: campus,
      dutyType: type,
      revision: row?.revision ?? -1,
      publishedAt: row?.published_at || null,
      assignments: row
        ? (
            await list(
              `${shifts} WHERE da.week_id=? AND da.active=1 ORDER BY da.business_date,da.start_at,m.name,da.id`,
              row.id
            )
          ).map(assignment)
        : []
    };
  }
  async function assignmentById(id) {
    return assignment(await db.prepare(`${shifts} WHERE da.id=?`).bind(id).first());
  }
  async function listAssignments(memberId, week) {
    return (
      await list(
        `${shifts} WHERE da.active=1 AND da.member_id=? AND da.business_date BETWEEN ? AND date(?,'+6 day') ORDER BY da.business_date,da.start_at,da.id`,
        memberId,
        week,
        week
      )
    ).map(assignment);
  }
  async function upcomingAssignments(memberId, day) {
    return (
      await list(
        `${shifts} WHERE da.active=1 AND da.member_id=? AND da.business_date>=?
      AND NOT EXISTS(SELECT 1 FROM service_day_overrides s WHERE s.business_date=da.business_date AND s.campus_id=da.campus_id AND s.paused=1)
      ORDER BY da.business_date,da.start_at,da.id LIMIT 30`,
        memberId,
        day
      )
    ).map(assignment);
  }
  async function schedulePeople(campus) {
    return list(
      `SELECT m.id AS memberId,m.name,m.student_id AS studentId,s.account,s.auth_version AS authVersion FROM members m JOIN staff_accounts s ON s.member_id=m.id
      WHERE m.status='active' AND s.status='enabled' AND EXISTS(SELECT 1 FROM staff_access_campuses g WHERE g.account=s.account AND g.campus=(SELECT name FROM campuses WHERE id=?)) ORDER BY m.name,m.id`,
      campus
    );
  }
  async function availabilityRows(memberIds, type, week) {
    return (
      await list(
        `SELECT * FROM member_availability WHERE member_id IN (SELECT value FROM json_each(?)) AND duty_type=? AND week_start IN ('',?)`,
        JSON.stringify(memberIds),
        type,
        week
      )
    ).map((row) => ({
      memberId: row.member_id,
      dutyType: row.duty_type,
      weekStart: row.week_start,
      windows: parseJson(row.windows, []),
      revision: row.revision,
      updatedAt: row.updated_at
    }));
  }
  async function scheduleHistory(id) {
    return (
      await list(
        "SELECT action,actor_account,occurred_at,before_json,after_json FROM audit_events WHERE json_extract(source_ref,'$.module')='rosters' AND (json_extract(source_ref,'$.id')=? OR (action='rosters.model.migrated' AND json_extract(source_ref,'$.type')='duty_assignments' AND json_extract(before_json,'$.id') IN (SELECT id FROM duty_assignments WHERE week_id=?)) OR (action='rosters.campus-week.published' AND EXISTS(SELECT 1 FROM json_each(after_json,'$.rosters') r WHERE json_extract(r.value,'$.id')=?))) ORDER BY occurred_at DESC,rowid DESC",
        id,
        id,
        id
      )
    ).map((row) => ({
      action: row.action,
      actorAccount: row.actor_account,
      occurredAt: row.occurred_at,
      before: parseJson(row.before_json, null),
      after: parseJson(row.after_json, null)
    }));
  }
  function scheduleStatements(before, items, record, gate, marker) {
    const ids = JSON.stringify(items.map((row) => row.id));
    return [
      db
        .prepare(
          `INSERT INTO roster_weeks(id,week_start,campus_id,duty_type,revision,published_at,updated_at,updated_by) SELECT ?,?,?,?,?,?,?,? WHERE ${gate}
        ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,published_at=excluded.published_at,updated_at=excluded.updated_at,updated_by=excluded.updated_by`
        )
        .bind(
          before.id,
          before.weekStart,
          before.campusId,
          before.dutyType,
          before.revision + 1,
          record.at,
          record.at,
          record.actorAccount,
          marker
        ),
      db
        .prepare(
          `UPDATE duty_assignments SET active=0,revision=revision+1,updated_at=? WHERE week_id=? AND active=1 AND id NOT IN (SELECT value FROM json_each(?)) AND ${gate}`
        )
        .bind(record.at, before.id, ids, marker),
      ...items
        .filter((item) => !before.assignments.some((old) => old.id === item.id))
        .map((item) =>
          db
            .prepare(
              `INSERT INTO duty_assignments(id,week_id,member_id,business_date,campus_id,duty_type,start_at,end_at,created_at,updated_at)
        SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${gate}`
            )
            .bind(
              item.id,
              before.id,
              item.memberId,
              item.businessDate,
              before.campusId,
              before.dutyType,
              item.startAt,
              item.endAt,
              record.at,
              record.at,
              marker
            )
        ),
      db
        .prepare(
          `UPDATE roster_covers SET status='cancelled',decided_at=?,revision=revision+1 WHERE status='pending' AND (assignment_id IN (SELECT id FROM duty_assignments WHERE week_id=? AND active=0) OR exchange_assignment_id IN (SELECT id FROM duty_assignments WHERE week_id=? AND active=0)) AND ${gate}`
        )
        .bind(record.at, before.id, before.id, marker)
    ];
  }
  async function saveSchedules(weeks, record, snapshotGuard) {
    const items = weeks.flatMap(({ before, items }) =>
      items.map((row) => ({ ...row, campusId: before.campusId }))
    );
    const values = JSON.stringify(items),
      weekIds = JSON.stringify(weeks.map((row) => row.before.id));
    const guard = `NOT EXISTS(SELECT 1 FROM json_each(?) n WHERE COALESCE((SELECT revision FROM roster_weeks WHERE id=json_extract(n.value,'$.id')),-1)<>json_extract(n.value,'$.revision'))
      AND NOT EXISTS(SELECT 1 FROM json_each(?) n WHERE NOT EXISTS(SELECT 1 FROM members m JOIN staff_accounts s ON s.member_id=m.id JOIN staff_access_campuses g ON g.account=s.account
        WHERE m.id=json_extract(n.value,'$.memberId') AND m.status='active' AND s.status='enabled' AND g.campus=(SELECT name FROM campuses WHERE id=json_extract(n.value,'$.campusId'))))
      AND NOT EXISTS(SELECT 1 FROM json_each(?) n JOIN duty_assignments a ON a.member_id=json_extract(n.value,'$.memberId') AND a.active=1 AND a.week_id NOT IN (SELECT value FROM json_each(?))
        AND a.business_date=json_extract(n.value,'$.businessDate') AND a.start_at<json_extract(n.value,'$.endAt') AND json_extract(n.value,'$.startAt')<a.end_at)
      ${snapshotGuard ? `AND (${snapshotGuard.sql})` : ''}`;
    return write(
      record,
      guard,
      [
        JSON.stringify(weeks.map((row) => ({ id: row.before.id, revision: row.before.revision }))),
        values,
        values,
        weekIds,
        ...(snapshotGuard?.args || [])
      ],
      (gate, marker) => [
        ...weeks.flatMap(({ before, items }) =>
          scheduleStatements(before, items, record, gate, marker)
        ),
        ...[...new Set(items.map((row) => row.businessDate))].map((day) =>
          db
            .prepare(
              `INSERT INTO attendance_events(id,type,policy_code,policy_version,rule_snapshot,campus_id,business_date,starts_at,ends_at,source_ref,created_by_member_id,created_at)
        SELECT ?,'duty','duty.v1','1.0.0','{"timezone":"Asia/Shanghai"}',?,?,?,?,?,?,? WHERE ${gate}
        AND NOT EXISTS(SELECT 1 FROM attendance_events WHERE type='duty' AND campus_id=? AND business_date=?)`
            )
            .bind(
              crypto.randomUUID(),
              weeks[0].before.campusId,
              day,
              ...Object.values(dutyWindow(day)),
              JSON.stringify({
                module: 'rosters',
                type: 'day',
                id: `${weeks[0].before.campusId}:${day}`
              }),
              record.actorMemberId,
              record.at,
              marker,
              weeks[0].before.campusId,
              day
            )
        )
      ]
    );
  }
  async function saveAvailability(memberId, type, week, input, record) {
    return write(
      record,
      'COALESCE((SELECT revision FROM member_availability WHERE member_id=? AND duty_type=? AND week_start=?),-1)=?',
      [memberId, type, week, input.revision],
      (gate, marker) => [
        db
          .prepare(
            `INSERT INTO member_availability(member_id,duty_type,week_start,windows,revision,updated_at) SELECT ?,?,?,?,?,? WHERE ${gate}
        ON CONFLICT(member_id,duty_type,week_start) DO UPDATE SET windows=excluded.windows,revision=excluded.revision,updated_at=excluded.updated_at`
          )
          .bind(
            memberId,
            type,
            week,
            JSON.stringify(input.windows),
            input.revision + 1,
            record.at,
            marker
          )
      ]
    );
  }
  async function recordLeave(item, input, record) {
    return write(
      record,
      `EXISTS(SELECT 1 FROM duty_assignments WHERE id=? AND member_id=? AND active=1 AND revision=?) AND NOT EXISTS(SELECT 1 FROM roster_leaves WHERE assignment_id=? AND member_id=? AND withdrawn_at IS NULL)`,
      [item.id, item.memberId, item.revision, item.id, item.memberId],
      (gate, marker) => [
        db
          .prepare(
            `INSERT INTO roster_leaves(id,assignment_id,member_id,reason,recorded_at) SELECT ?,?,?,?,? WHERE ${gate}`
          )
          .bind(crypto.randomUUID(), item.id, item.memberId, input.reason, record.at, marker),
        db
          .prepare(
            `UPDATE duty_assignments SET revision=revision+1,updated_at=? WHERE id=? AND ${gate}`
          )
          .bind(record.at, item.id, marker),
        db
          .prepare(
            `UPDATE roster_covers SET assignment_revision=assignment_revision+CASE WHEN assignment_id=? THEN 1 ELSE 0 END,exchange_revision=exchange_revision+CASE WHEN exchange_assignment_id=? THEN 1 ELSE 0 END WHERE status='pending' AND (assignment_id=? OR exchange_assignment_id=?) AND ${gate}`
          )
          .bind(item.id, item.id, item.id, item.id, marker),
        db
          .prepare(
            `UPDATE roster_weeks SET revision=revision+1,updated_at=? WHERE id=? AND ${gate}`
          )
          .bind(record.at, item.weekId, marker)
      ]
    );
  }
  async function withdrawLeave(item, record) {
    return write(
      record,
      'EXISTS(SELECT 1 FROM duty_assignments WHERE id=? AND active=1 AND member_id=? AND revision=?) AND EXISTS(SELECT 1 FROM roster_leaves WHERE assignment_id=? AND member_id=? AND withdrawn_at IS NULL)',
      [item.id, item.memberId, item.revision, item.id, item.memberId],
      (gate, marker) => [
        db
          .prepare(
            `UPDATE roster_leaves SET withdrawn_at=?,revision=revision+1 WHERE assignment_id=? AND member_id=? AND withdrawn_at IS NULL AND ${gate}`
          )
          .bind(record.at, item.id, item.memberId, marker),
        db
          .prepare(
            `UPDATE duty_assignments SET revision=revision+1,updated_at=? WHERE id=? AND ${gate}`
          )
          .bind(record.at, item.id, marker),
        db
          .prepare(
            `UPDATE roster_covers SET assignment_revision=assignment_revision+CASE WHEN assignment_id=? THEN 1 ELSE 0 END,exchange_revision=exchange_revision+CASE WHEN exchange_assignment_id=? THEN 1 ELSE 0 END WHERE status='pending' AND (assignment_id=? OR exchange_assignment_id=?) AND ${gate}`
          )
          .bind(item.id, item.id, item.id, item.id, marker),
        db
          .prepare(
            `UPDATE roster_weeks SET revision=revision+1,updated_at=? WHERE id=? AND ${gate}`
          )
          .bind(record.at, item.weekId, marker)
      ]
    );
  }
  async function covers(memberId) {
    return list(
      `SELECT r.*,f.name AS from_name,t.name AS to_name FROM roster_covers r JOIN members f ON f.id=r.from_member_id JOIN members t ON t.id=r.to_member_id WHERE r.from_member_id=? OR r.to_member_id=? ORDER BY r.created_at DESC`,
      memberId,
      memberId
    );
  }
  async function cover(id) {
    return db.prepare('SELECT * FROM roster_covers WHERE id=?').bind(id).first();
  }
  async function createCover(item, toMemberId, note, record) {
    return write(
      record,
      `EXISTS(SELECT 1 FROM duty_assignments WHERE id=? AND revision=? AND member_id=? AND active=1)
    AND NOT EXISTS(SELECT 1 FROM roster_covers WHERE (assignment_id=? OR exchange_assignment_id=?) AND status='pending')
    AND EXISTS(SELECT 1 FROM members m JOIN staff_accounts s ON s.member_id=m.id JOIN staff_access_campuses g ON g.account=s.account WHERE m.id=? AND m.status='active' AND s.status='enabled' AND g.campus=(SELECT name FROM campuses WHERE id=?))`,
      [item.id, item.revision, item.memberId, item.id, item.id, toMemberId, item.campusId],
      (gate, marker) => [
        db
          .prepare(
            `INSERT INTO roster_covers(id,assignment_id,from_member_id,to_member_id,assignment_revision,status,note,created_at) SELECT ?,?,?,?,?,'pending',?,? WHERE ${gate}`
          )
          .bind(
            record.result.id,
            item.id,
            item.memberId,
            toMemberId,
            item.revision,
            note,
            record.at,
            marker
          )
      ]
    );
  }
  async function decideCover(cover, decision, changes, record) {
    const ids = changes.map((row) => row.id),
      json = JSON.stringify(changes);
    const guard = `EXISTS(SELECT 1 FROM roster_covers WHERE id=? AND revision=? AND status='pending')
      AND NOT EXISTS(SELECT 1 FROM json_each(?) n WHERE NOT EXISTS(SELECT 1 FROM duty_assignments a WHERE a.id=json_extract(n.value,'$.id') AND a.revision=json_extract(n.value,'$.revision') AND a.active=1))
      AND NOT EXISTS(SELECT 1 FROM json_each(?) n WHERE NOT EXISTS(SELECT 1 FROM members m JOIN staff_accounts s ON s.member_id=m.id JOIN staff_access_campuses g ON g.account=s.account
        WHERE m.id=json_extract(n.value,'$.memberId') AND m.status='active' AND s.status='enabled' AND g.campus=(SELECT name FROM campuses WHERE id=json_extract(n.value,'$.campusId'))))
      AND NOT EXISTS(SELECT 1 FROM json_each(?) n JOIN duty_assignments a ON a.member_id=json_extract(n.value,'$.memberId') AND a.active=1 AND a.id NOT IN (SELECT value FROM json_each(?))
        AND a.business_date=json_extract(n.value,'$.businessDate') AND a.start_at<json_extract(n.value,'$.endAt') AND json_extract(n.value,'$.startAt')<a.end_at)`;
    return write(
      record,
      guard,
      [cover.id, cover.revision, json, json, json, JSON.stringify(ids)],
      (gate, marker) => [
        ...changes.map((item) =>
          db
            .prepare(
              `UPDATE duty_assignments SET member_id=?,revision=revision+1,updated_at=? WHERE id=? AND ${gate}`
            )
            .bind(item.memberId, record.at, item.id, marker)
        ),
        ...[...new Set(changes.map((item) => item.weekId))].map((id) =>
          db
            .prepare(
              `UPDATE roster_weeks SET revision=revision+1,updated_at=? WHERE id=? AND ${gate}`
            )
            .bind(record.at, id, marker)
        ),
        db
          .prepare(
            `UPDATE roster_covers SET status='cancelled',revision=revision+1,decided_at=? WHERE id<>? AND status='pending' AND (assignment_id IN (SELECT value FROM json_each(?)) OR exchange_assignment_id IN (SELECT value FROM json_each(?))) AND ${gate}`
          )
          .bind(record.at, cover.id, JSON.stringify(ids), JSON.stringify(ids), marker),
        db
          .prepare(
            `UPDATE roster_covers SET status=?,revision=revision+1,decided_at=? WHERE id=? AND ${gate}`
          )
          .bind(decision, record.at, cover.id, marker)
      ]
    );
  }
  async function pendingCoverInvitations(memberId) {
    return (
      await db
        .prepare("SELECT COUNT(*) n FROM roster_covers WHERE to_member_id=? AND status='pending'")
        .bind(memberId)
        .first()
    ).n;
  }
  async function rosterMemberFacts(memberIds, weekStart, end = addDays(weekStart, 6)) {
    const facts = new Map();
    for (let offset = 0; offset < memberIds.length; offset += 80) {
      const ids = memberIds.slice(offset, offset + 80),
        placeholders = ids.map(() => '?').join(',');
      const results = await db.batch([
        db
          .prepare(
            `SELECT m.id,m.name,m.student_id,m.status,MAX(CASE WHEN sa.status='enabled' THEN 1 ELSE 0 END) AS enabled,
          (SELECT role FROM staff_accounts WHERE member_id=m.id AND status='enabled' ORDER BY account LIMIT 1) AS role
          FROM members m LEFT JOIN staff_accounts sa ON sa.member_id=m.id WHERE m.id IN (${placeholders}) GROUP BY m.id`
          )
          .bind(...ids),
        db
          .prepare(
            `SELECT DISTINCT sa.member_id,g.campus FROM staff_accounts sa JOIN staff_access_campuses g ON g.account=sa.account
          WHERE sa.member_id IN (${placeholders}) AND sa.status='enabled'`
          )
          .bind(...ids),
        db
          .prepare(
            `SELECT da.* FROM duty_assignments da WHERE da.active=1
          AND da.member_id IN (${placeholders}) AND da.business_date>=? AND da.business_date<=?`
          )
          .bind(...ids, weekStart, end),
        db
          .prepare(
            `SELECT mm.*,d.name AS department_name,d.code AS department_code,d.kind AS organization_kind,d.enabled AS department_enabled FROM member_department_memberships mm JOIN departments d ON d.id=mm.department_id
          WHERE mm.member_id IN (${placeholders}) AND mm.effective_from<=? AND (mm.effective_to IS NULL OR mm.effective_to>?) ORDER BY mm.is_primary DESC,d.name`
          )
          .bind(...ids, end, weekStart)
      ]);
      for (const row of rows(results[0]))
        facts.set(row.id, {
          memberId: row.id,
          name: row.name,
          studentId: row.student_id,
          role: row.role,
          active: row.status === 'active' && !!row.enabled,
          campuses: [],
          assignments: [],
          departmentNames: [],
          memberships: []
        });
      for (const row of rows(results[1])) facts.get(row.member_id)?.campuses.push(row.campus);
      for (const row of rows(results[2]))
        facts.get(row.member_id)?.assignments.push(assignment(row));
      for (const row of rows(results[3])) {
        const fact = facts.get(row.member_id);
        if (fact) {
          fact.memberships.push(membership(row));
          if (!fact.departmentNames.includes(row.department_name))
            fact.departmentNames.push(row.department_name);
        }
      }
    }
    return [...facts.values()];
  }

  return {
    scheduleWeek,
    assignmentById,
    listAssignments,
    upcomingAssignments,
    schedulePeople,
    availabilityRows,
    scheduleHistory,
    saveSchedules,
    saveAvailability,
    recordLeave,
    withdrawLeave,
    covers,
    cover,
    createCover,
    decideCover,
    pendingCoverInvitations,
    rosterMemberFacts
  };
}
