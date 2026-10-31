import { parseJson } from '../../platform/contracts.js';
import { nowIso } from '../../platform/time.js';
import { attendanceCorrections } from '.././attendance-corrections.js';
import { rows, json } from './shared.js';

export function attendanceDomain({ db, auditStatement, commandAuthorization }) {
  async function createEvent(input, actorMemberId, auditRecord) {
    if (input.type === 'duty') {
      const existing = await db
        .prepare(
          `SELECT * FROM attendance_events WHERE type='duty' AND business_date=? AND COALESCE(campus_id,'')=COALESCE(?, '') ORDER BY created_at LIMIT 1`
        )
        .bind(input.businessDate, input.campusId || null)
        .first();
      if (existing) return event(existing);
    }
    const id = input.id || crypto.randomUUID();
    const at = nowIso();
    const authorization = commandAuthorization(auditRecord);
    const statements = [
      db
        .prepare(
          `INSERT INTO attendance_events(id,type,policy_code,policy_version,rule_snapshot,campus_id,business_date,starts_at,ends_at,source_ref,created_by_member_id,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE (?<>'duty' OR NOT EXISTS(SELECT 1 FROM attendance_events WHERE type='duty' AND business_date=? AND COALESCE(campus_id,'')=COALESCE(?,''))) ${authorization.sql}`
        )
        .bind(
          id,
          input.type,
          input.policyCode,
          input.policyVersion,
          json(input.ruleSnapshot, {}),
          input.campusId || null,
          input.businessDate,
          input.startsAt,
          input.endsAt,
          json(input.sourceRef, {}),
          actorMemberId,
          at,
          input.type,
          input.businessDate,
          input.campusId || null,
          ...authorization.args
        )
    ];
    if (auditRecord)
      statements.push(
        auditStatement(
          { ...auditRecord, sourceRef: { module: 'attendance', type: 'event', id } },
          true
        )
      );
    await db.batch(statements);
    return event(
      await db
        .prepare(
          "SELECT * FROM attendance_events WHERE id=? OR (?='duty' AND type='duty' AND business_date=? AND COALESCE(campus_id,'')=COALESCE(?,'')) ORDER BY created_at,id LIMIT 1"
        )
        .bind(id, input.type, input.businessDate, input.campusId || null)
        .first()
    );
  }

  async function issueToken(eventId, tokenHash, expiresAt, actorMemberId, revision) {
    const at = nowIso();
    const statements = [
      db
        .prepare(
          'UPDATE attendance_tokens SET revoked_at=? WHERE event_id=? AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM attendance_events WHERE id=? AND revision=?)'
        )
        .bind(at, eventId, eventId, revision),
      db
        .prepare(
          'INSERT INTO attendance_tokens(id,event_id,token_hash,version,issued_at,expires_at) SELECT ?,?,?,COALESCE((SELECT MAX(version)+1 FROM attendance_tokens WHERE event_id=?),1),?,? WHERE EXISTS(SELECT 1 FROM attendance_events WHERE id=? AND revision=?)'
        )
        .bind(crypto.randomUUID(), eventId, tokenHash, eventId, at, expiresAt, eventId, revision),
      db
        .prepare('UPDATE attendance_events SET revision=revision+1 WHERE id=? AND revision=?')
        .bind(eventId, revision)
    ];
    const result = await db.batch(statements);
    if (!result.at(-1)?.meta?.changes) return null;
    return db
      .prepare(
        'SELECT id,event_id,version,issued_at,expires_at FROM attendance_tokens WHERE token_hash=?'
      )
      .bind(tokenHash)
      .first();
  }

  function event(row) {
    return row
      ? {
          id: row.id,
          type: row.type,
          policyCode: row.policy_code,
          policyVersion: row.policy_version,
          ruleSnapshot: parseJson(row.rule_snapshot, {}),
          campusId: row.campus_id,
          businessDate: row.business_date,
          startsAt: row.starts_at,
          endsAt: row.ends_at,
          sourceRef: parseJson(row.source_ref, {}),
          revision: row.revision,
          createdAt: row.created_at
        }
      : null;
  }

  async function findEventByToken(tokenHash) {
    const row = await db
      .prepare(
        `SELECT e.*,t.id AS token_id,t.version AS token_version,t.expires_at AS token_expires_at FROM attendance_tokens t JOIN attendance_events e ON e.id=t.event_id
      WHERE t.token_hash=? AND t.revoked_at IS NULL AND t.expires_at>?`
      )
      .bind(tokenHash, nowIso())
      .first();
    return row
      ? {
          event: event(row),
          token: { id: row.token_id, version: row.token_version, expiresAt: row.token_expires_at }
        }
      : null;
  }

  async function attendanceEvent(id) {
    return event(await db.prepare('SELECT * FROM attendance_events WHERE id=?').bind(id).first());
  }

  async function findAttendanceByDedupe(dedupeKey) {
    const row = await db
      .prepare(
        `SELECT ar.*,(SELECT paused FROM service_day_overrides WHERE business_date=e.business_date AND campus_id=e.campus_id) AS service_paused,e.type,e.business_date,e.campus_id FROM attendance_records ar JOIN attendance_events e ON e.id=ar.event_id WHERE ar.dedupe_key=?`
      )
      .bind(dedupeKey)
      .first();
    return row ? attendanceRecord(row) : null;
  }

  function attendanceRecord(row) {
    return row
      ? {
          id: row.id,
          memberId: row.member_id,
          eventId: row.event_id,
          dedupeKey: row.dedupe_key,
          occurredAt: row.occurred_at,
          recordedAt: row.recorded_at,
          method: row.method,
          sourceRef: parseJson(row.source_ref, {}),
          businessDate: row.business_date,
          type: row.type,
          campusId: row.campus_id,
          primaryDepartmentIdSnapshot: row.primary_department_id_snapshot,
          primaryDepartmentNameSnapshot: row.primary_department_name_snapshot,
          identitySnapshot: parseJson(row.identity_snapshot, {}),
          nonScheduled: !!row.non_scheduled,
          servicePaused: !!row.service_paused,
          revision: row.revision
        }
      : null;
  }

  async function insertAttendance(record, presence) {
    const previousPresence = presence
      ? await db
          .prepare('SELECT state FROM staff_presence WHERE member_id=? AND business_date=?')
          .bind(record.memberId, record.businessDate)
          .first()
      : null;
    const authGuard =
      "EXISTS(SELECT 1 FROM staff_accounts sa JOIN members m ON m.id=sa.member_id WHERE sa.account=? AND sa.auth_version=? AND sa.status='enabled' AND m.status='active')";
    const guard = record.tokenId
      ? ` WHERE EXISTS(SELECT 1 FROM attendance_tokens t JOIN attendance_events e ON e.id=t.event_id WHERE t.id=? AND t.revoked_at IS NULL AND julianday(t.expires_at)>julianday(?) AND julianday(e.starts_at)<=julianday(?) AND julianday(e.ends_at)>=julianday(?)) AND ${authGuard}`
      : record.direct
        ? ` WHERE ${authGuard} AND EXISTS(SELECT 1 FROM attendance_events e WHERE e.id=? AND julianday(e.starts_at)<=julianday(?) AND julianday(e.ends_at)>=julianday(?)) AND (?=1 OR EXISTS(SELECT 1 FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id AND rv.status='published' WHERE da.member_id=? AND da.business_date=? AND da.campus_id=? AND da.duty_type='office' AND NOT EXISTS(SELECT 1 FROM roster_leave_facts lf WHERE lf.origin_assignment_id=COALESCE(da.origin_assignment_id,da.id) AND lf.member_id=da.member_id AND lf.status='approved')))`
        : '';
    const guardArgs = record.tokenId
      ? [
          record.tokenId,
          record.recordedAt,
          record.recordedAt,
          record.recordedAt,
          record.actorAccount,
          record.authVersion
        ]
      : record.direct
        ? [
            record.actorAccount,
            record.authVersion,
            record.eventId,
            record.recordedAt,
            record.recordedAt,
            record.directLeader ? 1 : 0,
            record.memberId,
            record.businessDate,
            record.campusId
          ]
        : [];
    const statements = [
      db
        .prepare(
          `INSERT INTO attendance_records(id,member_id,event_id,dedupe_key,occurred_at,recorded_at,method,source_ref,primary_department_id_snapshot,primary_department_name_snapshot,identity_snapshot,non_scheduled)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?${guard}`
        )
        .bind(
          record.id,
          record.memberId,
          record.eventId,
          record.dedupeKey,
          record.occurredAt,
          record.recordedAt,
          record.method,
          json(record.sourceRef, {}),
          record.departmentId || null,
          record.departmentName || null,
          json(record.identitySnapshot, {}),
          record.nonScheduled ? 1 : 0,
          ...guardArgs
        )
    ];
    if (presence) {
      statements.push(
        db
          .prepare(
            `INSERT INTO staff_presence(member_id,business_date,campus_id,state,revision,updated_at) SELECT ?,?,?,?,0,? WHERE EXISTS(SELECT 1 FROM attendance_records WHERE id=?)
        ON CONFLICT(member_id,business_date) DO UPDATE SET campus_id=excluded.campus_id,state='available',revision=staff_presence.revision+1,updated_at=excluded.updated_at`
          )
          .bind(
            record.memberId,
            record.businessDate,
            record.campusId,
            'available',
            record.recordedAt,
            record.id
          )
      );
      statements.push(
        db
          .prepare(
            `INSERT INTO presence_events(id,member_id,business_date,from_state,to_state,occurred_at,actor_member_id,actor_account)
        SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM attendance_records WHERE id=?)`
          )
          .bind(
            crypto.randomUUID(),
            record.memberId,
            record.businessDate,
            previousPresence?.state || null,
            'available',
            record.recordedAt,
            record.memberId,
            record.actorAccount || null,
            record.id
          )
      );
    }
    if (record.checkInAudit) {
      statements.push(
        db
          .prepare(
            `INSERT INTO audit_events(id,actor_member_id,actor_account,action,source_ref,after_json,request_id,occurred_at)
        SELECT ?,?,?,'attendance.checked_in',?,?,?,? WHERE EXISTS(SELECT 1 FROM attendance_records WHERE id=?)`
          )
          .bind(
            crypto.randomUUID(),
            record.memberId,
            record.actorAccount,
            json({ module: 'attendance', type: 'record', id: record.id }, {}),
            json({ eventId: record.eventId, occurredAt: record.occurredAt }, {}),
            record.requestId || null,
            record.recordedAt,
            record.id
          )
      );
      if (record.requestId)
        statements.push(
          db
            .prepare(
              `UPDATE operation_receipts SET result_status='success',resource_ref=?,result_json=?
        WHERE actor_member_id=? AND action='attendance.checkin' AND request_id=? AND payload_hash=? AND EXISTS(SELECT 1 FROM attendance_records WHERE id=?)`
            )
            .bind(
              json({ module: 'attendance', type: 'record', id: record.id }, {}),
              json(record, {}),
              record.memberId,
              record.requestId,
              record.payloadHash,
              record.id
            )
        );
    }
    try {
      const result = await db.batch(statements);
      return result[0]?.meta?.changes
        ? attendanceRecord(
            await db
              .prepare(
                `SELECT ar.*,(SELECT paused FROM service_day_overrides s WHERE s.business_date=e.business_date AND s.campus_id=e.campus_id) AS service_paused,e.type,e.business_date,e.campus_id FROM attendance_records ar JOIN attendance_events e ON e.id=ar.event_id WHERE ar.id=?`
              )
              .bind(record.id)
              .first()
          )
        : null;
    } catch (error) {
      if (`${error.message || ''}`.includes('attendance_records.dedupe_key')) return null;
      throw error;
    }
  }

  async function listAttendance(filters = {}) {
    const conditions = [],
      args = [];
    if (filters.memberId) {
      conditions.push('ar.member_id=?');
      args.push(filters.memberId);
    }
    if (filters.businessDate) {
      conditions.push('e.business_date=?');
      args.push(filters.businessDate);
    }
    if (filters.type) {
      conditions.push('e.type=?');
      args.push(filters.type);
    }
    if (filters.month) {
      conditions.push("e.business_date>=? AND e.business_date<date(?,'+1 month')");
      args.push(`${filters.month}-01`, `${filters.month}-01`);
    }
    if (filters.departmentId) {
      conditions.push('ar.primary_department_id_snapshot=?');
      args.push(filters.departmentId);
    }
    if (filters.campusId) {
      conditions.push('e.campus_id=?');
      args.push(filters.campusId);
    }
    if (filters.campusIds?.length) {
      conditions.push(`e.campus_id IN (${filters.campusIds.map(() => '?').join(',')})`);
      args.push(...filters.campusIds);
    }
    if (filters.after) {
      conditions.push('(ar.occurred_at<? OR (ar.occurred_at=? AND ar.id<?))');
      args.push(filters.after.occurredAt, filters.after.occurredAt, filters.after.id);
    }
    const result = await db
      .prepare(
        `SELECT ar.*,(SELECT paused FROM service_day_overrides s WHERE s.business_date=e.business_date AND s.campus_id=e.campus_id) AS service_paused,e.type,e.business_date,e.campus_id FROM attendance_records ar JOIN attendance_events e ON e.id=ar.event_id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY ar.occurred_at DESC,ar.id DESC LIMIT 101`
      )
      .bind(...args)
      .all();
    return rows(result).map(attendanceRecord);
  }

  async function attendanceById(id) {
    return attendanceRecord(
      await db
        .prepare(
          'SELECT ar.*,(SELECT paused FROM service_day_overrides s WHERE s.business_date=e.business_date AND s.campus_id=e.campus_id) AS service_paused,e.type,e.business_date,e.campus_id FROM attendance_records ar JOIN attendance_events e ON e.id=ar.event_id WHERE ar.id=?'
        )
        .bind(id)
        .first()
    );
  }

  async function attendanceOptions(filters) {
    const result = await db.batch([
      db
        .prepare(
          'SELECT * FROM attendance_events WHERE business_date=? AND campus_id=? ORDER BY starts_at,id LIMIT 101'
        )
        .bind(filters.businessDate, filters.campusId),
      db
        .prepare(
          `SELECT m.*,mm.department_id,d.name AS department_name FROM members m LEFT JOIN member_department_memberships mm ON mm.member_id=m.id
        AND mm.is_primary=1 AND mm.effective_from<=? AND (mm.effective_to IS NULL OR mm.effective_to>?) LEFT JOIN departments d ON d.id=mm.department_id
        WHERE ?<>'' AND (instr(m.name,?)>0 OR instr(COALESCE(m.student_id,''),?)>0) ORDER BY m.name,m.id LIMIT 51`
        )
        .bind(filters.businessDate, filters.businessDate, filters.q, filters.q, filters.q)
    ]);
    return {
      events: rows(result[0]).map(event),
      members: rows(result[1]).map((row) => ({
        memberId: row.id,
        name: row.name,
        studentId: row.student_id,
        departmentId: row.department_id,
        departmentName: row.department_name
      }))
    };
  }

  async function attendanceExport(filters = {}) {
    const conditions = [
      "e.type='duty'",
      'NOT EXISTS(SELECT 1 FROM service_day_overrides s WHERE s.business_date=e.business_date AND s.campus_id=e.campus_id AND s.paused=1)'
    ];
    const args = [];
    if (filters.month) {
      conditions.push('e.business_date>=? AND e.business_date<?');
      args.push(`${filters.month}-01`, filters.nextMonth);
    }
    if (filters.campusIds?.length) {
      conditions.push(`e.campus_id IN (${filters.campusIds.map(() => '?').join(',')})`);
      args.push(...filters.campusIds);
    }
    if (filters.memberId) {
      conditions.push('ar.member_id=?');
      args.push(filters.memberId);
    }
    if (filters.departmentId) {
      conditions.push('ar.primary_department_id_snapshot=?');
      args.push(filters.departmentId);
    }
    const result = await db
      .prepare(
        `SELECT e.campus_id,c.name AS campus_name,ar.member_id,
      COALESCE(json_extract(ar.identity_snapshot,'$.name'),m.name) AS member_name,
      COALESCE(json_extract(ar.identity_snapshot,'$.studentId'),m.student_id,'') AS student_id,
      ar.primary_department_id_snapshot,ar.primary_department_name_snapshot,
      COUNT(DISTINCT e.business_date) AS attendance_count
      FROM attendance_records ar JOIN attendance_events e ON e.id=ar.event_id
      JOIN members m ON m.id=ar.member_id LEFT JOIN campuses c ON c.id=e.campus_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY e.campus_id,c.name,ar.member_id,member_name,student_id,ar.primary_department_id_snapshot,ar.primary_department_name_snapshot
      ORDER BY c.name,member_name,ar.member_id`
      )
      .bind(...args)
      .all();
    return rows(result).map((row) => ({
      campusId: row.campus_id || '',
      campus: row.campus_name || row.campus_id || '',
      memberId: row.member_id,
      memberName: row.member_name || '',
      studentId: row.student_id || '',
      attendanceCount: Number(row.attendance_count || 0),
      departmentId: row.primary_department_id_snapshot || '',
      department: row.primary_department_name_snapshot || ''
    }));
  }

  async function weeklyAttendanceData(start, end) {
    const result = await db.batch([
      db
        .prepare(
          `SELECT ar.*,(SELECT paused FROM service_day_overrides s WHERE s.business_date=e.business_date AND s.campus_id=e.campus_id) AS service_paused,e.type,e.business_date,e.campus_id,m.name AS member_name,m.student_id FROM attendance_records ar JOIN attendance_events e ON e.id=ar.event_id JOIN members m ON m.id=ar.member_id
        WHERE e.type='duty' AND e.business_date BETWEEN ? AND ? ORDER BY ar.occurred_at,ar.id`
        )
        .bind(start, end),
      db
        .prepare(
          `SELECT m.id AS memberId,m.name,m.student_id AS studentId,m.home_campus_id AS homeCampusId,m.college,m.major,(SELECT json_group_array(DISTINCT g.campus) FROM staff_accounts a JOIN staff_campus_grants g ON g.account=a.account WHERE a.member_id=m.id) AS campuses FROM members m
        WHERE EXISTS(SELECT 1 FROM member_roles mr WHERE mr.member_id=m.id AND mr.effective_from<=? AND (mr.effective_to IS NULL OR mr.effective_to>?))
          OR EXISTS(SELECT 1 FROM attendance_records ar JOIN attendance_events e ON e.id=ar.event_id
            WHERE ar.member_id=m.id AND e.type='duty' AND e.business_date BETWEEN ? AND ?)`
        )
        .bind(end, start, start, end)
    ]);
    return {
      records: rows(result[0]).map((row) => ({
        ...attendanceRecord(row),
        memberName: row.member_name,
        studentId: row.student_id
      })),
      members: rows(result[1]).map((row) => ({ ...row, campuses: parseJson(row.campuses, []) }))
    };
  }

  async function attendanceReportSettings() {
    const row = await db.prepare('SELECT * FROM attendance_report_settings WHERE id=1').first();
    return {
      countMode: row.count_mode,
      hoursPerCount: row.hours_per_count,
      mergeLeaders: !!row.merge_leaders,
      revision: row.revision
    };
  }

  async function updateAttendanceReportSettings(input, auditRecord) {
    const authorization = commandAuthorization(auditRecord);
    const result = await db.batch([
      db
        .prepare(
          `UPDATE attendance_report_settings SET count_mode=?,hours_per_count=?,merge_leaders=?,
        revision=revision+1,updated_at=?,updated_by=? WHERE id=1 AND revision=? ${authorization.sql}`
        )
        .bind(
          input.countMode,
          input.hoursPerCount,
          Number(input.mergeLeaders),
          nowIso(),
          auditRecord.actorAccount,
          input.revision,
          ...authorization.args
        ),
      auditStatement(auditRecord, true)
    ]);
    return result[0]?.meta?.changes ? attendanceReportSettings() : null;
  }

  async function setPresence(memberId, input, revision, actor, auditRecord) {
    const at = nowIso();
    const existing = await db
      .prepare('SELECT * FROM staff_presence WHERE member_id=? AND business_date=?')
      .bind(memberId, input.businessDate)
      .first();
    const expected = existing ? revision : 0;
    const authorization = commandAuthorization(auditRecord);
    if (auditRecord && !existing) return null;
    const statement = existing
      ? db
          .prepare(
            `UPDATE staff_presence SET state=?,campus_id=?,revision=revision+1,updated_at=? WHERE member_id=? AND business_date=? AND revision=? ${authorization.sql}`
          )
          .bind(
            input.state,
            input.campusId || existing.campus_id,
            at,
            memberId,
            input.businessDate,
            expected,
            ...authorization.args
          )
      : db
          .prepare(
            `INSERT INTO staff_presence(member_id,business_date,campus_id,state,revision,updated_at) VALUES(?,?,?,?,0,?)`
          )
          .bind(memberId, input.businessDate, input.campusId || null, input.state, at);
    const expectedRevision = existing ? Number(expected) + 1 : 0;
    const result = await db.batch([
      statement,
      db
        .prepare(
          `INSERT INTO presence_events(id,member_id,business_date,from_state,to_state,occurred_at,actor_member_id,actor_account)
      SELECT ?,?,?,?,?,?,?,? WHERE changes()>0`
        )
        .bind(
          crypto.randomUUID(),
          memberId,
          input.businessDate,
          existing?.state || null,
          input.state,
          at,
          actor.memberId,
          actor.account
        ),
      ...(auditRecord ? [auditStatement(auditRecord, true)] : [])
    ]);
    return result[0]?.meta?.changes
      ? {
          memberId,
          businessDate: input.businessDate,
          campusId: input.campusId || existing?.campus_id || null,
          state: input.state,
          revision: expectedRevision
        }
      : null;
  }

  const { attendanceCorrectionFingerprint, correctAttendance } = attendanceCorrections(db, {
    auditStatement,
    commandAuthorization
  });
  return {
    createEvent,
    issueToken,
    event,
    findEventByToken,
    attendanceEvent,
    findAttendanceByDedupe,
    insertAttendance,
    listAttendance,
    attendanceById,
    attendanceOptions,
    attendanceExport,
    weeklyAttendanceData,
    attendanceReportSettings,
    updateAttendanceReportSettings,
    setPresence,
    attendanceCorrectionFingerprint,
    correctAttendance
  };
}
