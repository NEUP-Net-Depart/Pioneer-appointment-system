import { nowIso } from '../../platform/time.js';
import { rosterSwapCommands } from '.././roster-swaps.js';
import { assignmentLeaveColumn, rows, json, assignment } from './shared.js';

export function requestsDomain({ db, auditStatement, commandAuthorization }) {
  async function createLeave(input, actorMemberId, auditRecord, receiptRecord) {
    const id = crypto.randomUUID(),
      at = nowIso();
    const authorization = commandAuthorization(auditRecord);
    const statements = [];
    if (receiptRecord)
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO operation_receipts(actor_member_id,action,request_id,payload_hash,resource_ref,result_json,result_status,created_at)
      VALUES(?,?,?,?,?,'{}','pending',?)`
          )
          .bind(actorMemberId, receiptRecord.action, receiptRecord.id, receiptRecord.hash, '{}', at)
      );
    const insertIndex = statements.length;
    statements.push(
      db
        .prepare(
          `INSERT INTO leave_requests(id,assignment_id,member_id,reason,created_at)
      SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id
        WHERE da.id=? AND da.member_id=? AND COALESCE(da.origin_assignment_id,da.id)=? AND rv.status='published')
      AND NOT EXISTS(SELECT 1 FROM roster_leave_facts WHERE origin_assignment_id=? AND member_id=? AND status IN ('pending','approved'))
      ${receiptRecord ? "AND EXISTS(SELECT 1 FROM operation_receipts WHERE actor_member_id=? AND action=? AND request_id=? AND payload_hash=? AND result_status='pending')" : ''} ${authorization.sql}`
        )
        .bind(
          id,
          input.assignmentId,
          actorMemberId,
          input.reason,
          at,
          input.activeAssignmentId || input.assignmentId,
          actorMemberId,
          input.assignmentId,
          input.assignmentId,
          actorMemberId,
          ...(receiptRecord
            ? [actorMemberId, receiptRecord.action, receiptRecord.id, receiptRecord.hash]
            : []),
          ...authorization.args
        )
    );
    if (auditRecord)
      statements.push(
        auditStatement(
          {
            ...auditRecord,
            sourceRef: { module: 'rosters', type: 'leave', id },
            after: {
              assignmentId: input.assignmentId,
              memberId: actorMemberId,
              status: 'pending',
              reason: input.reason
            }
          },
          true
        )
      );
    if (receiptRecord) {
      const result = {
        id,
        assignmentId: input.assignmentId,
        memberId: actorMemberId,
        reason: input.reason,
        status: 'pending',
        reviewerMemberId: '',
        reviewNote: '',
        revision: 0,
        createdAt: at,
        reviewedAt: null
      };
      statements.push(
        db
          .prepare(
            `UPDATE operation_receipts SET resource_ref=?,result_json=?,result_status='success'
        WHERE actor_member_id=? AND action=? AND request_id=? AND payload_hash=? AND result_status='pending' AND EXISTS(SELECT 1 FROM leave_requests WHERE id=?)`
          )
          .bind(
            json({ module: 'rosters', type: 'leave', id }),
            json(result),
            actorMemberId,
            receiptRecord.action,
            receiptRecord.id,
            receiptRecord.hash,
            id
          )
      );
      statements.push(
        db
          .prepare(
            `DELETE FROM operation_receipts WHERE actor_member_id=? AND action=? AND request_id=? AND payload_hash=? AND result_status='pending' AND NOT EXISTS(SELECT 1 FROM leave_requests WHERE id=?)`
          )
          .bind(actorMemberId, receiptRecord.action, receiptRecord.id, receiptRecord.hash, id)
      );
    }
    const result = await db.batch(statements);
    return result[insertIndex]?.meta?.changes
      ? db.prepare('SELECT * FROM leave_requests WHERE id=?').bind(id).first()
      : null;
  }

  async function leaveById(id) {
    return db.prepare('SELECT * FROM leave_requests WHERE id=?').bind(id).first();
  }

  async function listLeaves(filters = {}) {
    const conditions = [],
      args = [];
    if (filters.memberId) {
      conditions.push('lr.member_id=?');
      args.push(filters.memberId);
    }
    if (filters.status) {
      conditions.push('lr.status=?');
      args.push(filters.status);
    }
    const result = await db
      .prepare(
        `SELECT lr.*,m.name AS member_name,da.business_date,da.campus_id,c.name AS campus_name,
      da.duty_type,da.start_at,da.end_at,da.version_id,da.member_id AS assigned_member_id,da.revision AS assignment_revision,rv.status AS version_status
      FROM leave_requests lr JOIN members m ON m.id=lr.member_id JOIN duty_assignments da ON da.id=lr.assignment_id
      JOIN roster_versions rv ON rv.id=da.version_id JOIN campuses c ON c.id=da.campus_id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY lr.created_at DESC,lr.id DESC LIMIT 501`
      )
      .bind(...args)
      .all();
    return rows(result).map((row) => ({
      ...row,
      assignment: assignment({
        ...row,
        id: row.assignment_id,
        member_id: row.assigned_member_id,
        revision: row.assignment_revision
      })
    }));
  }

  async function leaveImpact(target) {
    const result = await db
      .prepare(
        `SELECT da.id,da.member_id,MAX(CASE WHEN dr.role_kind='repair_lead' THEN 1 ELSE 0 END) AS is_lead,
      ${assignmentLeaveColumn},EXISTS(SELECT 1 FROM attendance_records ar JOIN attendance_events e ON e.id=ar.event_id
        WHERE ar.member_id=da.member_id AND e.type='duty' AND e.campus_id=da.campus_id AND e.business_date=da.business_date) AS checked_in
      FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id AND rv.status='published'
      LEFT JOIN duty_roles dr ON dr.assignment_id=da.id WHERE da.campus_id=? AND da.business_date=? AND da.duty_type=?
      AND da.start_at<=? AND da.end_at>=? GROUP BY da.id`
      )
      .bind(target.campusId, target.businessDate, target.dutyType, target.startAt, target.endAt)
      .all();
    const facts = rows(result),
      expected = facts.filter((item) => item.leave_status !== 'approved');
    const after = expected.filter((item) => item.id !== target.id);
    const count = (items) => new Set(items.map((item) => item.member_id)).size;
    const applicant = facts.find((item) => item.id === target.id);
    return {
      scheduled: count(facts),
      expected: count(expected),
      afterApproval: count(after),
      leaders: count(expected.filter((item) => item.is_lead)),
      leadersAfterApproval: count(after.filter((item) => item.is_lead)),
      checkedIn: !!applicant?.checked_in,
      arrived: count(facts.filter((item) => item.checked_in)),
      ordinaryAfterApproval: count(after.filter((item) => !item.is_lead)),
      ordinaryMinimum: target.ordinaryMinimum ?? null,
      needsReplacement:
        !after.length ||
        (target.dutyType === 'repair' &&
          (!after.some((item) => item.is_lead) ||
            (target.ruleVersion === 'repair-minimum-v2' &&
              count(after.filter((item) => !item.is_lead)) < (target.ordinaryMinimum ?? 1))))
    };
  }

  async function updateLeave(id, status, actorMemberId, revision, note = '', auditRecord) {
    const authorization = commandAuthorization(auditRecord);
    const statements = [
      db
        .prepare(
          `UPDATE leave_requests SET status=?,reviewer_member_id=?,review_note=?,reviewed_at=?,revision=revision+1
      WHERE id=? AND revision=? AND status='pending' AND (?<>'approved' OR EXISTS(SELECT 1 FROM duty_assignments da
        JOIN roster_versions rv ON rv.id=da.version_id WHERE COALESCE(da.origin_assignment_id,da.id)=(SELECT origin_assignment_id FROM roster_leave_facts WHERE id=leave_requests.id) AND da.member_id=leave_requests.member_id AND rv.status='published')) ${authorization.sql}`
        )
        .bind(status, actorMemberId, note, nowIso(), id, revision, status, ...authorization.args)
    ];
    if (auditRecord) statements.push(auditStatement(auditRecord, true));
    const result = await db.batch(statements);
    return result[0]?.meta?.changes
      ? db.prepare('SELECT * FROM leave_requests WHERE id=?').bind(id).first()
      : null;
  }

  const { swapFingerprint, createSwap, updateSwap } = rosterSwapCommands(db, {
    auditStatement,
    commandAuthorization
  });

  async function listSwaps(filters = {}) {
    const conditions = [],
      args = [];
    if (filters.memberId) {
      conditions.push('(from_member_id=? OR to_member_id=?)');
      args.push(filters.memberId, filters.memberId);
    }
    if (filters.status) {
      conditions.push('status=?');
      args.push(filters.status);
    }
    const result = await db
      .prepare(
        `SELECT * FROM swap_requests ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY created_at DESC,id DESC LIMIT 501`
      )
      .bind(...args)
      .all();
    return rows(result);
  }

  async function swapById(id) {
    return db.prepare('SELECT * FROM swap_requests WHERE id=?').bind(id).first();
  }

  async function pendingSwapInvitations(memberId) {
    return (
      await db
        .prepare(
          "SELECT COUNT(*) AS total FROM swap_requests WHERE to_member_id=? AND status='pending'"
        )
        .bind(memberId)
        .first()
    ).total;
  }

  async function swapCoverage(weekStart) {
    return rows(
      await db
        .prepare(
          `SELECT da.*,(SELECT paused FROM service_day_overrides s WHERE s.business_date=da.business_date AND s.campus_id=da.campus_id) AS service_paused,c.name AS campus_name,dr.role_kind,rv.status AS version_status,rv.task_id,rv.rule_version,rv.input_snapshot_ref,${assignmentLeaveColumn}
      FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id AND rv.status='published'
      JOIN campuses c ON c.id=da.campus_id LEFT JOIN duty_roles dr ON dr.assignment_id=da.id
      WHERE da.business_date>=? AND da.business_date<=date(?,'+6 day') ORDER BY da.id`
        )
        .bind(weekStart, weekStart)
        .all()
    ).map(assignment);
  }
  return {
    createLeave,
    leaveById,
    listLeaves,
    leaveImpact,
    updateLeave,
    swapFingerprint,
    createSwap,
    updateSwap,
    listSwaps,
    swapById,
    pendingSwapInvitations,
    swapCoverage
  };
}
