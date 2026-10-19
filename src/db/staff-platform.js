import {serviceDayRepository} from './service-days.js';
import { parseJson, SCHEMA_VERSION } from '../platform/contracts.js';
import { dateKey, nowIso } from '../platform/time.js';
import { intersectScopes } from '../modules/authorization/scopes.js';
import { rosterSwapCommands } from './roster-swaps.js';
import { attendanceCorrections } from './attendance-corrections.js';
import { rosterFingerprintSql } from './roster-fingerprint.js';
import { rosterCollectionRepository } from './roster-collection.js';

const memberColumns = `m.id,m.name,m.student_id,m.home_campus_id,m.status,m.revision,m.created_at,m.updated_at`;
const assignmentLeaveColumn = `(SELECT lr.status FROM roster_leave_facts lr WHERE lr.origin_assignment_id=COALESCE(da.origin_assignment_id,da.id) AND lr.member_id=da.member_id
  AND lr.status IN ('pending','approved') ORDER BY CASE lr.status WHEN 'approved' THEN 0 ELSE 1 END,lr.created_at DESC,lr.id DESC LIMIT 1) AS leave_status`;
const rosterTaskColumns = `rt.*,(SELECT name FROM roster_collection_series WHERE id=rt.series_id) AS collection_name,(SELECT json_group_array(json_object('businessDate',business_date,'campusId',campus_id,'ordinaryMinimum',ordinary_minimum))
  FROM (SELECT * FROM roster_staffing_requirements WHERE task_id=rt.id ORDER BY business_date,campus_id)) AS requirements_json`;

function rows(result) { return result?.results || []; }
function json(value, fallback) { return JSON.stringify(value ?? fallback); }

function membership(row) {
  return {
    id: row.id, memberId: row.member_id, departmentId: row.department_id, departmentName: row.department_name || '',
    assignmentType: row.assignment_type, isPrimary: !!row.is_primary, effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to || null, revision: row.revision
  };
}

function profile(row) { return { id: row.id, memberId: row.member_id, profileCode: row.profile_code, effectiveFrom: row.effective_from, effectiveTo: row.effective_to || null, revision: row.revision }; }

function assignment(row) {
  return row ? {
    id: row.id, versionId: row.version_id, servicePaused:!!row.service_paused, memberId: row.member_id, memberName:row.member_name||'',businessDate: row.business_date,
    campusId: row.campus_id, campusName: row.campus_name || '', dutyType: row.duty_type,
    startAt: row.start_at, endAt: row.end_at, revision: row.revision, roleKind: row.role_kind || '',
    leaveStatus: row.leave_status || '', versionStatus: row.version_status || '', originAssignmentId: row.origin_assignment_id || '', previousAssignmentId: row.previous_assignment_id || '',
    taskId:row.task_id || '',ruleVersion:row.rule_version || '',ordinaryMinimum:parseJson(row.input_snapshot_ref,{}).eligibility?.slots?.find(slot=>slot.businessDate===row.business_date && slot.campusId===row.campus_id && slot.startAt===row.start_at && slot.endAt===row.end_at)?.ordinaryMinimum
  } : null;
}

