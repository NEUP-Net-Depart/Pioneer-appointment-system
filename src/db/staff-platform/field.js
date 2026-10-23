import { parseJson } from '../../platform/contracts.js';
import { intersectScopes } from '../../modules/authorization/scopes.js';
import { rows, membership, profile, assignment } from './shared.js';

export function fieldDomain({ db, event }) {
  async function listCampuses(includeDisabled = false) {
    const result = await db
      .prepare(
        `SELECT * FROM campuses ${includeDisabled ? '' : 'WHERE enabled=1'} ORDER BY name,id`
      )
      .all();
    return rows(result).map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      enabled: !!row.enabled,
      revision: row.revision
    }));
  }

  async function listDepartments(includeDisabled = false) {
    const result = await db
      .prepare(
        `SELECT * FROM departments ${includeDisabled ? '' : 'WHERE enabled=1'} ORDER BY name,id`
      )
      .all();
    return rows(result).map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      enabled: !!row.enabled,
      revision: row.revision
    }));
  }

  async function listLocations(campusId = '', includeDisabled = false) {
    const conditions = [],
      args = [];
    if (campusId) {
      conditions.push('l.campus_id=?');
      args.push(campusId);
    }
    if (!includeDisabled) conditions.push('l.enabled=1');
    const result = await db
      .prepare(
        `SELECT l.*,c.name AS campus_name FROM locations l JOIN campuses c ON c.id=l.campus_id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY c.name,l.name,l.id`
      )
      .bind(...args)
      .all();
    return rows(result).map((row) => ({
      id: row.id,
      campusId: row.campus_id,
      campusName: row.campus_name,
      code: row.code,
      name: row.name,
      enabled: !!row.enabled,
      revision: row.revision
    }));
  }

  async function listPresence(businessDate, campusId = '') {
    const conditions = ['sp.business_date=?'],
      args = [businessDate];
    if (campusId) {
      conditions.push('sp.campus_id=?');
      args.push(campusId);
    }
    const result = await db
      .prepare(
        `SELECT sp.*,m.name,m.student_id FROM staff_presence sp JOIN members m ON m.id=sp.member_id
      WHERE ${conditions.join(' AND ')} ORDER BY m.name,m.id`
      )
      .bind(...args)
      .all();
    return rows(result).map((row) => ({
      memberId: row.member_id,
      name: row.name,
      studentId: row.student_id || '',
      businessDate: row.business_date,
      campusId: row.campus_id,
      state: row.state,
      revision: row.revision,
      updatedAt: row.updated_at
    }));
  }

  async function dutyEvent(businessDate, campusId) {
    return event(
      await db
        .prepare(
          "SELECT * FROM attendance_events WHERE type='duty' AND business_date=? AND campus_id=? ORDER BY created_at LIMIT 1"
        )
        .bind(businessDate, campusId)
        .first()
    );
  }

  async function latestIntake(id) {
    const row = await db
      .prepare(
        'SELECT verification_json FROM repair_intake_records WHERE appointment_id=? ORDER BY verified_at DESC,rowid DESC LIMIT 1'
      )
      .bind(id)
      .first();
    return parseJson(row?.verification_json, null);
  }

  async function receptionHistory(id) {
    return (
      await db
        .prepare(
          `SELECT e.id,e.action,e.reason,e.occurred_at AS occurredAt,
      CASE WHEN e.action='receptions.guest_leave' THEN '客户本人' ELSE COALESCE(m.name,'原工作人员') END AS actorName,
      (SELECT number FROM repair_queue_tickets t WHERE t.id=e.id) AS ticketNumber,
      json_extract(e.after_json,'$.reception.assignedMemberId') AS assignedMemberId,
      json_extract(e.after_json,'$.assigneeIdentity.name') AS assigneeName,
      json_extract(e.after_json,'$.date') AS date,json_extract(e.after_json,'$.timeSlot') AS timeSlot
      FROM audit_events e LEFT JOIN members m ON m.id=e.actor_member_id
      WHERE json_extract(e.source_ref,'$.module')='repairs' AND json_extract(e.source_ref,'$.id')=?
      AND (e.action LIKE 'receptions.%' OR e.action IN ('repairs.claimed','repairs.transferred','repairs.completed'))
      ORDER BY e.occurred_at,e.rowid`
        )
        .bind(id)
        .all()
    ).results;
  }

  async function repairIdentitySnapshot(id) {
    const row = await db
      .prepare(
        `SELECT json_extract(after_json,'$.assigneeIdentity') AS snapshot FROM audit_events
      WHERE json_extract(source_ref,'$.module')='repairs' AND json_extract(source_ref,'$.id')=?
      AND action IN ('repairs.claimed','repairs.transferred') ORDER BY occurred_at DESC,rowid DESC LIMIT 1`
      )
      .bind(id)
      .first();
    return parseJson(row?.snapshot, null);
  }

  async function fieldPeople(day, campus) {
    const result = await db
      .prepare(
        `SELECT m.id AS memberId,m.name,
      (SELECT account FROM staff_accounts WHERE member_id=m.id AND status='enabled' ORDER BY account LIMIT 1) AS account,
      sp.state,sp.revision,
      (SELECT MIN(ar.occurred_at) FROM attendance_records ar JOIN attendance_events ae ON ae.id=ar.event_id
        WHERE ar.member_id=m.id AND ae.type='duty' AND ae.business_date=sp.business_date AND ae.campus_id=sp.campus_id) AS signedInAt,
      (SELECT GROUP_CONCAT(d.name,'、') FROM member_department_memberships mm JOIN departments d ON d.id=mm.department_id
       WHERE mm.member_id=m.id AND mm.effective_from<=? AND (mm.effective_to IS NULL OR mm.effective_to>?)) AS department,
      EXISTS(SELECT 1 FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id AND rv.status='published'
        WHERE da.member_id=m.id AND da.business_date=? AND da.campus_id=?) AS scheduled,
      COALESCE((SELECT lr.status FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id AND rv.status='published'
        JOIN roster_leave_facts lr ON lr.origin_assignment_id=COALESCE(da.origin_assignment_id,da.id) AND lr.member_id=da.member_id
        WHERE da.member_id=m.id AND da.business_date=? AND da.campus_id=? AND lr.status IN ('pending','approved')
        ORDER BY CASE lr.status WHEN 'approved' THEN 0 ELSE 1 END LIMIT 1),'') AS leaveStatus
      FROM members m LEFT JOIN staff_presence sp ON sp.member_id=m.id AND sp.business_date=? AND sp.campus_id=?
      WHERE sp.member_id IS NOT NULL OR EXISTS(SELECT 1 FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id AND rv.status='published'
        WHERE da.member_id=m.id AND da.business_date=? AND da.campus_id=?) ORDER BY m.name,m.id`
      )
      .bind(day, day, day, campus, day, campus, day, campus, day, campus)
      .all();
    return rows(result);
  }

  async function fieldContexts(memberIds, day) {
    const contexts = new Map();
    for (let offset = 0; offset < memberIds.length; offset += 80) {
      const ids = memberIds.slice(offset, offset + 80),
        marks = ids.map(() => '?').join(',');
      const result = await db.batch([
        db
          .prepare(
            `SELECT m.*,sa.account,sa.role,sa.status AS account_status,sa.auth_version,
          (SELECT json_group_array(campus) FROM staff_campus_grants WHERE account=sa.account) AS campuses
          FROM members m LEFT JOIN staff_accounts sa ON sa.account=(SELECT account FROM staff_accounts WHERE member_id=m.id ORDER BY status='enabled' DESC,account LIMIT 1)
          WHERE m.id IN (${marks})`
          )
          .bind(...ids),
        db
          .prepare(
            `SELECT * FROM member_work_profiles WHERE member_id IN (${marks}) AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)`
          )
          .bind(...ids, day, day),
        db
          .prepare(
            `SELECT mr.member_id,rg.*,mr.scope_bindings,r.code AS role_code FROM member_roles mr JOIN roles r ON r.id=mr.role_id AND r.enabled=1
          JOIN role_grants rg ON rg.role_id=r.id WHERE mr.member_id IN (${marks}) AND mr.effective_from<=? AND (mr.effective_to IS NULL OR mr.effective_to>?)`
          )
          .bind(...ids, day, day),
        db
          .prepare(
            `SELECT da.*,dr.role_kind FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id AND rv.status='published'
          LEFT JOIN duty_roles dr ON dr.assignment_id=da.id WHERE da.member_id IN (${marks}) AND da.business_date=?`
          )
          .bind(...ids, day),
        db
          .prepare(`SELECT * FROM staff_presence WHERE member_id IN (${marks}) AND business_date=?`)
          .bind(...ids, day),
        db
          .prepare(
            `WITH selected_members AS (SELECT value FROM json_each(?))
             SELECT ar.member_id,a.id,a.device_model,a.status FROM active_repairs ar JOIN appointments a ON a.id=ar.appointment_id WHERE ar.member_id IN (SELECT value FROM selected_members)
             UNION ALL SELECT r.assigned_member_id AS member_id,a.id,a.device_model,a.status FROM repair_receptions r JOIN appointments a ON a.id=r.appointment_id WHERE r.state='assigned' AND r.assigned_member_id IN (SELECT value FROM selected_members)`
          )
          .bind(JSON.stringify(ids)),
        db
          .prepare(
            `SELECT mm.*,d.name AS department_name FROM member_department_memberships mm JOIN departments d ON d.id=mm.department_id
          WHERE mm.member_id IN (${marks}) AND mm.effective_from<=? AND (mm.effective_to IS NULL OR mm.effective_to>?)`
          )
          .bind(...ids, day, day)
      ]);
      for (const row of rows(result[0]))
        contexts.set(row.id, {
          actor: {
            memberId: row.id,
            account: row.account,
            role: row.role,
            name: row.name,
            status: row.account_status,
            memberStatus: row.status,
            authorizedCampuses: parseJson(row.campuses, [])
          },
          businessDate: day,
          workProfiles: [],
          grants: [],
          todayDuties: [],
          memberships: [],
          presence: null,
          current: null
        });
      for (const row of rows(result[1]))
        contexts.get(row.member_id)?.workProfiles.push(profile(row));
      for (const row of rows(result[2]))
        contexts.get(row.member_id)?.grants.push({
          id: row.id,
          roleId: row.role_id,
          roleCode: row.role_code,
          permissionCode: row.permission_code,
          scope: intersectScopes(parseJson(row.scope_spec, {}), parseJson(row.scope_bindings, {})),
          conditions: parseJson(row.condition_spec, []),
          validity: parseJson(row.validity_spec, {})
        });
      for (const row of rows(result[3]))
        contexts.get(row.member_id)?.todayDuties.push(assignment(row));
      for (const row of rows(result[4])) {
        const item = contexts.get(row.member_id);
        if (item)
          item.presence = {
            businessDate: row.business_date,
            campusId: row.campus_id,
            state: row.state,
            revision: row.revision
          };
      }
      for (const row of rows(result[5])) {
        const item = contexts.get(row.member_id);
        if (item) item.current = { id: row.id, deviceModel: row.device_model, status: row.status };
      }
      for (const row of rows(result[6]))
        contexts.get(row.member_id)?.memberships.push(membership(row));
    }
    return contexts;
  }

  async function activeRepair(memberId) {
    return db
      .prepare(
        `SELECT ar.member_id,ar.account,ar.appointment_id FROM active_repairs ar
      WHERE ar.member_id=? LIMIT 1`
      )
      .bind(memberId)
      .first();
  }
  return {
    listCampuses,
    listDepartments,
    listLocations,
    listPresence,
    dutyEvent,
    latestIntake,
    receptionHistory,
    repairIdentitySnapshot,
    fieldPeople,
    fieldContexts,
    activeRepair
  };
}