export function staffPlatformRepository(db) {
  const collection = rosterCollectionRepository(db);
  async function accountRow(account) {
    return db.prepare(`SELECT staff_accounts.*,m.id AS mapped_member_id,m.status AS member_status
      FROM staff_accounts LEFT JOIN members m ON m.id=staff_accounts.member_id WHERE staff_accounts.account=?`).bind(account).first();
  }

  async function ensureMember(account) {
    const row = await accountRow(account);
    if (!row) return null;
    if (row.member_id && row.mapped_member_id) return row.member_id;
    const memberId = `member-${row.account}`;
    const createdAt = row.created_at || nowIso();
    const campusId = row.home_campus === '浑南' ? 'campus-hunnan' : 'campus-nanhu';
    const departmentId = ['admin', 'superadmin'].includes(row.role) ? 'dept-office' : 'dept-hardware';
    const profileCode = ['admin', 'superadmin'].includes(row.role) ? 'office' : 'repair';
    const roleId = row.role === 'technician' ? 'role-technician' : row.role === 'admin' ? 'role-office' : 'role-superadmin';
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO members(id,name,student_id,home_campus_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`)
        .bind(memberId, row.name, /^\d+$/.test(row.account) ? row.account : null, campusId, row.status === 'enabled' ? 'active' : 'inactive', createdAt, createdAt),
      db.prepare(`UPDATE staff_accounts SET member_id=? WHERE account=? AND member_id IS NULL`).bind(memberId, row.account),
      db.prepare(`INSERT OR IGNORE INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,effective_from,created_at) VALUES(?,?,?,?,?,?,?)`)
        .bind(`membership-${row.account}`, memberId, departmentId, 'primary', 1, String(createdAt).slice(0, 10), createdAt),
      db.prepare(`INSERT OR IGNORE INTO member_work_profiles(id,member_id,profile_code,effective_from) VALUES(?,?,?,?)`)
        .bind(`profile-default-${row.account}`, memberId, profileCode, String(createdAt).slice(0, 10)),
      db.prepare(`INSERT OR IGNORE INTO member_roles(id,member_id,role_id,scope_bindings,effective_from) VALUES(?,?,?,?,?)`)
        .bind(`member-role-${row.account}`, memberId, roleId, row.protected ? '{"all":true}' : '{"campuses":"legacy"}', String(createdAt).slice(0, 10))
    ]);
    return memberId;
  }

  async function memberRow(memberId) {
    return db.prepare(`SELECT ${memberColumns} FROM members m WHERE m.id=?`).bind(memberId).first();
  }

  async function accountForMember(memberId) {
    return db.prepare(`SELECT staff_accounts.*,m.id AS mapped_member_id,m.status AS member_status
      FROM staff_accounts LEFT JOIN members m ON m.id=staff_accounts.member_id
      WHERE staff_accounts.member_id=? ORDER BY staff_accounts.protected DESC,staff_accounts.account LIMIT 1`).bind(memberId).first();
  }

  async function memberships(memberId, businessDate = dateKey()) {
    const result = await db.prepare(`SELECT mdm.*,d.name AS department_name FROM member_department_memberships mdm
      JOIN departments d ON d.id=mdm.department_id WHERE mdm.member_id=?
      AND mdm.effective_from<=? AND (mdm.effective_to IS NULL OR ?<mdm.effective_to)
      ORDER BY mdm.is_primary DESC,mdm.effective_from`).bind(memberId, businessDate, businessDate).all();
    return rows(result).map(membership);
  }

  async function membershipsForMembers(memberIds, businessDate = dateKey()) {
    if (!memberIds.length) return [];
    const statements = [];
    // Keep each statement below D1's 100 bound-parameter limit.
    for (let offset = 0; offset < memberIds.length; offset += 90) {
      const ids = memberIds.slice(offset, offset + 90);
      statements.push(db.prepare(`SELECT mdm.*,d.name AS department_name FROM member_department_memberships mdm
        JOIN departments d ON d.id=mdm.department_id WHERE mdm.member_id IN (${ids.map(() => '?').join(',')})
        AND mdm.effective_from<=? AND (mdm.effective_to IS NULL OR ?<mdm.effective_to)
        ORDER BY mdm.is_primary DESC,mdm.effective_from`).bind(...ids, businessDate, businessDate));
    }
    return (await db.batch(statements)).flatMap(result => rows(result).map(membership));
  }

  async function profiles(memberId, businessDate = dateKey()) {
    const result = await db.prepare(`SELECT * FROM member_work_profiles WHERE member_id=?
      AND effective_from<=? AND (effective_to IS NULL OR ?<effective_to) ORDER BY profile_code`)
      .bind(memberId, businessDate, businessDate).all();
    return rows(result).map(profile);
  }

  async function profileHistory(memberId) {
    return rows(await db.prepare('SELECT * FROM member_work_profiles WHERE member_id=? ORDER BY effective_from DESC,id').bind(memberId).all()).map(profile);
  }

  async function saveWorkProfile(memberId, input, revision, auditRecord) {
    const at = nowIso(), id = input.id || crypto.randomUUID();
    const authorization = commandAuthorization(auditRecord);
    const guard = input.id ? 'AND EXISTS(SELECT 1 FROM member_work_profiles WHERE id=? AND member_id=? AND revision=?)' :
      'AND NOT EXISTS(SELECT 1 FROM member_work_profiles WHERE member_id=? AND profile_code=? AND effective_from<COALESCE(?,\'9999-12-31\') AND (effective_to IS NULL OR effective_to>?))';
    const args = input.id ? [id,memberId,input.profileRevision] : [memberId,input.profileCode,input.effectiveTo || null,input.effectiveFrom];
    const statements = [db.prepare(`UPDATE members SET revision=revision+1,updated_at=? WHERE id=? AND revision=? ${guard} ${authorization.sql}`)
      .bind(at,memberId,revision,...args,...authorization.args),
      input.id ? db.prepare('UPDATE member_work_profiles SET effective_to=?,revision=revision+1 WHERE id=? AND member_id=? AND changes()>0').bind(input.effectiveTo,id,memberId) :
        db.prepare('INSERT INTO member_work_profiles(id,member_id,profile_code,effective_from,effective_to) SELECT ?,?,?,?,? WHERE changes()>0').bind(id,memberId,input.profileCode,input.effectiveFrom,input.effectiveTo || null),
      auditStatement({...auditRecord,sourceRef:{module:'identity',type:'work-profile',id}},true),
      db.prepare('UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id=? AND changes()>0').bind(memberId),
    ];
    const result = await db.batch(statements);
    return result[0]?.meta?.changes ? profileHistory(memberId) : null;
  }

  async function grants(memberId, businessDate = dateKey()) {
    const result = await db.prepare(`SELECT rg.id,rg.role_id,rg.permission_code,rg.scope_spec,rg.condition_spec,rg.validity_spec,mr.scope_bindings,r.code AS role_code
      FROM member_roles mr JOIN roles r ON r.id=mr.role_id AND r.enabled=1
      JOIN role_grants rg ON rg.role_id=r.id
      WHERE mr.member_id=? AND mr.effective_from<=? AND (mr.effective_to IS NULL OR ?<mr.effective_to)
      ORDER BY rg.permission_code`).bind(memberId, businessDate, businessDate).all();
    return rows(result).map(row => {
      const scope = intersectScopes(parseJson(row.scope_spec, {}), parseJson(row.scope_bindings, {}));
      return { id: row.id, roleId: row.role_id, roleCode: row.role_code, permissionCode: row.permission_code,
        scope, conditions: parseJson(row.condition_spec, []), validity: parseJson(row.validity_spec, {}) };
    });
  }

  async function todayDuties(memberId, businessDate = dateKey()) {
    const result = await db.prepare(`SELECT da.*,(SELECT paused FROM service_day_overrides s WHERE s.business_date=da.business_date AND s.campus_id=da.campus_id) AS service_paused,c.name AS campus_name,dr.role_kind,${assignmentLeaveColumn} FROM duty_assignments da
      JOIN roster_versions rv ON rv.id=da.version_id AND rv.status='published'
      JOIN campuses c ON c.id=da.campus_id LEFT JOIN duty_roles dr ON dr.assignment_id=da.id
      WHERE da.member_id=? AND da.business_date=? ORDER BY da.start_at`).bind(memberId, businessDate).all();
    return rows(result).map(assignment);
  }

  async function authorizationContext(user, businessDate = dateKey()) {
    const memberId = await ensureMember(user.account, user);
    const member = await memberRow(memberId);
    const [membershipItems, profileItems, grantItems, duties, presence] = await Promise.all([
      memberships(memberId, businessDate), profiles(memberId, businessDate), grants(memberId, businessDate), todayDuties(memberId, businessDate),
      db.prepare('SELECT * FROM staff_presence WHERE member_id=? AND business_date=?').bind(memberId, businessDate).first()
    ]);
    const authVersion = user.authVersion ?? user.tokenVersion ?? 0;
    return {
      actor: { memberId, account: user.account, name: member?.name || user.name, status: member?.status || user.status },
      member, memberships: membershipItems, workProfiles: profileItems, grants: grantItems,
      todayDuties: duties, presence: presence ? { memberId: presence.member_id, businessDate: presence.business_date, campusId: presence.campus_id, state: presence.state, revision: presence.revision } : null,
      authVersion, schemaVersion: SCHEMA_VERSION
    };
  }

  async function listMembers(filters = {}) {
    const conditions = [], args = [];
    if (filters.studentId) { conditions.push('m.student_id=?'); args.push(filters.studentId); }
    if (filters.q) { conditions.push('(m.name LIKE ? OR m.student_id LIKE ? OR EXISTS(SELECT 1 FROM staff_accounts searched WHERE searched.member_id=m.id AND searched.account LIKE ?))'); const q = `%${filters.q}%`; args.push(q, q, q); }
    if (filters.status) { conditions.push('m.status=?'); args.push(filters.status); }
    if (filters.homeCampusId) { conditions.push('m.home_campus_id=?'); args.push(filters.homeCampusId); }
    if (filters.homeCampusIds?.length) { conditions.push(`m.home_campus_id IN (${filters.homeCampusIds.map(() => '?').join(',')})`); args.push(...filters.homeCampusIds); }
    if (filters.after) { conditions.push('(m.name>? OR (m.name=? AND m.id>?))'); args.push(filters.after.name, filters.after.name, filters.after.memberId); }
    const query = `SELECT ${memberColumns},sa.account,sa.status AS account_status,sa.role,sa.auth_version,
      (SELECT GROUP_CONCAT(d.name,'、') FROM member_department_memberships mdm JOIN departments d ON d.id=mdm.department_id
       WHERE mdm.member_id=m.id AND mdm.is_primary=1 AND mdm.effective_from<=?
         AND (mdm.effective_to IS NULL OR ?<mdm.effective_to)) AS primary_department
      FROM members m LEFT JOIN staff_accounts sa ON sa.account=(SELECT account FROM staff_accounts WHERE member_id=m.id ORDER BY account LIMIT 1)
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY m.name,m.id LIMIT 101`;
    const businessDate = filters.businessDate || dateKey();
    const result = await db.prepare(query).bind(businessDate, businessDate, ...args).all();
    return rows(result).map(row => ({ memberId: row.id, name: row.name, studentId: row.student_id || '', homeCampusId: row.home_campus_id || '', status: row.status,
      account: row.account || '', accountStatus: row.account_status || '', role: row.role || '', authVersion: row.auth_version || 0,
      primaryDepartment: row.primary_department || '', revision: row.revision, memberships: [] }));
  }

  async function updateMember(memberId, patch, revision, auditRecord) {
    const fields = [], args = [];
    if (patch.name !== undefined) { fields.push('name=?'); args.push(patch.name); }
    if (patch.studentId !== undefined) { fields.push('student_id=?'); args.push(patch.studentId || null); }
    if (patch.homeCampusId !== undefined) { fields.push('home_campus_id=?'); args.push(patch.homeCampusId); }
    if (patch.status !== undefined) { fields.push('status=?'); args.push(patch.status); }
    if (!fields.length) return (await memberRow(memberId));
    const at = nowIso();
    fields.push('revision=revision+1','updated_at=?'); args.push(at, memberId, revision);
    const authorization = commandAuthorization(auditRecord);
    const account = await accountForMember(memberId);
    // All effects follow the successful CAS in the same transaction, including
    // the audit. A failed audit must not leave a changed member or session behind.
    const statements = [db.prepare(`UPDATE members SET ${fields.join(',')} WHERE id=? AND revision=? ${authorization.sql}`).bind(...args,...authorization.args)];
    if (auditRecord) statements.push(auditStatement(auditRecord,true));
    if (account && (patch.name !== undefined || patch.status !== undefined || patch.homeCampusId !== undefined)) {
      const accountFields = [], accountArgs = [];
      if (patch.name !== undefined) { accountFields.push('name=?'); accountArgs.push(patch.name); }
      // Member availability is independent of an individual login's enabled state.
      if (patch.homeCampusId !== undefined) {
        accountFields.push('home_campus=?');
        accountArgs.push(patch.homeCampusId === 'campus-hunnan' ? '浑南' : patch.homeCampusId === 'campus-nanhu' ? '南湖' : patch.homeCampusId);
      }
      if (patch.status !== undefined || patch.homeCampusId !== undefined) accountFields.push('token_version=token_version+1','auth_version=auth_version+1');
      statements.push(db.prepare(`UPDATE staff_accounts SET ${accountFields.join(',')} WHERE member_id=? AND changes()>0`)
        .bind(...accountArgs, memberId));
    }
    const result = await db.batch(statements);
    if (!result[0]?.meta?.changes) return null;
    return memberRow(memberId);
  }

  async function listMemberships(memberId, includeHistory = true) {
    const result = await db.prepare(`SELECT mdm.*,d.name AS department_name FROM member_department_memberships mdm JOIN departments d ON d.id=mdm.department_id
      WHERE mdm.member_id=? ${includeHistory ? '' : 'AND mdm.effective_to IS NULL'} ORDER BY mdm.effective_from DESC`).bind(memberId).all();
    return rows(result).map(membership);
  }

  async function addMembership(memberId, input, revision, auditRecord) {
    const id = input.id || crypto.randomUUID();
    const createdAt = nowIso();
    const authorization = commandAuthorization(auditRecord);
    const statements = [
      db.prepare(`UPDATE members SET revision=revision+1,updated_at=? WHERE id=? AND revision=? ${authorization.sql}`).bind(createdAt, memberId, revision,...authorization.args),
      db.prepare(`INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,effective_from,effective_to,created_at) SELECT ?,?,?,?,?,?,?,? WHERE changes()>0`)
        .bind(id, memberId, input.departmentId, input.assignmentType || 'secondary', input.isPrimary ? 1 : 0, input.effectiveFrom, input.effectiveTo || null, createdAt)
    ];
    if (auditRecord) statements.push(auditStatement({...auditRecord,sourceRef:{module:'organization',type:'membership',id}},true));
    statements.push(db.prepare('UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id=? AND changes()>0').bind(memberId));
    const result = await db.batch(statements);
    if (!result[0]?.meta?.changes && !result[0]?.results?.length) return null;
    return (await listMemberships(memberId)).find(item => item.id === id) || null;
  }

  async function endMembership(memberId, membershipId, effectiveTo, revision, auditRecord) {
    const authorization = commandAuthorization(auditRecord);
    const statements = [db.prepare(`UPDATE member_department_memberships SET effective_to=?,revision=revision+1
      WHERE id=? AND member_id=? AND revision=? AND (effective_to IS NULL OR effective_to>?) ${authorization.sql}`).bind(effectiveTo, membershipId, memberId, revision, effectiveTo,...authorization.args)];
    if (auditRecord) statements.push(auditStatement(auditRecord,true));
    statements.push(db.prepare('UPDATE members SET revision=revision+1,updated_at=? WHERE id=? AND changes()>0').bind(nowIso(),memberId),
      db.prepare('UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id=? AND changes()>0').bind(memberId));
    const result = await db.batch(statements);
    return result[0]?.meta?.changes ? (await listMemberships(memberId)).find(item => item.id === membershipId) : null;
  }

  async function listCampuses(includeDisabled = false) {
    const result = await db.prepare(`SELECT * FROM campuses ${includeDisabled ? '' : 'WHERE enabled=1'} ORDER BY name,id`).all();
    return rows(result).map(row => ({ id: row.id, code: row.code, name: row.name, enabled: !!row.enabled, revision: row.revision }));
  }

  async function listDepartments(includeDisabled = false) {
    const result = await db.prepare(`SELECT * FROM departments ${includeDisabled ? '' : 'WHERE enabled=1'} ORDER BY name,id`).all();
    return rows(result).map(row => ({ id: row.id, code: row.code, name: row.name, enabled: !!row.enabled, revision: row.revision }));
  }

  async function listLocations(campusId = '', includeDisabled = false) {
    const conditions = [], args = [];
    if (campusId) { conditions.push('l.campus_id=?'); args.push(campusId); }
    if (!includeDisabled) conditions.push('l.enabled=1');
    const result = await db.prepare(`SELECT l.*,c.name AS campus_name FROM locations l JOIN campuses c ON c.id=l.campus_id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY c.name,l.name,l.id`).bind(...args).all();
    return rows(result).map(row => ({ id: row.id, campusId: row.campus_id, campusName: row.campus_name, code: row.code, name: row.name, enabled: !!row.enabled, revision: row.revision }));
  }

  async function listPresence(businessDate, campusId = '') {
    const conditions = ['sp.business_date=?'], args = [businessDate];
    if (campusId) { conditions.push('sp.campus_id=?'); args.push(campusId); }
    const result = await db.prepare(`SELECT sp.*,m.name,m.student_id FROM staff_presence sp JOIN members m ON m.id=sp.member_id
      WHERE ${conditions.join(' AND ')} ORDER BY m.name,m.id`).bind(...args).all();
    return rows(result).map(row => ({ memberId: row.member_id, name: row.name, studentId: row.student_id || '', businessDate: row.business_date,
      campusId: row.campus_id, state: row.state, revision: row.revision, updatedAt: row.updated_at }));
  }

  async function dutyEvent(businessDate, campusId) {
    return event(await db.prepare("SELECT * FROM attendance_events WHERE type='duty' AND business_date=? AND campus_id=? ORDER BY created_at LIMIT 1").bind(businessDate, campusId).first());
  }

  async function latestIntake(id) {
    const row = await db.prepare('SELECT verification_json FROM repair_intake_records WHERE appointment_id=? ORDER BY verified_at DESC LIMIT 1').bind(id).first();
    return parseJson(row?.verification_json, null);
  }

  async function repairIdentitySnapshot(id) {
    const row=await db.prepare(`SELECT json_extract(after_json,'$.assigneeIdentity') AS snapshot FROM audit_events
      WHERE json_extract(source_ref,'$.module')='repairs' AND json_extract(source_ref,'$.id')=?
      AND action IN ('repairs.claimed','repairs.transferred') ORDER BY occurred_at DESC,rowid DESC LIMIT 1`).bind(id).first();
    return parseJson(row?.snapshot,null);
  }

  async function fieldPeople(day, campus) {
    const result = await db.prepare(`SELECT m.id AS memberId,m.name,
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
        WHERE da.member_id=m.id AND da.business_date=? AND da.campus_id=?) ORDER BY m.name,m.id`)
      .bind(day, day, day, campus, day, campus, day, campus, day, campus).all();
    return rows(result);
  }

  async function fieldContexts(memberIds, day) {
    const contexts = new Map();
    for (let offset = 0; offset < memberIds.length; offset += 80) {
      const ids = memberIds.slice(offset, offset + 80), marks = ids.map(() => '?').join(',');
      const result = await db.batch([
        db.prepare(`SELECT m.*,sa.account,sa.role,sa.status AS account_status,sa.auth_version,
          (SELECT json_group_array(campus) FROM staff_campus_grants WHERE account=sa.account) AS campuses
          FROM members m LEFT JOIN staff_accounts sa ON sa.account=(SELECT account FROM staff_accounts WHERE member_id=m.id ORDER BY status='enabled' DESC,account LIMIT 1)
          WHERE m.id IN (${marks})`).bind(...ids),
        db.prepare(`SELECT * FROM member_work_profiles WHERE member_id IN (${marks}) AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)`).bind(...ids,day,day),
        db.prepare(`SELECT mr.member_id,rg.*,mr.scope_bindings,r.code AS role_code FROM member_roles mr JOIN roles r ON r.id=mr.role_id AND r.enabled=1
          JOIN role_grants rg ON rg.role_id=r.id WHERE mr.member_id IN (${marks}) AND mr.effective_from<=? AND (mr.effective_to IS NULL OR mr.effective_to>?)`).bind(...ids,day,day),
        db.prepare(`SELECT da.*,dr.role_kind FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id AND rv.status='published'
          LEFT JOIN duty_roles dr ON dr.assignment_id=da.id WHERE da.member_id IN (${marks}) AND da.business_date=?`).bind(...ids,day),
        db.prepare(`SELECT * FROM staff_presence WHERE member_id IN (${marks}) AND business_date=?`).bind(...ids,day),
        db.prepare(`SELECT ar.member_id,a.id,a.device_model FROM active_repairs ar JOIN appointments a ON a.id=ar.appointment_id WHERE ar.member_id IN (${marks})`).bind(...ids),
        db.prepare(`SELECT mm.*,d.name AS department_name FROM member_department_memberships mm JOIN departments d ON d.id=mm.department_id
          WHERE mm.member_id IN (${marks}) AND mm.effective_from<=? AND (mm.effective_to IS NULL OR mm.effective_to>?)`).bind(...ids,day,day),
      ]);
      for (const row of rows(result[0])) contexts.set(row.id, { actor: { memberId: row.id,account:row.account,role:row.role,name:row.name,status:row.account_status,memberStatus:row.status,authorizedCampuses:parseJson(row.campuses,[]) }, businessDate:day, workProfiles:[],grants:[],todayDuties:[],memberships:[],presence:null,current:null });
      for (const row of rows(result[1])) contexts.get(row.member_id)?.workProfiles.push(profile(row));
      for (const row of rows(result[2])) contexts.get(row.member_id)?.grants.push({id:row.id,roleId:row.role_id,roleCode:row.role_code,permissionCode:row.permission_code,
        scope:intersectScopes(parseJson(row.scope_spec,{}),parseJson(row.scope_bindings,{})),conditions:parseJson(row.condition_spec,[]),validity:parseJson(row.validity_spec,{})});
      for (const row of rows(result[3])) contexts.get(row.member_id)?.todayDuties.push(assignment(row));
      for (const row of rows(result[4])) { const item=contexts.get(row.member_id); if(item) item.presence={businessDate:row.business_date,campusId:row.campus_id,state:row.state,revision:row.revision}; }
      for (const row of rows(result[5])) { const item=contexts.get(row.member_id); if(item) item.current={id:row.id,deviceModel:row.device_model}; }
      for (const row of rows(result[6])) contexts.get(row.member_id)?.memberships.push(membership(row));
    }
    return contexts;
  }

  async function activeRepair(memberId) {
    return db.prepare(`SELECT ar.member_id,ar.account,ar.appointment_id FROM active_repairs ar
      WHERE ar.member_id=? LIMIT 1`).bind(memberId).first();
  }

  async function importMembers(items, actorAccount, auditRecord) {
    const at = nowIso();
    const statements = [];
    const roleRows = rows(await db.prepare('SELECT id,code FROM roles WHERE enabled=1').all());
    const rolesByCode = Object.fromEntries(roleRows.map(row => [row.code, row.id]));
    for (const item of items) {
      const existing = await db.prepare('SELECT id FROM members WHERE student_id=?').bind(item.studentId).first();
      const id = existing?.id || item.memberId || `member-${item.studentId}`;
      statements.push(db.prepare(`INSERT INTO members(id,name,student_id,home_campus_id,status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(student_id) DO UPDATE SET name=excluded.name,home_campus_id=excluded.home_campus_id,status=excluded.status,
          revision=members.revision+1,updated_at=excluded.updated_at`).bind(id,item.name,item.studentId,item.homeCampusId,item.status || 'active',at,at));
      if (item.departmentId) statements.push(db.prepare(`INSERT OR IGNORE INTO member_department_memberships
        (id,member_id,department_id,assignment_type,is_primary,effective_from,created_at)
        VALUES(?,?,?,?,?,?,?)`).bind(`membership-${item.studentId}-${item.departmentId}`,id,item.departmentId,item.assignmentType || 'primary',item.isPrimary === false ? 0 : 1,item.effectiveFrom || dateKey(),at));
      for (const profileCode of item.workProfiles || []) statements.push(db.prepare(`INSERT OR IGNORE INTO member_work_profiles(id,member_id,profile_code,effective_from)
        VALUES(?,?,?,?)`).bind(`profile-import-${item.studentId}-${profileCode}`,id,profileCode,item.effectiveFrom || dateKey()));
      for (const roleCode of item.roleCodes || []) {
        if (!rolesByCode[roleCode]) continue;
        const campusIds = (item.authorizedCampuses || []).map(value => ({ 南湖: 'campus-nanhu', 浑南: 'campus-hunnan' }[value] || value));
        statements.push(db.prepare(`INSERT OR IGNORE INTO member_roles(id,member_id,role_id,scope_bindings,effective_from)
          VALUES(?,?,?,?,?)`).bind(`member-role-import-${item.studentId}-${roleCode}`,id,rolesByCode[roleCode],json(campusIds.length ? { campusIds } : {},),item.effectiveFrom || dateKey()));
      }
      const account = await db.prepare('SELECT account FROM staff_accounts WHERE member_id=?').bind(id).first();
      const campusIds = (item.authorizedCampuses || []).map(value => ({ 'campus-nanhu': '南湖', 'campus-hunnan': '浑南' }[value] || value));
      if (account && campusIds.length) {
        statements.push(db.prepare('DELETE FROM staff_campus_grants WHERE account=?').bind(account.account));
        for (const campus of campusIds) statements.push(db.prepare('INSERT OR IGNORE INTO staff_campus_grants(account,campus) VALUES(?,?)').bind(account.account,campus));
      }
      if(account) statements.push(db.prepare('UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id=?').bind(id));
      if (!account && item.workProfiles?.length && item.roleCodes?.length && campusIds.length) {
        statements.push(db.prepare(`INSERT INTO staff_whitelist(student_id,expected_name,expected_role,created_by,created_at)
          VALUES(?,?,?,?,?) ON CONFLICT(student_id) DO UPDATE SET expected_name=excluded.expected_name,expected_role=excluded.expected_role,revision=staff_whitelist.revision+1
          WHERE staff_whitelist.status='open'`).bind(item.studentId,item.name,item.workProfiles.includes('office') && !item.workProfiles.some(code=>['repair','exchange'].includes(code)) ? 'admin' : 'technician',actorAccount,at));
        statements.push(db.prepare('INSERT OR IGNORE INTO activation_member_bindings(student_id,member_id) VALUES(?,?)').bind(item.studentId,id));
        statements.push(db.prepare("DELETE FROM whitelist_campus_grants WHERE student_id=? AND EXISTS(SELECT 1 FROM staff_whitelist WHERE student_id=? AND status='open')").bind(item.studentId,item.studentId));
        for(const campus of campusIds) statements.push(db.prepare("INSERT OR IGNORE INTO whitelist_campus_grants(student_id,campus) SELECT ?,? WHERE EXISTS(SELECT 1 FROM staff_whitelist WHERE student_id=? AND status='open')").bind(item.studentId,campus,item.studentId));
      }
    }
    if (statements.length) {
      if(auditRecord) statements.push(auditStatement(auditRecord));
      await db.batch(statements);
    }
    const result = [];
    for (let offset=0;offset<items.length;offset+=90) {
      const page=items.slice(offset,offset+90);
      result.push(...rows(await db.prepare(`SELECT ${memberColumns} FROM members m WHERE m.student_id IN (${page.map(() => '?').join(',')})`).bind(...page.map(item => item.studentId)).all()));
    }
    return result.sort((a,b)=>a.student_id.localeCompare(b.student_id));
  }

  async function permissionDefinitions() {
    const result = await db.prepare('SELECT * FROM permission_definitions WHERE enabled=1 ORDER BY module_code,code').all();
    return rows(result).map(row => ({ code: row.code, module: row.module_code, name: row.name, description: row.description, scopeKinds: parseJson(row.scope_kinds, []), conditionKinds: parseJson(row.condition_kinds, []), sensitive: !!row.sensitive, version: row.version }));
  }

  async function listRoles() {
    const result = await db.prepare(`SELECT r.*,json_group_array(json_object('id',rg.id,'permissionCode',rg.permission_code,'scope',rg.scope_spec,'conditions',rg.condition_spec,'validity',rg.validity_spec)) AS grants
      FROM roles r LEFT JOIN role_grants rg ON rg.role_id=r.id GROUP BY r.id ORDER BY r.level DESC,r.name`).all();
    return rows(result).map(row => ({ id: row.id, code: row.code, name: row.name, description: row.description, level: row.level, enabled: !!row.enabled, revision: row.revision,
      grants: parseJson(row.grants, []).filter(item => item.id).map(item => ({ ...item, scope: parseJson(item.scope, {}), conditions: parseJson(item.conditions, []), validity: parseJson(item.validity, {}) })) }));
  }

  async function createRole(input, auditRecord) {
    const id = input.id || crypto.randomUUID(); const at = nowIso();
    const authorization = commandAuthorization(auditRecord);
    const marker=crypto.randomUUID(), gate=auditRecord ? 'EXISTS(SELECT 1 FROM audit_events WHERE id=?)' : '1=1',gateArgs=auditRecord ? [marker] : [];
    const statements = auditRecord ? [auditStatement({...auditRecord,id:marker,sourceRef:{module:'authorization',type:'role',id}},false,{sql:`1=1 ${authorization.sql}`,args:authorization.args})] : [];
    statements.push(db.prepare(`INSERT INTO roles(id,code,name,description,level,enabled,created_at,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE ${gate}`)
      .bind(id,input.code,input.name,input.description || '',input.level || 1,input.enabled === false ? 0 : 1,at,at,...gateArgs));
    for (const grant of input.grants || []) statements.push(db.prepare(`INSERT INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec,validity_spec) SELECT ?,?,?,?,?,? WHERE ${gate}`)
      .bind(grant.id || crypto.randomUUID(),id,grant.permissionCode,json(grant.scope,{}),json(grant.conditions,[]),json(grant.validity,{}),...gateArgs));
    await db.batch(statements);
    return (await listRoles()).find(role => role.id === id);
  }

  async function updateRole(id, input, revision, auditRecord) {
    const at = nowIso();
    const fields = [], args = [];
    for (const [key, column] of [['name','name'],['description','description'],['level','level'],['enabled','enabled']]) if (input[key] !== undefined) { fields.push(`${column}=?`); args.push(key === 'enabled' ? (input[key] ? 1 : 0) : input[key]); }
    fields.push('revision=revision+1','updated_at=?'); args.push(at,id,revision);
    const authorization=commandAuthorization(auditRecord),marker=crypto.randomUUID();
    const gate=auditRecord ? 'EXISTS(SELECT 1 FROM audit_events WHERE id=?)' : 'EXISTS(SELECT 1 FROM roles WHERE id=? AND revision=?)';
    const gateArgs=auditRecord ? [marker] : [id,revision];
    const statements = auditRecord ? [auditStatement({...auditRecord,id:marker},false,{sql:`EXISTS(SELECT 1 FROM roles WHERE id=? AND revision=?) ${authorization.sql}`,args:[id,revision,...authorization.args]})] : [];
    if (input.grants) {
      statements.push(db.prepare(`DELETE FROM role_grants WHERE role_id=? AND ${gate}`).bind(id,...gateArgs));
      for (const grant of input.grants) statements.push(db.prepare(`INSERT INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec,validity_spec) SELECT ?,?,?,?,?,? WHERE ${gate}`)
        .bind(grant.id || crypto.randomUUID(),id,grant.permissionCode,json(grant.scope,{}),json(grant.conditions,[]),json(grant.validity,{}),...gateArgs));
    }
    statements.push(db.prepare(`UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id IN (SELECT member_id FROM member_roles WHERE role_id=?) AND ${gate}`).bind(id,...gateArgs));
    statements.push(db.prepare(`UPDATE roles SET ${fields.join(',')} WHERE id=? AND revision=? AND ${gate}`).bind(...args,...gateArgs));
    const result = await db.batch(statements);
    if (!result.at(-1)?.meta?.changes) return null;
    return (await listRoles()).find(role => role.id === id) || null;
  }

  async function roleBindings(memberId) {
    const result = await db.prepare('SELECT * FROM member_roles WHERE member_id=? ORDER BY effective_from,id').bind(memberId).all();
    return rows(result).map(row => ({ id: row.id, roleId: row.role_id, scope: parseJson(row.scope_bindings, {}), effectiveFrom: row.effective_from, effectiveTo: row.effective_to, revision: row.revision }));
  }

  async function bindRoles(memberId, bindings, revision, auditRecord) {
    const at = nowIso();
    const authorization=commandAuthorization(auditRecord),marker=crypto.randomUUID();
    const gate=auditRecord ? 'EXISTS(SELECT 1 FROM audit_events WHERE id=?)' : 'EXISTS(SELECT 1 FROM members WHERE id=? AND revision=?)';
    const gateArgs=auditRecord ? [marker] : [memberId,revision];
    const statements = auditRecord ? [auditStatement({...auditRecord,id:marker},false,{sql:`EXISTS(SELECT 1 FROM members WHERE id=? AND revision=?) ${authorization.sql}`,args:[memberId,revision,...authorization.args]})] : [];
    statements.push(db.prepare(`DELETE FROM member_roles WHERE member_id=? AND ${gate}`).bind(memberId,...gateArgs),
      db.prepare(`UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id=? AND ${gate}`).bind(memberId,...gateArgs));
    for (const binding of bindings) statements.push(db.prepare(`INSERT INTO member_roles(id,member_id,role_id,scope_bindings,effective_from,effective_to) SELECT ?,?,?,?,?,? WHERE ${gate}`)
      .bind(binding.id || crypto.randomUUID(),memberId,binding.roleId,json(binding.scope,{}),binding.effectiveFrom || dateKey(),binding.effectiveTo || null,...gateArgs));
    statements.push(db.prepare(`UPDATE members SET revision=revision+1,updated_at=? WHERE id=? AND revision=? AND ${gate}`).bind(at,memberId,revision,...gateArgs));
    const result = await db.batch(statements);
    return !!result.at(-1)?.meta?.changes;
  }

  async function modules() {
    const result = await db.prepare('SELECT * FROM module_catalog WHERE release_state<>\'disabled\' ORDER BY code').all();
    return rows(result).map(row => ({ code: row.code, version: row.version, manifestHash: row.manifest_hash, contractVersion: row.contract_version, requiredSchemaVersion: row.required_schema_version, releaseState: row.release_state, manifest: parseJson(row.manifest_json, {}) }));
  }

  async function createEvent(input, actorMemberId, auditRecord) {
    if (input.type === 'duty') {
      const existing = await db.prepare(`SELECT * FROM attendance_events WHERE type='duty' AND business_date=? AND COALESCE(campus_id,'')=COALESCE(?, '') ORDER BY created_at LIMIT 1`)
        .bind(input.businessDate, input.campusId || null).first();
      if (existing) return event(existing);
    }
    const id = input.id || crypto.randomUUID(); const at = nowIso();
    const authorization=commandAuthorization(auditRecord);
    const statements=[db.prepare(`INSERT INTO attendance_events(id,type,policy_code,policy_version,rule_snapshot,campus_id,business_date,starts_at,ends_at,source_ref,created_by_member_id,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE (?<>'duty' OR NOT EXISTS(SELECT 1 FROM attendance_events WHERE type='duty' AND business_date=? AND COALESCE(campus_id,'')=COALESCE(?,''))) ${authorization.sql}`)
      .bind(id,input.type,input.policyCode,input.policyVersion,json(input.ruleSnapshot,{}),input.campusId || null,input.businessDate,input.startsAt,input.endsAt,json(input.sourceRef,{}),actorMemberId,at,input.type,input.businessDate,input.campusId || null,...authorization.args)];
    if(auditRecord)statements.push(auditStatement({...auditRecord,sourceRef:{module:'attendance',type:'event',id}},true));
    await db.batch(statements);
    return event(await db.prepare("SELECT * FROM attendance_events WHERE id=? OR (?='duty' AND type='duty' AND business_date=? AND COALESCE(campus_id,'')=COALESCE(?,'')) ORDER BY created_at,id LIMIT 1").bind(id,input.type,input.businessDate,input.campusId || null).first());
  }

  async function issueToken(eventId, tokenHash, expiresAt, actorMemberId, revision) {
    const at = nowIso();
    const statements = [
      db.prepare('UPDATE attendance_tokens SET revoked_at=? WHERE event_id=? AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM attendance_events WHERE id=? AND revision=?)').bind(at,eventId,eventId,revision),
      db.prepare('INSERT INTO attendance_tokens(id,event_id,token_hash,version,issued_at,expires_at) SELECT ?,?,?,COALESCE((SELECT MAX(version)+1 FROM attendance_tokens WHERE event_id=?),1),?,? WHERE EXISTS(SELECT 1 FROM attendance_events WHERE id=? AND revision=?)')
        .bind(crypto.randomUUID(),eventId,tokenHash,eventId,at,expiresAt,eventId,revision),
      db.prepare('UPDATE attendance_events SET revision=revision+1 WHERE id=? AND revision=?').bind(eventId,revision)];
    const result = await db.batch(statements);
    if (!result.at(-1)?.meta?.changes) return null;
    return db.prepare('SELECT id,event_id,version,issued_at,expires_at FROM attendance_tokens WHERE token_hash=?').bind(tokenHash).first();
  }

  function event(row) {
    return row ? { id: row.id, type: row.type, policyCode: row.policy_code, policyVersion: row.policy_version, ruleSnapshot: parseJson(row.rule_snapshot, {}), campusId: row.campus_id, businessDate: row.business_date, startsAt: row.starts_at, endsAt: row.ends_at, sourceRef: parseJson(row.source_ref, {}), revision: row.revision, createdAt: row.created_at } : null;
  }

  async function findEventByToken(tokenHash) {
    const row = await db.prepare(`SELECT e.*,t.id AS token_id,t.version AS token_version,t.expires_at AS token_expires_at FROM attendance_tokens t JOIN attendance_events e ON e.id=t.event_id
      WHERE t.token_hash=? AND t.revoked_at IS NULL AND t.expires_at>?`).bind(tokenHash, nowIso()).first();
    return row ? { event: event(row), token: { id: row.token_id, version: row.token_version, expiresAt: row.token_expires_at } } : null;
  }

  async function attendanceEvent(id) {
    return event(await db.prepare('SELECT * FROM attendance_events WHERE id=?').bind(id).first());
  }

  async function findAttendanceByDedupe(dedupeKey) {
    const row = await db.prepare(`SELECT ar.*,(SELECT paused FROM service_day_overrides WHERE business_date=e.business_date AND campus_id=e.campus_id) AS service_paused,e.type,e.business_date,e.campus_id FROM attendance_records ar JOIN attendance_events e ON e.id=ar.event_id WHERE ar.dedupe_key=?`).bind(dedupeKey).first();
    return row ? attendanceRecord(row) : null;
  }

  function attendanceRecord(row) {
    return row ? { id: row.id, memberId: row.member_id, eventId: row.event_id, dedupeKey: row.dedupe_key, occurredAt: row.occurred_at, recordedAt: row.recorded_at, method: row.method, sourceRef: parseJson(row.source_ref, {}), businessDate: row.business_date, type: row.type, campusId: row.campus_id, primaryDepartmentIdSnapshot: row.primary_department_id_snapshot, primaryDepartmentNameSnapshot: row.primary_department_name_snapshot, identitySnapshot: parseJson(row.identity_snapshot, {}), nonScheduled: !!row.non_scheduled,servicePaused:!!row.service_paused, revision: row.revision } : null;
  }

  async function insertAttendance(record, presence) {
    const previousPresence = presence ? await db.prepare('SELECT state FROM staff_presence WHERE member_id=? AND business_date=?')
      .bind(record.memberId, record.businessDate).first() : null;
    const guard = record.tokenId ? ` WHERE EXISTS(SELECT 1 FROM attendance_tokens t JOIN attendance_events e ON e.id=t.event_id WHERE t.id=? AND t.revoked_at IS NULL AND julianday(t.expires_at)>julianday(?) AND julianday(e.starts_at)<=julianday(?) AND julianday(e.ends_at)>=julianday(?)) AND EXISTS(SELECT 1 FROM staff_accounts sa JOIN members m ON m.id=sa.member_id WHERE sa.account=? AND sa.auth_version=? AND sa.status='enabled' AND m.status='active')` : '';
    const guardArgs = record.tokenId ? [record.tokenId,record.recordedAt,record.recordedAt,record.recordedAt,record.actorAccount,record.authVersion] : [];
    const statements = [db.prepare(`INSERT INTO attendance_records(id,member_id,event_id,dedupe_key,occurred_at,recorded_at,method,source_ref,primary_department_id_snapshot,primary_department_name_snapshot,identity_snapshot,non_scheduled)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?${guard}`).bind(record.id,record.memberId,record.eventId,record.dedupeKey,record.occurredAt,record.recordedAt,record.method,json(record.sourceRef,{}),record.departmentId || null,record.departmentName || null,json(record.identitySnapshot,{}),record.nonScheduled ? 1 : 0,...guardArgs)];
    if (presence) {
      statements.push(db.prepare(`INSERT INTO staff_presence(member_id,business_date,campus_id,state,revision,updated_at) SELECT ?,?,?,?,0,? WHERE EXISTS(SELECT 1 FROM attendance_records WHERE id=?)
        ON CONFLICT(member_id,business_date) DO UPDATE SET campus_id=excluded.campus_id,state='available',revision=staff_presence.revision+1,updated_at=excluded.updated_at`)
        .bind(record.memberId,record.businessDate,record.campusId,'available',record.recordedAt,record.id));
      statements.push(db.prepare(`INSERT INTO presence_events(id,member_id,business_date,from_state,to_state,occurred_at,actor_member_id,actor_account)
        SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM attendance_records WHERE id=?)`).bind(crypto.randomUUID(),record.memberId,record.businessDate,previousPresence?.state || null,'available',record.recordedAt,record.memberId,record.actorAccount || null,record.id));
    }
    if (record.checkInAudit) {
      statements.push(db.prepare(`INSERT INTO audit_events(id,actor_member_id,actor_account,action,source_ref,after_json,request_id,occurred_at)
        SELECT ?,?,?,'attendance.checked_in',?,?,?,? WHERE EXISTS(SELECT 1 FROM attendance_records WHERE id=?)`).bind(crypto.randomUUID(),record.memberId,record.actorAccount,json({module:'attendance',type:'record',id:record.id},{}),json({eventId:record.eventId,occurredAt:record.occurredAt},{}),record.requestId || null,record.recordedAt,record.id));
      if (record.requestId) statements.push(db.prepare(`UPDATE operation_receipts SET result_status='success',resource_ref=?,result_json=?
        WHERE actor_member_id=? AND action='attendance.checkin' AND request_id=? AND payload_hash=? AND EXISTS(SELECT 1 FROM attendance_records WHERE id=?)`).bind(json({module:'attendance',type:'record',id:record.id},{}),json(record,{}),record.memberId,record.requestId,record.payloadHash,record.id));
    }
    try {
      const result = await db.batch(statements);
      return result[0]?.meta?.changes ? attendanceRecord(await db.prepare(`SELECT ar.*,e.type,e.business_date,e.campus_id FROM attendance_records ar JOIN attendance_events e ON e.id=ar.event_id WHERE ar.id=?`).bind(record.id).first()) : null;
    } catch (error) {
      if (`${error.message || ''}`.includes('attendance_records.dedupe_key')) return null;
      throw error;
    }
  }

  async function listAttendance(filters = {}) {
    const conditions = [], args = [];
    if (filters.memberId) { conditions.push('ar.member_id=?'); args.push(filters.memberId); }
    if (filters.businessDate) { conditions.push('e.business_date=?'); args.push(filters.businessDate); }
    if (filters.type) { conditions.push('e.type=?'); args.push(filters.type); }
    if (filters.month) {conditions.push("e.business_date>=? AND e.business_date<date(?,'+1 month')");args.push(`${filters.month}-01`,`${filters.month}-01`);}
    if (filters.departmentId) {conditions.push('ar.primary_department_id_snapshot=?');args.push(filters.departmentId);}
    if (filters.campusId) { conditions.push('e.campus_id=?'); args.push(filters.campusId); }
    if (filters.campusIds?.length) { conditions.push(`e.campus_id IN (${filters.campusIds.map(() => '?').join(',')})`); args.push(...filters.campusIds); }
    if (filters.after) { conditions.push('(ar.occurred_at<? OR (ar.occurred_at=? AND ar.id<?))'); args.push(filters.after.occurredAt,filters.after.occurredAt,filters.after.id); }
    const result = await db.prepare(`SELECT ar.*,(SELECT paused FROM service_day_overrides s WHERE s.business_date=e.business_date AND s.campus_id=e.campus_id) AS service_paused,e.type,e.business_date,e.campus_id FROM attendance_records ar JOIN attendance_events e ON e.id=ar.event_id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY ar.occurred_at DESC,ar.id DESC LIMIT 101`).bind(...args).all();
    return rows(result).map(attendanceRecord);
  }
  async function attendanceById(id) {return attendanceRecord(await db.prepare('SELECT ar.*,(SELECT paused FROM service_day_overrides s WHERE s.business_date=e.business_date AND s.campus_id=e.campus_id) AS service_paused,e.type,e.business_date,e.campus_id FROM attendance_records ar JOIN attendance_events e ON e.id=ar.event_id WHERE ar.id=?').bind(id).first());}
  async function attendanceOptions(filters) {
    const result=await db.batch([
      db.prepare('SELECT * FROM attendance_events WHERE business_date=? AND campus_id=? ORDER BY starts_at,id LIMIT 101').bind(filters.businessDate,filters.campusId),
      db.prepare(`SELECT m.*,mm.department_id,d.name AS department_name FROM members m LEFT JOIN member_department_memberships mm ON mm.member_id=m.id
        AND mm.is_primary=1 AND mm.effective_from<=? AND (mm.effective_to IS NULL OR mm.effective_to>?) LEFT JOIN departments d ON d.id=mm.department_id
        WHERE ?<>'' AND (instr(m.name,?)>0 OR instr(COALESCE(m.student_id,''),?)>0) ORDER BY m.name,m.id LIMIT 51`).bind(filters.businessDate,filters.businessDate,filters.q,filters.q,filters.q)
    ]);
    return {events:rows(result[0]).map(event),members:rows(result[1]).map(row=>({memberId:row.id,name:row.name,studentId:row.student_id,departmentId:row.department_id,departmentName:row.department_name}))};
  }

  async function attendanceExport(filters = {}) {
    const conditions = ["e.type='duty'", "NOT EXISTS(SELECT 1 FROM service_day_overrides s WHERE s.business_date=e.business_date AND s.campus_id=e.campus_id AND s.paused=1)"]; const args = [];
    if (filters.month) { conditions.push('e.business_date>=? AND e.business_date<?'); args.push(`${filters.month}-01`, filters.nextMonth); }
    if (filters.campusIds?.length) { conditions.push(`e.campus_id IN (${filters.campusIds.map(() => '?').join(',')})`); args.push(...filters.campusIds); }
    if (filters.memberId) { conditions.push('ar.member_id=?'); args.push(filters.memberId); }
    if (filters.departmentId) { conditions.push('ar.primary_department_id_snapshot=?'); args.push(filters.departmentId); }
    const result = await db.prepare(`SELECT e.campus_id,c.name AS campus_name,ar.member_id,
      COALESCE(json_extract(ar.identity_snapshot,'$.name'),m.name) AS member_name,
      COALESCE(json_extract(ar.identity_snapshot,'$.studentId'),m.student_id,'') AS student_id,
      ar.primary_department_id_snapshot,ar.primary_department_name_snapshot,
      COUNT(DISTINCT e.business_date) AS attendance_count
      FROM attendance_records ar JOIN attendance_events e ON e.id=ar.event_id
      JOIN members m ON m.id=ar.member_id LEFT JOIN campuses c ON c.id=e.campus_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY e.campus_id,c.name,ar.member_id,member_name,student_id,ar.primary_department_id_snapshot,ar.primary_department_name_snapshot
      ORDER BY c.name,member_name,ar.member_id`).bind(...args).all();
    return rows(result).map(row => ({ campusId: row.campus_id || '', campus: row.campus_name || row.campus_id || '', memberId: row.member_id,
      memberName: row.member_name || '', studentId: row.student_id || '', attendanceCount: Number(row.attendance_count || 0),
      departmentId: row.primary_department_id_snapshot || '', department: row.primary_department_name_snapshot || '' }));
  }
  async function setPresence(memberId, input, revision, actor, auditRecord) {
    const at = nowIso();
    const existing = await db.prepare('SELECT * FROM staff_presence WHERE member_id=? AND business_date=?').bind(memberId,input.businessDate).first();
    const expected = existing ? revision : 0;
    const authorization=commandAuthorization(auditRecord);
    if (auditRecord && !existing) return null;
    const statement = existing ? db.prepare(`UPDATE staff_presence SET state=?,campus_id=?,revision=revision+1,updated_at=? WHERE member_id=? AND business_date=? AND revision=? ${authorization.sql}`)
      .bind(input.state,input.campusId || existing.campus_id,at,memberId,input.businessDate,expected,...authorization.args)
      : db.prepare(`INSERT INTO staff_presence(member_id,business_date,campus_id,state,revision,updated_at) VALUES(?,?,?,?,0,?)`).bind(memberId,input.businessDate,input.campusId || null,input.state,at);
    const expectedRevision = existing ? Number(expected) + 1 : 0;
    const result = await db.batch([statement,db.prepare(`INSERT INTO presence_events(id,member_id,business_date,from_state,to_state,occurred_at,actor_member_id,actor_account)
      SELECT ?,?,?,?,?,?,?,? WHERE changes()>0`)
      .bind(crypto.randomUUID(),memberId,input.businessDate,existing?.state || null,input.state,at,actor.memberId,actor.account),...(auditRecord ? [auditStatement(auditRecord,true)] : [])]);
    return result[0]?.meta?.changes ? { memberId,businessDate:input.businessDate,campusId:input.campusId || existing?.campus_id || null,state:input.state,revision:expectedRevision } : null;
  }

  async function createReceipt(actorMemberId, action, requestIdValue, payloadHash, resultValue, resourceRef = {}) {
    await db.prepare(`UPDATE operation_receipts SET resource_ref=?,result_json=?,result_status='success'
      WHERE actor_member_id=? AND action=? AND request_id=? AND payload_hash=?`)
      .bind(json(resourceRef,{}),json(resultValue,{}),actorMemberId,action,requestIdValue,payloadHash).run();
  }
  async function claimReceipt(actorMemberId, action, requestIdValue, payloadHash) {
    const result = await db.prepare(`INSERT OR IGNORE INTO operation_receipts(actor_member_id,action,request_id,payload_hash,resource_ref,result_json,result_status,created_at)
      VALUES(?,?,?,?,?,'{}','pending',?)`).bind(actorMemberId,action,requestIdValue,payloadHash,'{}',nowIso()).run();
    return !!result.meta?.changes;
  }
  async function releaseReceipt(actorMemberId, action, requestIdValue, payloadHash) {
    await db.prepare(`DELETE FROM operation_receipts WHERE actor_member_id=? AND action=? AND request_id=? AND payload_hash=? AND result_status='pending'`)
      .bind(actorMemberId,action,requestIdValue,payloadHash).run();
  }
  async function receipt(actorMemberId, action, requestIdValue) {
    const row = await db.prepare('SELECT * FROM operation_receipts WHERE actor_member_id=? AND action=? AND request_id=?').bind(actorMemberId,action,requestIdValue).first();
    return row ? { payloadHash: row.payload_hash, resourceRef: parseJson(row.resource_ref, {}), result: parseJson(row.result_json, {}), resultStatus: row.result_status, createdAt: row.created_at } : null;
  }
  function auditStatement(input, conditional = false, guard) {
    return db.prepare(`INSERT INTO audit_events(id,actor_member_id,actor_account,action,action_version,source_ref,before_json,after_json,reason,request_id,request_trace_id,occurred_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,? ${guard ? `WHERE ${guard.sql}` : conditional ? 'WHERE changes()>0' : ''}`).bind(input.id || crypto.randomUUID(),input.actorMemberId || null,input.actorAccount || null,input.action,input.actionVersion || '1',json(input.sourceRef,{}),input.before === undefined ? null : json(input.before,{}),input.after === undefined ? null : json(input.after,{}),input.reason || '',input.requestId || null,input.requestTraceId || null,input.occurredAt || nowIso(),...(guard?.args || []));
  }
  async function audit(input) { await auditStatement(input).run(); }
  async function listAudit(filters = {}) {
    const conditions = [], args = [];
    if (filters.actorMemberId) { conditions.push('actor_member_id=?'); args.push(filters.actorMemberId); }
    if (filters.action) { conditions.push('action=?'); args.push(filters.action); }
    const result = await db.prepare(`SELECT * FROM audit_events ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY occurred_at DESC,id DESC LIMIT 501`).bind(...args).all();
    return rows(result).map(row => ({ id: row.id, actorMemberId: row.actor_member_id, actorAccount: row.actor_account, action: row.action, actionVersion: row.action_version, sourceRef: parseJson(row.source_ref, {}), before: parseJson(row.before_json, null), after: parseJson(row.after_json, null), reason: row.reason, requestId: row.request_id, occurredAt: row.occurred_at }));
  }

  async function officeRosterMemberIds(weekStart, campusIds) {
    const campusNames = campusIds.map(value => ({ 'campus-nanhu': '南湖', 'campus-hunnan': '浑南' }[value] || value));
    return rows(await db.prepare(`SELECT DISTINCT m.id FROM members m JOIN member_work_profiles p ON p.member_id=m.id
      WHERE m.status='active' AND p.profile_code='office' AND p.effective_from<=date(?,'+3 day')
      AND (p.effective_to IS NULL OR p.effective_to>?) AND EXISTS(SELECT 1 FROM staff_accounts sa JOIN staff_campus_grants g ON g.account=sa.account
        WHERE sa.member_id=m.id AND sa.status='enabled' AND g.campus IN (${campusNames.map(() => '?').join(',')}))
      ORDER BY m.name,m.id LIMIT 301`).bind(weekStart,weekStart,...campusNames).all()).map(row => row.id);
  }
  async function rosterMemberFacts(memberIds, weekStart) {
    const facts = new Map();
    for (let offset = 0; offset < memberIds.length; offset += 80) {
      const ids = memberIds.slice(offset, offset + 80), placeholders = ids.map(() => '?').join(',');
      const results = await db.batch([
        db.prepare(`SELECT m.id,m.name,m.status,MAX(CASE WHEN sa.status='enabled' THEN 1 ELSE 0 END) AS enabled,
          (SELECT role FROM staff_accounts WHERE member_id=m.id AND status='enabled' ORDER BY account LIMIT 1) AS role
          FROM members m LEFT JOIN staff_accounts sa ON sa.member_id=m.id WHERE m.id IN (${placeholders}) GROUP BY m.id`).bind(...ids),
        db.prepare(`SELECT DISTINCT sa.member_id,g.campus FROM staff_accounts sa JOIN staff_campus_grants g ON g.account=sa.account
          WHERE sa.member_id IN (${placeholders}) AND sa.status='enabled'`).bind(...ids),
        db.prepare(`SELECT * FROM member_work_profiles WHERE member_id IN (${placeholders}) AND effective_from<=date(?,'+6 day')
          AND (effective_to IS NULL OR effective_to>?)`).bind(...ids,weekStart,weekStart),
        db.prepare(`SELECT da.*,rv.task_id FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id AND rv.status='published'
          WHERE da.member_id IN (${placeholders}) AND da.business_date>=? AND da.business_date<=date(?,'+6 day')`).bind(...ids,weekStart,weekStart),
        db.prepare(`SELECT mm.*,d.name AS department_name FROM member_department_memberships mm JOIN departments d ON d.id=mm.department_id
          WHERE mm.member_id IN (${placeholders}) AND mm.effective_from<=date(?,'+6 day') AND (mm.effective_to IS NULL OR mm.effective_to>?) ORDER BY mm.is_primary DESC,d.name`).bind(...ids,weekStart,weekStart),
        db.prepare(`SELECT mr.member_id,mr.effective_from AS binding_from,mr.effective_to AS binding_to,mr.scope_bindings,rg.*
          FROM member_roles mr JOIN roles r ON r.id=mr.role_id AND r.enabled=1 JOIN role_grants rg ON rg.role_id=r.id
          WHERE mr.member_id IN (${placeholders}) AND mr.effective_from<=date(?,'+6 day') AND (mr.effective_to IS NULL OR mr.effective_to>?)`).bind(...ids,weekStart,weekStart)
      ]);
      for (const row of rows(results[0])) facts.set(row.id, { memberId: row.id, name: row.name, role:row.role, active: row.status === 'active' && !!row.enabled, campuses: [], profiles: [], assignments: [], departmentNames: [], memberships: [], grants:[] });
      for (const row of rows(results[1])) facts.get(row.member_id)?.campuses.push(row.campus);
      for (const row of rows(results[2])) facts.get(row.member_id)?.profiles.push(profile(row));
      for (const row of rows(results[3])) facts.get(row.member_id)?.assignments.push({ ...assignment(row), taskId: row.task_id });
      for (const row of rows(results[4])) {
        const fact = facts.get(row.member_id);
        if (fact) { fact.memberships.push(membership(row)); if (!fact.departmentNames.includes(row.department_name)) fact.departmentNames.push(row.department_name); }
      }
      for (const row of rows(results[5])) facts.get(row.member_id)?.grants.push({id:row.id,roleId:row.role_id,permissionCode:row.permission_code,
        scope:intersectScopes(parseJson(row.scope_spec,{}),parseJson(row.scope_bindings,{})),conditions:parseJson(row.condition_spec,[]),validity:parseJson(row.validity_spec,{}),
        binding:{effectiveFrom:row.binding_from,effectiveTo:row.binding_to}});
    }
    return [...facts.values()];
  }
  async function rosterTaskById(id) {
    return rosterTask(await db.prepare(`SELECT ${rosterTaskColumns} FROM roster_tasks rt WHERE rt.id=?`).bind(id).first());
  }
  async function memberCampuses(memberId) {
    return rows(await db.prepare(`SELECT DISTINCT scg.campus FROM staff_campus_grants scg
      JOIN staff_accounts sa ON sa.account=scg.account WHERE sa.member_id=? AND sa.status='enabled'`).bind(memberId).all()).map(row => row.campus);
  }
  async function createRosterTask(input, actorMemberId) {
    const id = input.id || crypto.randomUUID(); const at = nowIso();
    await db.batch([...(input.commandRecord ? [collection.rosterVersionGuard(input.commandRecord,'1=1',[])] : []),db.prepare(`INSERT INTO roster_tasks(id,week_start,campus_scope,slot_start,slot_end,member_ids,deadline,description,created_by_member_id,created_at,duty_type,rule_version,workflow_version,series_id,collection_opens_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id,input.weekStart,json(input.campusScope,{}),input.slotStart,input.slotEnd,json(input.memberIds,[]),input.deadline,input.description || '',actorMemberId,at,input.dutyType || 'repair',input.dutyType==='office' ? input.workflowVersion===1 ? 'office-daily-v2' : 'office-daily-v1' : 'repair-minimum-v2',input.workflowVersion || 0,input.seriesId || (input.recurrence?.enabled ? id : null),input.collectionOpensAt || null),
      ...(input.requirements || []).map(item=>db.prepare('INSERT INTO roster_staffing_requirements(task_id,business_date,campus_id,ordinary_minimum) VALUES(?,?,?,?)').bind(id,item.businessDate,item.campusId,item.ordinaryMinimum)),
      ...(input.commandRecord ? [collection.rosterVersionReceipt(input.commandRecord,'create-task',id,{signature:input.commandSignature})] : []),
      ...(input.recurrence?.enabled ? [db.prepare('INSERT INTO roster_collection_series(id,owner_member_id,template_task_id,publish_weekday,publish_time,deadline_weekday,deadline_time,next_week,next_publish_at,name) VALUES(?,?,?,?,?,?,?,?,?,?)')
        // Legacy queue columns remain for schema compatibility only; no queue is populated.
        .bind(id,actorMemberId,id,input.recurrence.publishWeekday,input.recurrence.publishTime,input.recurrence.deadlineWeekday,input.recurrence.deadlineTime,input.weekStart,'',input.collectionName||'')] : []),
      ...(input.commandRecord ? [collection.rosterAudit(input.commandRecord,'rosters.task.created',id,{weekStart:input.weekStart,campusScope:input.campusScope}),db.prepare('DELETE FROM roster_command_guards')] : [])]);
    return rosterTaskById(id);
  }
  function rosterTask(row) { return row ? { id: row.id, collectionOpensAt:row.collection_opens_at || null, collectionName:row.collection_name || '', seriesId:row.series_id || '',dutyType: row.duty_type || 'repair', workflowVersion:row.workflow_version || 0, collectionClosedAt:row.collection_closed_at, ruleVersion:row.rule_version || 'legacy', requirements:parseJson(row.requirements_json,[]), weekStart: row.week_start, campusScope: parseJson(row.campus_scope,{}), slotStart: row.slot_start, slotEnd: row.slot_end, memberIds: parseJson(row.member_ids,[]), deadline: row.deadline, description: row.description, revision: row.revision, createdAt: row.created_at } : null; }
  async function listRosterTasks() { const result = await db.prepare(`SELECT ${rosterTaskColumns} FROM roster_tasks rt ORDER BY rt.week_start DESC,rt.id DESC LIMIT 101`).all(); return rows(result).map(rosterTask); }
  async function saveRosterRequirements(task,input,auditRecord) {
    const authorization=commandAuthorization(auditRecord);
    const guard="EXISTS(SELECT 1 FROM roster_tasks WHERE id=? AND revision=?)";
    // Guard every dependent write with the new revision and the authorized
    // command marker. A stale command must not replace another editor's demand.
    const marker=crypto.randomUUID();
    const gate=`${guard} AND EXISTS(SELECT 1 FROM audit_events WHERE id=? AND action='rosters.requirements.updated')`;
    const statements=[db.prepare(`UPDATE roster_tasks SET revision=revision+1,rule_version=CASE WHEN duty_type='office' THEN 'office-daily-v2' ELSE 'repair-minimum-v2' END WHERE id=? AND revision=? ${authorization.sql}`).bind(task.id,input.revision,...authorization.args),
      auditStatement({...auditRecord,id:marker},true),
      db.prepare(`DELETE FROM roster_staffing_requirements WHERE task_id=? AND ${gate}`).bind(task.id,task.id,input.revision+1,marker)];
    for(const item of input.requirements) statements.push(db.prepare(`INSERT INTO roster_staffing_requirements(task_id,business_date,campus_id,ordinary_minimum) SELECT ?,?,?,? WHERE ${gate}`)
      .bind(task.id,item.businessDate,item.campusId,item.ordinaryMinimum,task.id,input.revision+1,marker));
    const result=await db.batch(statements);
    return result[0]?.meta?.changes ? rosterTaskById(task.id) : null;
  }
  async function saveAvailability(taskId, memberId, input) {
    const id = input.id || crypto.randomUUID();
    await db.prepare(`INSERT INTO availability(id,task_id,member_id,business_date,start_at,end_at,campus_id,revision) VALUES(?,?,?,?,?,?,?,0)
      ON CONFLICT(task_id,member_id,business_date,start_at,end_at,campus_id) DO UPDATE SET revision=availability.revision+1`)
      .bind(id,taskId,memberId,input.businessDate,input.startAt,input.endAt,input.campusId || null).run();
    const result = await db.prepare('SELECT * FROM availability WHERE task_id=? AND member_id=? ORDER BY business_date,start_at').bind(taskId,memberId).all();
    return rows(result).map(row => ({ id: row.id, taskId: row.task_id, memberId: row.member_id, businessDate: row.business_date, startAt: row.start_at, endAt: row.end_at, campusId: row.campus_id, revision: row.revision }));
  }
  async function availability(taskId) { const result = await db.prepare('SELECT * FROM availability WHERE task_id=? ORDER BY business_date,start_at').bind(taskId).all(); return rows(result).map(row => ({ id: row.id, taskId: row.task_id, memberId: row.member_id, businessDate: row.business_date, startAt: row.start_at, endAt: row.end_at, campusId: row.campus_id, revision: row.revision })); }
  async function createRosterVersion(input) {
    const id = input.id || crypto.randomUUID(); const at = nowIso();
    const statements = [db.prepare(`INSERT INTO roster_versions(id,task_id,status,version,rule_version,algorithm_version,input_snapshot_ref,solver_status,validation_result,created_at) SELECT ?,?,?,COALESCE(MAX(version),0)+1,?,?,?,?,?,? FROM roster_versions WHERE task_id=?`)
      .bind(id,input.taskId,input.status || 'draft',input.ruleVersion || '1.0.0',input.algorithmVersion || 'deterministic-greedy-v1',json(input.inputSnapshotRef,{}),input.solverStatus || 'feasible',json(input.validation,{}),at,input.taskId)];
    statements.push(db.prepare("UPDATE roster_versions SET status='superseded' WHERE task_id=? AND status='draft' AND id<>?").bind(input.taskId,id));
    for (const item of input.assignments || []) {
      const assignmentId = item.id || crypto.randomUUID();
      statements.push(db.prepare(`INSERT INTO duty_assignments(id,version_id,member_id,business_date,campus_id,duty_type,start_at,end_at,origin_assignment_id)
        VALUES(?,?,?,?,?,?,?,?,(SELECT COALESCE(da.origin_assignment_id,da.id) FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id
          WHERE rv.status='published' AND rv.task_id=? AND da.member_id=? AND da.business_date=? AND da.campus_id=? AND da.duty_type=? AND da.start_at=? AND da.end_at=? LIMIT 1))`)
        .bind(assignmentId,id,item.memberId,item.businessDate,item.campusId,item.dutyType || 'repair',item.startAt,item.endAt,input.taskId,item.memberId,item.businessDate,item.campusId,item.dutyType || 'repair',item.startAt,item.endAt));
      if (item.roleKind) statements.push(db.prepare('INSERT INTO duty_roles(id,assignment_id,role_kind,effective_range) VALUES(?,?,?,?)')
        .bind(`duty-role-${assignmentId}-${item.roleKind}`,assignmentId,item.roleKind,json(item.effectiveRange || {})));
    }
    if(input.commandRecord) {
      statements.unshift(collection.rosterVersionGuard(input.commandRecord,`EXISTS(SELECT 1 FROM roster_tasks WHERE id=? AND revision=? ${input.requireClosed ? "AND (collection_closed_at IS NOT NULL OR julianday(deadline)<=julianday('now'))" : ''})`,[input.taskId,input.inputSnapshotRef.eligibility.taskRevision]));
      statements.push(collection.rosterVersionReceipt(input.commandRecord,input.commandRecord.command,id,{taskId:input.taskId}),collection.rosterAudit(input.commandRecord,input.commandRecord.command==='revise'?'rosters.revised':'rosters.generated',input.taskId,{versionId:id}),db.prepare('DELETE FROM roster_command_guards'));
    }
    await db.batch(statements);
    return rosterVersion(await db.prepare('SELECT * FROM roster_versions WHERE id=?').bind(id).first());
  }
  function rosterVersion(row) { return row ? { id: row.id, taskId: row.task_id, status: row.status, version: row.version, ruleVersion: row.rule_version, algorithmVersion: row.algorithm_version, inputSnapshotRef: parseJson(row.input_snapshot_ref,{}), solverStatus: row.solver_status, validation: parseJson(row.validation_result,{}), publishedAt: row.published_at, createdAt: row.created_at } : null; }
  async function rosterVersionById(id) {
    return rosterVersion(await db.prepare('SELECT * FROM roster_versions WHERE id=?').bind(id).first());
  }
  async function rosterVersionsForTask(taskId) {
    return rows(await db.prepare('SELECT * FROM roster_versions WHERE task_id=? ORDER BY version DESC LIMIT 30').bind(taskId).all()).map(rosterVersion);
  }
  async function versionAssignments(id) {
    return rows(await db.prepare(`SELECT da.*,(SELECT name FROM members WHERE id=da.member_id) AS member_name,(SELECT paused FROM service_day_overrides s WHERE s.business_date=da.business_date AND s.campus_id=da.campus_id) AS service_paused,c.name AS campus_name,dr.role_kind,${assignmentLeaveColumn},
      EXISTS(SELECT 1 FROM json_each(rv.input_snapshot_ref,'$.manualOverrides') j WHERE json_extract(j.value,'$.memberId')=da.member_id AND json_extract(j.value,'$.businessDate')=da.business_date AND json_extract(j.value,'$.campusId')=da.campus_id) AS manual_override,
      (EXISTS(SELECT 1 FROM json_each(rv.input_snapshot_ref,'$.lockedAssignments') j WHERE json_extract(j.value,'$.memberId')=da.member_id AND json_extract(j.value,'$.businessDate')=da.business_date AND json_extract(j.value,'$.campusId')=da.campus_id AND json_extract(j.value,'$.startAt')=da.start_at AND json_extract(j.value,'$.endAt')=da.end_at) OR (json_type(rv.input_snapshot_ref,'$.lockedAssignments') IS NULL AND EXISTS(SELECT 1 FROM json_each(rv.input_snapshot_ref,'$.lockedMemberIds') WHERE value=da.member_id))) AS locked
      FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id
      JOIN campuses c ON c.id=da.campus_id LEFT JOIN duty_roles dr ON dr.assignment_id=da.id WHERE da.version_id=?
      ORDER BY da.business_date,da.start_at,da.member_id`).bind(id).all()).map(row => ({ ...assignment(row), locked: !!row.locked,manualOverride:!!row.manual_override }));
  }
  async function updateRosterDraft(id, input, revision) {
    const validation = input.validation || { valid: false, errors: [{ code: 'DRAFT_CHANGED_REQUIRES_VALIDATION' }] };
    // All dependent writes check the original version. Advance it last, in the same transaction.
    const guard = "EXISTS(SELECT 1 FROM roster_versions WHERE id=? AND version=? AND status='draft')";
    const statements = [
      db.prepare(`DELETE FROM duty_roles WHERE assignment_id IN (SELECT id FROM duty_assignments WHERE version_id=?) AND ${guard}`).bind(id,id,revision),
      db.prepare(`DELETE FROM duty_assignments WHERE version_id=? AND ${guard}`).bind(id,id,revision)
    ];
    for (const item of input.assignments || []) {
      const assignmentId = item.id || crypto.randomUUID();
      statements.push(db.prepare(`INSERT INTO duty_assignments(id,version_id,member_id,business_date,campus_id,duty_type,start_at,end_at,origin_assignment_id)
        SELECT ?,?,?,?,?,?,?,?,(SELECT COALESCE(da.origin_assignment_id,da.id) FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id
          WHERE rv.status='published' AND rv.task_id=(SELECT task_id FROM roster_versions WHERE id=?) AND da.member_id=? AND da.business_date=? AND da.campus_id=? AND da.duty_type=? AND da.start_at=? AND da.end_at=? LIMIT 1) WHERE ${guard}`)
        .bind(assignmentId,id,item.memberId,item.businessDate,item.campusId,item.dutyType || 'repair',item.startAt,item.endAt,id,item.memberId,item.businessDate,item.campusId,item.dutyType || 'repair',item.startAt,item.endAt,id,revision));
      if (item.roleKind) statements.push(db.prepare(`INSERT INTO duty_roles(id,assignment_id,role_kind,effective_range)
        SELECT ?,?,?,? WHERE ${guard}`)
        .bind(`duty-role-${assignmentId}-${item.roleKind}`,assignmentId,item.roleKind,json(item.effectiveRange || {}),id,revision));
    }
    statements.push(db.prepare(`UPDATE roster_versions SET version=version+1,validation_result=?,solver_status=?,rule_version=COALESCE(?,rule_version),input_snapshot_ref=json_set(json_remove(input_snapshot_ref,'$.optimization'),'$.lockedMemberIds',json(?),'$.lockedAssignments',json(?),'$.manualOverrides',json(?),'$.manuallyAdjusted',json('true'),'$.eligibility',json(COALESCE(?,json_extract(input_snapshot_ref,'$.eligibility'),'{}'))) WHERE id=? AND version=? AND status='draft'`)
      .bind(json(validation,{}),validation.valid ? 'feasible' : 'needs_review',input.ruleVersion || null,json((input.assignments || []).filter(item => item.locked).map(item => item.memberId),[]),json((input.assignments || []).filter(item=>item.locked),[]),json((input.assignments || []).filter(item=>item.manualOverride),[]),input.eligibility ? json(input.eligibility,{}) : null,id,revision));
    if(input.commandRecord)statements.unshift(collection.rosterVersionGuard(input.commandRecord,`EXISTS(SELECT 1 FROM roster_versions WHERE id=? AND version=? AND status='draft') ${input.fingerprint ? `AND (${rosterFingerprintSql})=?` : ''}`,[id,revision,...(input.fingerprint?[input.taskId,input.fingerprint]:[])]));
    const updateIndex=statements.length-1;
    if(input.commandRecord)statements.push(collection.rosterVersionReceipt(input.commandRecord,'save',id,{signature:input.signature}),collection.rosterAudit(input.commandRecord,'rosters.updated',input.taskId,{versionId:id,validation}),db.prepare('DELETE FROM roster_command_guards'));
    const result = await db.batch(statements);
    if (!result[updateIndex]?.meta?.changes) return null;
    return rosterVersionById(id);
  }
  async function rosterFingerprint(taskId) {return (await db.prepare(rosterFingerprintSql).bind(taskId).first()).fingerprint;}
  async function publishRoster(id, revision, auditRecord, fingerprint, override=null) {
    const at = nowIso();
    const current = await db.prepare(`SELECT task_id FROM roster_versions WHERE id=? AND version=? AND status='draft'`).bind(id,revision).first();
    if (!current) return null;
    const authorization=commandAuthorization(auditRecord);
    const result = await db.batch([
      ...(override?[db.prepare(`INSERT INTO roster_publication_overrides(version_id,draft_version,actor_member_id,issues_json,reason,confirmation,request_id,created_at)
        SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM roster_versions WHERE id=? AND version=? AND status='draft')
        ${fingerprint?`AND (${rosterFingerprintSql})=?`:''} ${authorization.sql}`)
        .bind(id,revision,auditRecord.actorMemberId,JSON.stringify(override.issues),override.reason,override.confirmation,auditRecord.requestId||'',at,id,revision,...(fingerprint?[current.task_id,fingerprint]:[]),...authorization.args)]:[]),
      db.prepare(`UPDATE roster_versions SET status='published',published_at=? WHERE id=? AND version=? AND status='draft' AND (COALESCE(json_extract(validation_result,'$.valid'),0)=1 OR EXISTS(SELECT 1 FROM roster_publication_overrides WHERE version_id=roster_versions.id AND draft_version=roster_versions.version))
        ${fingerprint ? `AND (${rosterFingerprintSql})=?` : ''} ${authorization.sql}`).bind(at,id,revision,...(fingerprint ? [current.task_id,fingerprint] : []),...authorization.args),
      ...(auditRecord ? [auditStatement({ ...auditRecord, occurredAt: at }, true)] : []),
      db.prepare(`UPDATE roster_versions SET status='superseded' WHERE task_id=? AND status IN ('published','draft') AND id<>? AND EXISTS(SELECT 1 FROM roster_versions WHERE id=? AND status='published' AND version=?)`).bind(current.task_id,id,id,revision)
    ]);
    return result[override?1:0]?.meta?.changes ? rosterVersion(await db.prepare('SELECT * FROM roster_versions WHERE id=?').bind(id).first()) : null;
  }
  async function listAssignments(memberId, weekStart) {
    const result = await db.prepare(`SELECT da.*,(SELECT paused FROM service_day_overrides s WHERE s.business_date=da.business_date AND s.campus_id=da.campus_id) AS service_paused,c.name AS campus_name,dr.role_kind,${assignmentLeaveColumn} FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id AND rv.status='published' JOIN campuses c ON c.id=da.campus_id LEFT JOIN duty_roles dr ON dr.assignment_id=da.id WHERE da.member_id=? AND da.business_date>=? AND da.business_date<=date(?, '+6 day') ORDER BY da.business_date,da.start_at`).bind(memberId,weekStart,weekStart).all();
    return rows(result).map(assignment);
  }
  async function assignmentById(id) {
    const row = await db.prepare(`SELECT da.*,(SELECT paused FROM service_day_overrides s WHERE s.business_date=da.business_date AND s.campus_id=da.campus_id) AS service_paused,c.name AS campus_name,dr.role_kind,rv.status AS version_status,rv.task_id,rv.rule_version,rv.input_snapshot_ref,${assignmentLeaveColumn} FROM duty_assignments da JOIN campuses c ON c.id=da.campus_id
      JOIN roster_versions rv ON rv.id=da.version_id LEFT JOIN duty_roles dr ON dr.assignment_id=da.id WHERE da.id=?`).bind(id).first();
    return assignment(row);
  }
  async function effectiveAssignment(id, memberId) {
    const row = await db.prepare(`SELECT da.*,(SELECT paused FROM service_day_overrides s WHERE s.business_date=da.business_date AND s.campus_id=da.campus_id) AS service_paused,c.name AS campus_name,dr.role_kind,rv.status AS version_status,rv.task_id,rv.rule_version,rv.input_snapshot_ref,${assignmentLeaveColumn}
      FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id AND rv.status='published' JOIN campuses c ON c.id=da.campus_id
      LEFT JOIN duty_roles dr ON dr.assignment_id=da.id WHERE COALESCE(da.origin_assignment_id,da.id)=(SELECT COALESCE(original.origin_assignment_id,original.id) FROM duty_assignments original WHERE original.id=?) AND da.member_id=? LIMIT 1`).bind(id,memberId).first();
    return row ? assignment(row) : assignmentById(id);
  }
  async function swapCandidates(source) {
    const result = await db.prepare(`SELECT da.*,(SELECT paused FROM service_day_overrides s WHERE s.business_date=da.business_date AND s.campus_id=da.campus_id) AS service_paused,c.name AS campus_name,m.name AS member_name,dr.role_kind,rv.status AS version_status,rv.task_id,rv.rule_version,rv.input_snapshot_ref
      FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id AND rv.status='published'
      JOIN campuses c ON c.id=da.campus_id JOIN members m ON m.id=da.member_id AND m.status='active'
      LEFT JOIN duty_roles dr ON dr.assignment_id=da.id
      WHERE da.member_id<>? AND da.duty_type=? AND da.campus_id=?
      AND da.business_date>=? AND da.business_date<=date(?, '+6 day')
      AND NOT EXISTS(SELECT 1 FROM roster_leave_facts lr WHERE lr.origin_assignment_id=COALESCE(da.origin_assignment_id,da.id) AND lr.member_id=da.member_id AND lr.status IN ('pending','approved'))
      ORDER BY da.business_date,da.start_at,m.name,da.id LIMIT 200`)
      .bind(source.memberId,source.dutyType,source.campusId,source.weekStart,source.weekStart).all();
    return rows(result).map(row => ({ ...assignment(row), memberName: row.member_name }));
  }
  async function createLeave(input, actorMemberId, auditRecord, receiptRecord) {
    const id = crypto.randomUUID(), at = nowIso();
    const authorization = commandAuthorization(auditRecord);
    const statements = [];
    if (receiptRecord) statements.push(db.prepare(`INSERT OR IGNORE INTO operation_receipts(actor_member_id,action,request_id,payload_hash,resource_ref,result_json,result_status,created_at)
      VALUES(?,?,?,?,?,'{}','pending',?)`).bind(actorMemberId,receiptRecord.action,receiptRecord.id,receiptRecord.hash,'{}',at));
    const insertIndex = statements.length;
    statements.push(db.prepare(`INSERT INTO leave_requests(id,assignment_id,member_id,reason,created_at)
      SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id
        WHERE da.id=? AND da.member_id=? AND COALESCE(da.origin_assignment_id,da.id)=? AND rv.status='published')
      AND NOT EXISTS(SELECT 1 FROM roster_leave_facts WHERE origin_assignment_id=? AND member_id=? AND status IN ('pending','approved'))
      ${receiptRecord ? "AND EXISTS(SELECT 1 FROM operation_receipts WHERE actor_member_id=? AND action=? AND request_id=? AND payload_hash=? AND result_status='pending')" : ''} ${authorization.sql}`)
      .bind(id,input.assignmentId,actorMemberId,input.reason,at,input.activeAssignmentId || input.assignmentId,actorMemberId,input.assignmentId,input.assignmentId,actorMemberId,
        ...(receiptRecord ? [actorMemberId,receiptRecord.action,receiptRecord.id,receiptRecord.hash] : []),...authorization.args));
    if (auditRecord) statements.push(auditStatement({ ...auditRecord, sourceRef: { module: 'rosters', type: 'leave', id }, after: { assignmentId: input.assignmentId, memberId: actorMemberId, status: 'pending', reason: input.reason } }, true));
    if (receiptRecord) {
      const result = { id, assignmentId: input.assignmentId, memberId: actorMemberId, reason: input.reason, status: 'pending', reviewerMemberId: '', reviewNote: '', revision: 0, createdAt: at, reviewedAt: null };
      statements.push(db.prepare(`UPDATE operation_receipts SET resource_ref=?,result_json=?,result_status='success'
        WHERE actor_member_id=? AND action=? AND request_id=? AND payload_hash=? AND result_status='pending' AND EXISTS(SELECT 1 FROM leave_requests WHERE id=?)`)
        .bind(json({ module: 'rosters', type: 'leave', id }),json(result),actorMemberId,receiptRecord.action,receiptRecord.id,receiptRecord.hash,id));
      statements.push(db.prepare(`DELETE FROM operation_receipts WHERE actor_member_id=? AND action=? AND request_id=? AND payload_hash=? AND result_status='pending' AND NOT EXISTS(SELECT 1 FROM leave_requests WHERE id=?)`)
        .bind(actorMemberId,receiptRecord.action,receiptRecord.id,receiptRecord.hash,id));
    }
    const result = await db.batch(statements);
    return result[insertIndex]?.meta?.changes ? db.prepare('SELECT * FROM leave_requests WHERE id=?').bind(id).first() : null;
  }
  async function leaveById(id) { return db.prepare('SELECT * FROM leave_requests WHERE id=?').bind(id).first(); }
  async function listLeaves(filters = {}) {
    const conditions = [], args = [];
    if (filters.memberId) { conditions.push('lr.member_id=?'); args.push(filters.memberId); }
    if (filters.status) { conditions.push('lr.status=?'); args.push(filters.status); }
    const result = await db.prepare(`SELECT lr.*,m.name AS member_name,da.business_date,da.campus_id,c.name AS campus_name,
      da.duty_type,da.start_at,da.end_at,da.version_id,da.member_id AS assigned_member_id,da.revision AS assignment_revision,rv.status AS version_status
      FROM leave_requests lr JOIN members m ON m.id=lr.member_id JOIN duty_assignments da ON da.id=lr.assignment_id
      JOIN roster_versions rv ON rv.id=da.version_id JOIN campuses c ON c.id=da.campus_id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY lr.created_at DESC,lr.id DESC LIMIT 501`).bind(...args).all();
    return rows(result).map(row => ({ ...row, assignment: assignment({ ...row, id: row.assignment_id, member_id: row.assigned_member_id, revision: row.assignment_revision }) }));
  }
  async function leaveImpact(target) {
    const result = await db.prepare(`SELECT da.id,da.member_id,MAX(CASE WHEN dr.role_kind='repair_lead' THEN 1 ELSE 0 END) AS is_lead,
      ${assignmentLeaveColumn},EXISTS(SELECT 1 FROM attendance_records ar JOIN attendance_events e ON e.id=ar.event_id
        WHERE ar.member_id=da.member_id AND e.type='duty' AND e.campus_id=da.campus_id AND e.business_date=da.business_date) AS checked_in
      FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id AND rv.status='published'
      LEFT JOIN duty_roles dr ON dr.assignment_id=da.id WHERE da.campus_id=? AND da.business_date=? AND da.duty_type=?
      AND da.start_at<=? AND da.end_at>=? GROUP BY da.id`).bind(target.campusId,target.businessDate,target.dutyType,target.startAt,target.endAt).all();
    const facts = rows(result), expected = facts.filter(item => item.leave_status !== 'approved');
    const after = expected.filter(item => item.id !== target.id);
    const count = items => new Set(items.map(item => item.member_id)).size;
    const applicant = facts.find(item => item.id === target.id);
    return { scheduled: count(facts), expected: count(expected), afterApproval: count(after),
      leaders: count(expected.filter(item => item.is_lead)), leadersAfterApproval: count(after.filter(item => item.is_lead)),
      checkedIn: !!applicant?.checked_in, arrived: count(facts.filter(item => item.checked_in)),
      ordinaryAfterApproval:count(after.filter(item=>!item.is_lead)),ordinaryMinimum:target.ordinaryMinimum ?? null,
      needsReplacement: !after.length || target.dutyType === 'repair' && (!after.some(item => item.is_lead) || target.ruleVersion==='repair-minimum-v2' && count(after.filter(item=>!item.is_lead))<(target.ordinaryMinimum ?? 1)) };
  }
  async function updateLeave(id, status, actorMemberId, revision, note = '', auditRecord) {
    const authorization = commandAuthorization(auditRecord);
    const statements = [db.prepare(`UPDATE leave_requests SET status=?,reviewer_member_id=?,review_note=?,reviewed_at=?,revision=revision+1
      WHERE id=? AND revision=? AND status='pending' AND (?<>'approved' OR EXISTS(SELECT 1 FROM duty_assignments da
        JOIN roster_versions rv ON rv.id=da.version_id WHERE COALESCE(da.origin_assignment_id,da.id)=(SELECT origin_assignment_id FROM roster_leave_facts WHERE id=leave_requests.id) AND da.member_id=leave_requests.member_id AND rv.status='published')) ${authorization.sql}`)
      .bind(status,actorMemberId,note,nowIso(),id,revision,status,...authorization.args)];
    if (auditRecord) statements.push(auditStatement(auditRecord, true));
    const result = await db.batch(statements);
    return result[0]?.meta?.changes ? db.prepare('SELECT * FROM leave_requests WHERE id=?').bind(id).first() : null;
  }
  function commandAuthorization(record) {
    if (record?.authVersion === undefined) return { sql: '', args: [] };
    return { sql: `AND EXISTS(SELECT 1 FROM staff_accounts account JOIN members actor ON actor.id=account.member_id
      WHERE account.account=? AND account.member_id=? AND account.auth_version=? AND account.status='enabled' AND actor.status='active')`,
      args: [record.actorAccount,record.actorMemberId,record.authVersion] };
  }
  const { swapFingerprint, createSwap, updateSwap } = rosterSwapCommands(db, { auditStatement, commandAuthorization });
  const { attendanceCorrectionFingerprint, correctAttendance } = attendanceCorrections(db, { auditStatement, commandAuthorization });
  async function listSwaps(filters = {}) {
    const conditions = [], args = [];
    if (filters.memberId) { conditions.push('(from_member_id=? OR to_member_id=?)'); args.push(filters.memberId, filters.memberId); }
    if (filters.status) { conditions.push('status=?'); args.push(filters.status); }
    const result = await db.prepare(`SELECT * FROM swap_requests ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY created_at DESC,id DESC LIMIT 501`).bind(...args).all();
    return rows(result);
  }
  async function swapById(id) { return db.prepare('SELECT * FROM swap_requests WHERE id=?').bind(id).first(); }
  async function pendingSwapInvitations(memberId) {
    return (await db.prepare("SELECT COUNT(*) AS total FROM swap_requests WHERE to_member_id=? AND status='pending'").bind(memberId).first()).total;
  }
  async function swapCoverage(weekStart) {
    return rows(await db.prepare(`SELECT da.*,(SELECT paused FROM service_day_overrides s WHERE s.business_date=da.business_date AND s.campus_id=da.campus_id) AS service_paused,c.name AS campus_name,dr.role_kind,rv.status AS version_status,rv.task_id,rv.rule_version,rv.input_snapshot_ref,${assignmentLeaveColumn}
      FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id AND rv.status='published'
      JOIN campuses c ON c.id=da.campus_id LEFT JOIN duty_roles dr ON dr.assignment_id=da.id
      WHERE da.business_date>=? AND da.business_date<=date(?,'+6 day') ORDER BY da.id`).bind(weekStart,weekStart).all()).map(assignment);
  }

  return { ...serviceDayRepository(db),effectiveAssignment, effectiveLeaveAssignment: effectiveAssignment, swapFingerprint, swapCoverage, pendingSwapInvitations, accountRow, accountForMember, ensureMember, memberRow, memberships, membershipsForMembers, profiles, profileHistory, saveWorkProfile, grants, todayDuties, authorizationContext, listMembers, updateMember, listMemberships, addMembership, endMembership,
    listCampuses, listDepartments, listLocations, listPresence, activeRepair, importMembers, dutyEvent, latestIntake, repairIdentitySnapshot, fieldPeople, fieldContexts,
    roleBindings, permissionDefinitions, listRoles, createRole, updateRole, bindRoles, modules, createEvent, issueToken, findEventByToken, findAttendanceByDedupe, insertAttendance, listAttendance, attendanceExport, attendanceCorrectionFingerprint, correctAttendance, setPresence,
    ...collection,attendanceEvent, eventById: attendanceEvent, attendanceById, attendanceOptions, createReceipt, claimReceipt, releaseReceipt, receipt, audit, listAudit, leaveImpact, officeRosterMemberIds, rosterMemberFacts, rosterTaskById, memberCampuses, createRosterTask, listRosterTasks, saveRosterRequirements, saveAvailability, availability, createRosterVersion, rosterVersionById, rosterVersionsForTask, versionAssignments, updateRosterDraft, rosterFingerprint, publishRoster, listAssignments, assignmentById, swapCandidates, createLeave, leaveById, listLeaves, updateLeave, createSwap, swapById, listSwaps, updateSwap };
}
