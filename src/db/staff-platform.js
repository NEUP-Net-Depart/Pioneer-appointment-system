import { parseJson } from '../platform/contracts.js';
import { dateKey, nowIso } from '../platform/time.js';
import { intersectScopes } from '../modules/authorization/scopes.js';

const memberColumns = `m.id,m.name,m.student_id,m.home_campus_id,m.status,m.revision,m.created_at,m.updated_at`;

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
    id: row.id, versionId: row.version_id, memberId: row.member_id, businessDate: row.business_date,
    campusId: row.campus_id, campusName: row.campus_name || '', dutyType: row.duty_type,
    startAt: row.start_at, endAt: row.end_at, revision: row.revision, roleKind: row.role_kind || ''
  } : null;
}

export function staffPlatformRepository(db) {
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
      WHERE staff_accounts.member_id=? ORDER BY staff_accounts.account LIMIT 1`).bind(memberId).first();
  }

  async function memberships(memberId, businessDate = dateKey()) {
    const result = await db.prepare(`SELECT mdm.*,d.name AS department_name FROM member_department_memberships mdm
      JOIN departments d ON d.id=mdm.department_id WHERE mdm.member_id=?
      AND mdm.effective_from<=? AND (mdm.effective_to IS NULL OR ?<mdm.effective_to)
      ORDER BY mdm.is_primary DESC,mdm.effective_from`).bind(memberId, businessDate, businessDate).all();
    return rows(result).map(membership);
  }

  async function profiles(memberId, businessDate = dateKey()) {
    const result = await db.prepare(`SELECT * FROM member_work_profiles WHERE member_id=?
      AND effective_from<=? AND (effective_to IS NULL OR ?<effective_to) ORDER BY profile_code`)
      .bind(memberId, businessDate, businessDate).all();
    return rows(result).map(profile);
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
    const result = await db.prepare(`SELECT da.*,c.name AS campus_name,dr.role_kind FROM duty_assignments da
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
      authVersion, schemaVersion: '0007'
    };
  }

  async function listMembers(filters = {}) {
    const conditions = [], args = [];
    if (filters.q) { conditions.push('(m.name LIKE ? OR m.student_id LIKE ? OR sa.account LIKE ?)'); const q = `%${filters.q}%`; args.push(q, q, q); }
    if (filters.status) { conditions.push('m.status=?'); args.push(filters.status); }
    if (filters.homeCampusId) { conditions.push('m.home_campus_id=?'); args.push(filters.homeCampusId); }
    if (filters.homeCampusIds?.length) { conditions.push(`m.home_campus_id IN (${filters.homeCampusIds.map(() => '?').join(',')})`); args.push(...filters.homeCampusIds); }
    const query = `SELECT ${memberColumns},sa.account,sa.status AS account_status,sa.role,sa.auth_version,
      (SELECT GROUP_CONCAT(d.name,'、') FROM member_department_memberships mdm JOIN departments d ON d.id=mdm.department_id
       WHERE mdm.member_id=m.id AND mdm.is_primary=1 AND mdm.effective_to IS NULL) AS primary_department
      FROM members m LEFT JOIN staff_accounts sa ON sa.member_id=m.id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY m.name,m.id LIMIT 101`;
    const result = await db.prepare(query).bind(...args).all();
    return rows(result).map(row => ({ memberId: row.id, name: row.name, studentId: row.student_id || '', homeCampusId: row.home_campus_id || '', status: row.status,
      account: row.account || '', accountStatus: row.account_status || '', role: row.role || '', authVersion: row.auth_version || 0,
      primaryDepartment: row.primary_department || '', revision: row.revision, memberships: [] }));
  }

  async function updateMember(memberId, patch, revision) {
    const fields = [], args = [];
    if (patch.name !== undefined) { fields.push('name=?'); args.push(patch.name); }
    if (patch.studentId !== undefined) { fields.push('student_id=?'); args.push(patch.studentId || null); }
    if (patch.homeCampusId !== undefined) { fields.push('home_campus_id=?'); args.push(patch.homeCampusId); }
    if (patch.status !== undefined) { fields.push('status=?'); args.push(patch.status); }
    if (!fields.length) return (await memberRow(memberId));
    const at = nowIso();
    fields.push('revision=revision+1','updated_at=?'); args.push(at, memberId, revision);
    const account = await accountForMember(memberId);
    const statements = [db.prepare(`UPDATE members SET ${fields.join(',')} WHERE id=? AND revision=?`).bind(...args)];
    if (account && (patch.name !== undefined || patch.status !== undefined || patch.homeCampusId !== undefined)) {
      const accountFields = [], accountArgs = [];
      if (patch.name !== undefined) { accountFields.push('name=?'); accountArgs.push(patch.name); }
      if (patch.status !== undefined) { accountFields.push('status=?'); accountArgs.push(patch.status === 'active' ? 'enabled' : 'disabled'); }
      if (patch.homeCampusId !== undefined) {
        accountFields.push('home_campus=?');
        accountArgs.push(patch.homeCampusId === 'campus-hunnan' ? '浑南' : patch.homeCampusId === 'campus-nanhu' ? '南湖' : patch.homeCampusId);
      }
      if (patch.status !== undefined || patch.homeCampusId !== undefined) accountFields.push('token_version=token_version+1','auth_version=auth_version+1');
      statements.push(db.prepare(`UPDATE staff_accounts SET ${accountFields.join(',')} WHERE account=? AND EXISTS(SELECT 1 FROM members WHERE id=? AND revision=?)`)
        .bind(...accountArgs, account.account, memberId, Number(revision) + 1));
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

  async function addMembership(memberId, input, revision) {
    const id = input.id || crypto.randomUUID();
    const createdAt = nowIso();
    const statements = [
      db.prepare(`UPDATE members SET revision=revision+1,updated_at=? WHERE id=? AND revision=?`).bind(createdAt, memberId, revision),
      db.prepare(`INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,effective_from,effective_to,created_at) SELECT ?,?,?,?,?,?,?,? WHERE changes()>0`)
        .bind(id, memberId, input.departmentId, input.assignmentType || 'secondary', input.isPrimary ? 1 : 0, input.effectiveFrom, input.effectiveTo || null, createdAt)
    ];
    const result = await db.batch(statements);
    if (!result[0]?.meta?.changes && !result[0]?.results?.length) return null;
    return (await listMemberships(memberId)).find(item => item.id === id) || null;
  }

  async function endMembership(memberId, membershipId, effectiveTo, revision) {
    const result = await db.prepare(`UPDATE member_department_memberships SET effective_to=?,revision=revision+1
      WHERE id=? AND member_id=? AND revision=? AND (effective_to IS NULL OR effective_to>?)`).bind(effectiveTo, membershipId, memberId, revision, effectiveTo).run();
    return result.meta?.changes ? (await listMemberships(memberId)).find(item => item.id === membershipId) : null;
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

  async function activeRepair(memberId) {
    return db.prepare(`SELECT ar.member_id,ar.account,ar.appointment_id FROM active_repairs ar
      WHERE ar.member_id=? LIMIT 1`).bind(memberId).first();
  }

  async function importMembers(items) {
    const at = nowIso();
    const statements = [];
    const roleRows = rows(await db.prepare('SELECT id,code FROM roles WHERE enabled=1').all());
    const rolesByCode = Object.fromEntries(roleRows.map(row => [row.code, row.id]));
    for (const item of items) {
      const id = item.memberId || `member-${item.studentId}`;
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
      const campusIds = (item.authorizedCampuses || []).map(value => ({ 南湖: '南湖', 浑南: '浑南' }[value] || value));
      if (account && campusIds.length) {
        statements.push(db.prepare('DELETE FROM staff_campus_grants WHERE account=?').bind(account.account));
        for (const campus of campusIds) statements.push(db.prepare('INSERT OR IGNORE INTO staff_campus_grants(account,campus) VALUES(?,?)').bind(account.account,campus));
      }
    }
    if (statements.length) await db.batch(statements);
    const result = await db.prepare(`SELECT ${memberColumns} FROM members m WHERE m.student_id IN (${items.map(() => '?').join(',')}) ORDER BY m.student_id`).bind(...items.map(item => item.studentId)).all();
    return rows(result);
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

  async function createRole(input) {
    const id = input.id || crypto.randomUUID(); const at = nowIso();
    const statements = [db.prepare('INSERT INTO roles(id,code,name,description,level,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .bind(id,input.code,input.name,input.description || '',input.level || 1,input.enabled === false ? 0 : 1,at,at)];
    for (const grant of input.grants || []) statements.push(db.prepare('INSERT INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec,validity_spec) VALUES(?,?,?,?,?,?)')
      .bind(grant.id || crypto.randomUUID(),id,grant.permissionCode,json(grant.scope,{}),json(grant.conditions,[]),json(grant.validity,{})));
    await db.batch(statements);
    return (await listRoles()).find(role => role.id === id);
  }

  async function updateRole(id, input, revision) {
    const at = nowIso();
    const fields = [], args = [];
    for (const [key, column] of [['name','name'],['description','description'],['level','level'],['enabled','enabled']]) if (input[key] !== undefined) { fields.push(`${column}=?`); args.push(key === 'enabled' ? (input[key] ? 1 : 0) : input[key]); }
    fields.push('revision=revision+1','updated_at=?'); args.push(at,id,revision);
    const statements = [db.prepare(`UPDATE roles SET ${fields.join(',')} WHERE id=? AND revision=?`).bind(...args)];
    if (input.grants) {
      statements.push(db.prepare('DELETE FROM role_grants WHERE role_id=? AND EXISTS(SELECT 1 FROM roles WHERE id=? AND revision=?)').bind(id,id,Number(revision) + 1));
      for (const grant of input.grants) statements.push(db.prepare('INSERT INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec,validity_spec) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM roles WHERE id=? AND revision=?)')
        .bind(grant.id || crypto.randomUUID(),id,grant.permissionCode,json(grant.scope,{}),json(grant.conditions,[]),json(grant.validity,{}),id,Number(revision) + 1));
    }
    statements.push(db.prepare(`UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id IN (SELECT member_id FROM member_roles WHERE role_id=?) AND EXISTS(SELECT 1 FROM roles WHERE id=? AND revision=?)`).bind(id,id,Number(revision) + 1));
    const result = await db.batch(statements);
    if (!result[0]?.meta?.changes) return null;
    return (await listRoles()).find(role => role.id === id) || null;
  }

  async function roleBindings(memberId) {
    const result = await db.prepare('SELECT * FROM member_roles WHERE member_id=? ORDER BY effective_from,id').bind(memberId).all();
    return rows(result).map(row => ({ id: row.id, roleId: row.role_id, scope: parseJson(row.scope_bindings, {}), effectiveFrom: row.effective_from, effectiveTo: row.effective_to, revision: row.revision }));
  }

  async function bindRoles(memberId, bindings, revision) {
    const at = nowIso();
    const nextRevision = Number(revision) + 1;
    const statements = [db.prepare('UPDATE members SET revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(at,memberId,revision),
      db.prepare('DELETE FROM member_roles WHERE member_id=? AND EXISTS(SELECT 1 FROM members WHERE id=? AND revision=?)').bind(memberId,memberId,nextRevision),
      db.prepare('UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id=? AND EXISTS(SELECT 1 FROM members WHERE id=? AND revision=?)').bind(memberId,memberId,nextRevision)];
    for (const binding of bindings) statements.push(db.prepare('INSERT INTO member_roles(id,member_id,role_id,scope_bindings,effective_from,effective_to) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM members WHERE id=? AND revision=?)')
      .bind(binding.id || crypto.randomUUID(),memberId,binding.roleId,json(binding.scope,{}),binding.effectiveFrom || dateKey(),binding.effectiveTo || null,memberId,nextRevision));
    const result = await db.batch(statements);
    return !!result[0]?.meta?.changes;
  }

  async function modules() {
    const result = await db.prepare('SELECT * FROM module_catalog WHERE release_state<>\'disabled\' ORDER BY code').all();
    return rows(result).map(row => ({ code: row.code, version: row.version, manifestHash: row.manifest_hash, contractVersion: row.contract_version, requiredSchemaVersion: row.required_schema_version, releaseState: row.release_state, manifest: parseJson(row.manifest_json, {}) }));
  }

  async function createEvent(input, actorMemberId) {
    if (input.type === 'duty') {
      const existing = await db.prepare(`SELECT * FROM attendance_events WHERE type='duty' AND business_date=? AND COALESCE(campus_id,'')=COALESCE(?, '') ORDER BY created_at LIMIT 1`)
        .bind(input.businessDate, input.campusId || null).first();
      if (existing) return event(existing);
    }
    const id = input.id || crypto.randomUUID(); const at = nowIso();
    await db.prepare(`INSERT INTO attendance_events(id,type,policy_code,policy_version,rule_snapshot,campus_id,business_date,starts_at,ends_at,source_ref,created_by_member_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,input.type,input.policyCode,input.policyVersion,json(input.ruleSnapshot,{}),input.campusId || null,input.businessDate,input.startsAt,input.endsAt,json(input.sourceRef,{}),actorMemberId,at).run();
    return event(await db.prepare('SELECT * FROM attendance_events WHERE id=?').bind(id).first());
  }

  async function issueToken(eventId, tokenHash, expiresAt, actorMemberId, revision) {
    const at = nowIso();
    const nextRevision = Number(revision) + 1;
    const statements = [db.prepare('UPDATE attendance_events SET revision=revision+1 WHERE id=? AND revision=?').bind(eventId,revision),
      db.prepare('UPDATE attendance_tokens SET revoked_at=? WHERE event_id=? AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM attendance_events WHERE id=? AND revision=?)').bind(at,eventId,eventId,nextRevision),
      db.prepare('INSERT INTO attendance_tokens(id,event_id,token_hash,version,issued_at,expires_at) SELECT ?,?,?,COALESCE((SELECT MAX(version)+1 FROM attendance_tokens WHERE event_id=?),1),?,? WHERE EXISTS(SELECT 1 FROM attendance_events WHERE id=? AND revision=?)')
        .bind(crypto.randomUUID(),eventId,tokenHash,eventId,at,expiresAt,eventId,nextRevision)];
    const result = await db.batch(statements);
    if (!result[0]?.meta?.changes) return null;
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
    const row = await db.prepare(`SELECT ar.*,e.type,e.business_date,e.campus_id FROM attendance_records ar JOIN attendance_events e ON e.id=ar.event_id WHERE ar.dedupe_key=?`).bind(dedupeKey).first();
    return row ? attendanceRecord(row) : null;
  }

  function attendanceRecord(row) {
    return row ? { id: row.id, memberId: row.member_id, eventId: row.event_id, dedupeKey: row.dedupe_key, occurredAt: row.occurred_at, recordedAt: row.recorded_at, method: row.method, sourceRef: parseJson(row.source_ref, {}), businessDate: row.business_date, type: row.type, campusId: row.campus_id, primaryDepartmentIdSnapshot: row.primary_department_id_snapshot, primaryDepartmentNameSnapshot: row.primary_department_name_snapshot, identitySnapshot: parseJson(row.identity_snapshot, {}), nonScheduled: !!row.non_scheduled, revision: row.revision } : null;
  }

  async function insertAttendance(record, presence) {
    const previousPresence = presence ? await db.prepare('SELECT state FROM staff_presence WHERE member_id=? AND business_date=?')
      .bind(record.memberId, record.businessDate).first() : null;
    const statements = [db.prepare(`INSERT INTO attendance_records(id,member_id,event_id,dedupe_key,occurred_at,recorded_at,method,source_ref,primary_department_id_snapshot,primary_department_name_snapshot,identity_snapshot,non_scheduled)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(record.id,record.memberId,record.eventId,record.dedupeKey,record.occurredAt,record.recordedAt,record.method,json(record.sourceRef,{}),record.departmentId || null,record.departmentName || null,json(record.identitySnapshot,{}),record.nonScheduled ? 1 : 0)];
    if (presence) {
      statements.push(db.prepare(`INSERT INTO staff_presence(member_id,business_date,campus_id,state,revision,updated_at) VALUES(?,?,?,?,0,?)
        ON CONFLICT(member_id,business_date) DO UPDATE SET campus_id=excluded.campus_id,state='available',revision=staff_presence.revision+1,updated_at=excluded.updated_at`)
        .bind(record.memberId,record.businessDate,record.campusId,'available',record.recordedAt));
      statements.push(db.prepare(`INSERT INTO presence_events(id,member_id,business_date,from_state,to_state,occurred_at,actor_member_id,actor_account)
        VALUES(?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),record.memberId,record.businessDate,previousPresence?.state || null,'available',record.recordedAt,record.memberId,record.actorAccount || null));
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
    if (filters.campusId) { conditions.push('e.campus_id=?'); args.push(filters.campusId); }
    if (filters.campusIds?.length) { conditions.push(`e.campus_id IN (${filters.campusIds.map(() => '?').join(',')})`); args.push(...filters.campusIds); }
    const result = await db.prepare(`SELECT ar.*,e.type,e.business_date,e.campus_id FROM attendance_records ar JOIN attendance_events e ON e.id=ar.event_id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY ar.occurred_at DESC,ar.id DESC LIMIT 501`).bind(...args).all();
    return rows(result).map(attendanceRecord);
  }

  async function attendanceExport(filters = {}) {
    const conditions = ["e.type='duty'"]; const args = [];
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

  async function setPresence(memberId, input, revision, actor) {
    const at = nowIso();
    const existing = await db.prepare('SELECT * FROM staff_presence WHERE member_id=? AND business_date=?').bind(memberId,input.businessDate).first();
    const expected = existing ? revision : 0;
    const statement = existing ? db.prepare(`UPDATE staff_presence SET state=?,campus_id=?,revision=revision+1,updated_at=? WHERE member_id=? AND business_date=? AND revision=?`)
      .bind(input.state,input.campusId || existing.campus_id,at,memberId,input.businessDate,expected)
      : db.prepare(`INSERT INTO staff_presence(member_id,business_date,campus_id,state,revision,updated_at) VALUES(?,?,?,?,0,?)`).bind(memberId,input.businessDate,input.campusId || null,input.state,at);
    const expectedRevision = existing ? Number(expected) + 1 : 0;
    const result = await db.batch([statement,db.prepare(`INSERT INTO presence_events(id,member_id,business_date,from_state,to_state,occurred_at,actor_member_id,actor_account)
      SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM staff_presence WHERE member_id=? AND business_date=? AND revision=?)`)
      .bind(crypto.randomUUID(),memberId,input.businessDate,existing?.state || null,input.state,at,actor.memberId,actor.account,memberId,input.businessDate,expectedRevision)]);
    return result[0]?.meta?.changes ? { memberId,businessDate:input.businessDate,campusId:input.campusId || existing?.campus_id || null,state:input.state,revision:expected + 1 } : null;
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
  async function audit(input) {
    await db.prepare(`INSERT INTO audit_events(id,actor_member_id,actor_account,action,action_version,source_ref,before_json,after_json,reason,request_id,request_trace_id,occurred_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(input.id || crypto.randomUUID(),input.actorMemberId || null,input.actorAccount || null,input.action,input.actionVersion || '1',json(input.sourceRef,{}),input.before === undefined ? null : json(input.before,{}),input.after === undefined ? null : json(input.after,{}),input.reason || '',input.requestId || null,input.requestTraceId || null,input.occurredAt || nowIso()).run();
  }
  async function listAudit(filters = {}) {
    const conditions = [], args = [];
    if (filters.actorMemberId) { conditions.push('actor_member_id=?'); args.push(filters.actorMemberId); }
    if (filters.action) { conditions.push('action=?'); args.push(filters.action); }
    const result = await db.prepare(`SELECT * FROM audit_events ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY occurred_at DESC,id DESC LIMIT 501`).bind(...args).all();
    return rows(result).map(row => ({ id: row.id, actorMemberId: row.actor_member_id, actorAccount: row.actor_account, action: row.action, actionVersion: row.action_version, sourceRef: parseJson(row.source_ref, {}), before: parseJson(row.before_json, null), after: parseJson(row.after_json, null), reason: row.reason, requestId: row.request_id, occurredAt: row.occurred_at }));
  }

  async function createRosterTask(input, actorMemberId) {
    const id = input.id || crypto.randomUUID(); const at = nowIso();
    await db.prepare(`INSERT INTO roster_tasks(id,week_start,campus_scope,slot_start,slot_end,member_ids,deadline,description,created_by_member_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .bind(id,input.weekStart,json(input.campusScope,{}),input.slotStart,input.slotEnd,json(input.memberIds,[]),input.deadline,input.description || '',actorMemberId,at).run();
    return rosterTask(await db.prepare('SELECT * FROM roster_tasks WHERE id=?').bind(id).first());
  }
  function rosterTask(row) { return row ? { id: row.id, weekStart: row.week_start, campusScope: parseJson(row.campus_scope,{}), slotStart: row.slot_start, slotEnd: row.slot_end, memberIds: parseJson(row.member_ids,[]), deadline: row.deadline, description: row.description, revision: row.revision, createdAt: row.created_at } : null; }
  async function listRosterTasks() { const result = await db.prepare('SELECT * FROM roster_tasks ORDER BY week_start DESC,id DESC LIMIT 101').all(); return rows(result).map(rosterTask); }
  async function saveAvailability(taskId, memberId, input) {
    const id = input.id || crypto.randomUUID();
    await db.prepare(`INSERT INTO availability(id,task_id,member_id,business_date,start_at,end_at,campus_id,revision) VALUES(?,?,?,?,?,?,?,0)
      ON CONFLICT(task_id,member_id,business_date,start_at,end_at) DO UPDATE SET campus_id=excluded.campus_id,revision=availability.revision+1`)
      .bind(id,taskId,memberId,input.businessDate,input.startAt,input.endAt,input.campusId || null).run();
    const result = await db.prepare('SELECT * FROM availability WHERE task_id=? AND member_id=? ORDER BY business_date,start_at').bind(taskId,memberId).all();
    return rows(result).map(row => ({ id: row.id, taskId: row.task_id, memberId: row.member_id, businessDate: row.business_date, startAt: row.start_at, endAt: row.end_at, campusId: row.campus_id, revision: row.revision }));
  }
  async function availability(taskId) { const result = await db.prepare('SELECT * FROM availability WHERE task_id=? ORDER BY business_date,start_at').bind(taskId).all(); return rows(result).map(row => ({ id: row.id, taskId: row.task_id, memberId: row.member_id, businessDate: row.business_date, startAt: row.start_at, endAt: row.end_at, campusId: row.campus_id, revision: row.revision })); }
  async function createRosterVersion(input) {
    const id = input.id || crypto.randomUUID(); const at = nowIso();
    const statements = [db.prepare(`INSERT INTO roster_versions(id,task_id,status,version,rule_version,algorithm_version,input_snapshot_ref,solver_status,validation_result,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .bind(id,input.taskId,input.status || 'draft',input.version || 1,input.ruleVersion || '1.0.0',input.algorithmVersion || 'deterministic-greedy-v1',json(input.inputSnapshotRef,{}),input.solverStatus || 'feasible',json(input.validation,{}),at)];
    for (const item of input.assignments || []) {
      const assignmentId = item.id || crypto.randomUUID();
      statements.push(db.prepare(`INSERT INTO duty_assignments(id,version_id,member_id,business_date,campus_id,duty_type,start_at,end_at) VALUES(?,?,?,?,?,?,?,?)`)
        .bind(assignmentId,id,item.memberId,item.businessDate,item.campusId,item.dutyType || 'repair',item.startAt,item.endAt));
      if (item.roleKind) statements.push(db.prepare('INSERT INTO duty_roles(id,assignment_id,role_kind,effective_range) VALUES(?,?,?,?)')
        .bind(`duty-role-${assignmentId}-${item.roleKind}`,assignmentId,item.roleKind,json(item.effectiveRange || {})));
    }
    await db.batch(statements);
    return rosterVersion(await db.prepare('SELECT * FROM roster_versions WHERE id=?').bind(id).first());
  }
  function rosterVersion(row) { return row ? { id: row.id, taskId: row.task_id, status: row.status, version: row.version, ruleVersion: row.rule_version, algorithmVersion: row.algorithm_version, inputSnapshotRef: parseJson(row.input_snapshot_ref,{}), solverStatus: row.solver_status, validation: parseJson(row.validation_result,{}), publishedAt: row.published_at, createdAt: row.created_at } : null; }
  async function updateRosterDraft(id, input, revision) {
    const nextVersion = Number(revision) + 1;
    const validation = input.validation || { valid: false, errors: [{ code: 'DRAFT_CHANGED_REQUIRES_VALIDATION' }] };
    const statements = [db.prepare(`UPDATE roster_versions SET version=?,validation_result=? WHERE id=? AND version=? AND status='draft'`).bind(nextVersion,json(validation,{}),id,revision),
      db.prepare(`DELETE FROM duty_roles WHERE assignment_id IN (SELECT id FROM duty_assignments WHERE version_id=?) AND EXISTS(SELECT 1 FROM roster_versions WHERE id=? AND version=? AND status='draft')`).bind(id,id,nextVersion),
      db.prepare(`DELETE FROM duty_assignments WHERE version_id=? AND changes()>0 AND EXISTS(SELECT 1 FROM roster_versions WHERE id=? AND version=? AND status='draft')`).bind(id,id,nextVersion)];
    for (const item of input.assignments || []) {
      const assignmentId = item.id || crypto.randomUUID();
      statements.push(db.prepare(`INSERT INTO duty_assignments(id,version_id,member_id,business_date,campus_id,duty_type,start_at,end_at)
        SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM roster_versions WHERE id=? AND version=? AND status='draft')`)
        .bind(assignmentId,id,item.memberId,item.businessDate,item.campusId,item.dutyType || 'repair',item.startAt,item.endAt,id,nextVersion));
      if (item.roleKind) statements.push(db.prepare(`INSERT INTO duty_roles(id,assignment_id,role_kind,effective_range) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM duty_assignments WHERE id=? AND version_id=?)`)
        .bind(`duty-role-${assignmentId}-${item.roleKind}`,assignmentId,item.roleKind,json(item.effectiveRange || {}),assignmentId,id));
    }
    const result = await db.batch(statements);
    if (!result[0]?.meta?.changes) return null;
    return rosterVersion(await db.prepare('SELECT * FROM roster_versions WHERE id=?').bind(id).first());
  }
  async function publishRoster(id, revision) {
    const at = nowIso();
    const current = await db.prepare(`SELECT task_id FROM roster_versions WHERE id=? AND version=? AND status='draft'`).bind(id,revision).first();
    if (!current) return null;
    const result = await db.batch([
      db.prepare(`UPDATE roster_versions SET status='published',published_at=? WHERE id=? AND version=? AND status='draft' AND COALESCE(json_extract(validation_result,'$.valid'),0)=1`).bind(at,id,revision),
      db.prepare(`UPDATE roster_versions SET status='superseded' WHERE task_id=? AND status='published' AND id<>? AND changes()>0`).bind(current.task_id,id)
    ]);
    return result[0]?.meta?.changes ? rosterVersion(await db.prepare('SELECT * FROM roster_versions WHERE id=?').bind(id).first()) : null;
  }
  async function listAssignments(memberId, weekStart) {
    const result = await db.prepare(`SELECT da.*,c.name AS campus_name,dr.role_kind FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id AND rv.status='published' JOIN campuses c ON c.id=da.campus_id LEFT JOIN duty_roles dr ON dr.assignment_id=da.id WHERE da.member_id=? AND da.business_date>=? AND da.business_date<=date(?, '+6 day') ORDER BY da.business_date,da.start_at`).bind(memberId,weekStart,weekStart).all();
    return rows(result).map(assignment);
  }
  async function assignmentById(id) {
    const row = await db.prepare(`SELECT da.*,c.name AS campus_name,dr.role_kind FROM duty_assignments da JOIN campuses c ON c.id=da.campus_id
      LEFT JOIN duty_roles dr ON dr.assignment_id=da.id WHERE da.id=?`).bind(id).first();
    return assignment(row);
  }
  async function createLeave(input, actorMemberId) { const id = input.id || crypto.randomUUID(); await db.prepare(`INSERT INTO leave_requests(id,assignment_id,member_id,reason,created_at) VALUES(?,?,?,?,?)`).bind(id,input.assignmentId,actorMemberId,input.reason,nowIso()).run(); return db.prepare('SELECT * FROM leave_requests WHERE id=?').bind(id).first(); }
  async function leaveById(id) { return db.prepare('SELECT * FROM leave_requests WHERE id=?').bind(id).first(); }
  async function listLeaves(filters = {}) {
    const conditions = [], args = [];
    if (filters.memberId) { conditions.push('member_id=?'); args.push(filters.memberId); }
    if (filters.status) { conditions.push('status=?'); args.push(filters.status); }
    const result = await db.prepare(`SELECT * FROM leave_requests ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY created_at DESC,id DESC LIMIT 501`).bind(...args).all();
    return rows(result);
  }
  async function updateLeave(id, status, actorMemberId, revision, note = '') { const result = await db.prepare(`UPDATE leave_requests SET status=?,reviewer_member_id=?,review_note=?,reviewed_at=?,revision=revision+1 WHERE id=? AND revision=? AND status='pending'`).bind(status,actorMemberId,note,nowIso(),id,revision).run(); return result.meta?.changes ? db.prepare('SELECT * FROM leave_requests WHERE id=?').bind(id).first() : null; }
  async function createSwap(input, actorMemberId) { const id = input.id || crypto.randomUUID(); await db.prepare(`INSERT INTO swap_requests(id,from_assignment_id,to_assignment_id,from_member_id,to_member_id,from_revision,to_revision,note,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(id,input.fromAssignmentId,input.toAssignmentId,actorMemberId,input.toMemberId,input.fromRevision,input.toRevision,input.note || '',nowIso()).run(); return db.prepare('SELECT * FROM swap_requests WHERE id=?').bind(id).first(); }
  async function listSwaps(filters = {}) {
    const conditions = [], args = [];
    if (filters.memberId) { conditions.push('(from_member_id=? OR to_member_id=?)'); args.push(filters.memberId, filters.memberId); }
    if (filters.status) { conditions.push('status=?'); args.push(filters.status); }
    const result = await db.prepare(`SELECT * FROM swap_requests ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY created_at DESC,id DESC LIMIT 501`).bind(...args).all();
    return rows(result);
  }
  async function updateSwap(id, status, actorMemberId, revision) {
    const request = await db.prepare('SELECT * FROM swap_requests WHERE id=? AND to_member_id=? AND revision=? AND status=\'pending\'').bind(id,actorMemberId,revision).first();
    if (!request) return null;
    if (status !== 'accepted') {
      const result = await db.prepare(`UPDATE swap_requests SET status=?,revision=revision+1,decided_at=? WHERE id=? AND to_member_id=? AND revision=? AND status='pending'`)
        .bind(status,nowIso(),id,actorMemberId,revision).run();
      return result.meta?.changes ? db.prepare('SELECT * FROM swap_requests WHERE id=?').bind(id).first() : null;
    }
    const at = nowIso();
    const result = await db.batch([
      db.prepare(`UPDATE duty_assignments SET member_id=?,revision=revision+1 WHERE id=? AND member_id=? AND revision=?`)
        .bind(request.to_member_id,request.from_assignment_id,request.from_member_id,request.from_revision),
      db.prepare(`UPDATE duty_assignments SET member_id=?,revision=revision+1 WHERE id=? AND member_id=? AND revision=?`)
        .bind(request.from_member_id,request.to_assignment_id,request.to_member_id,request.to_revision),
      db.prepare(`UPDATE swap_requests SET status='accepted',revision=revision+1,decided_at=? WHERE id=? AND to_member_id=? AND revision=? AND status='pending'`)
        .bind(at,id,actorMemberId,revision)
    ]);
    return result[2]?.meta?.changes ? db.prepare('SELECT * FROM swap_requests WHERE id=?').bind(id).first() : null;
  }

  return { accountRow, accountForMember, ensureMember, memberRow, memberships, profiles, grants, todayDuties, authorizationContext, listMembers, updateMember, listMemberships, addMembership, endMembership,
    listCampuses, listDepartments, listLocations, listPresence, activeRepair, importMembers,
    roleBindings, permissionDefinitions, listRoles, createRole, updateRole, bindRoles, modules, createEvent, issueToken, findEventByToken, findAttendanceByDedupe, insertAttendance, listAttendance, attendanceExport, setPresence,
    attendanceEvent, eventById: attendanceEvent, createReceipt, claimReceipt, releaseReceipt, receipt, audit, listAudit, createRosterTask, listRosterTasks, saveAvailability, availability, createRosterVersion, updateRosterDraft, publishRoster, listAssignments, assignmentById, createLeave, leaveById, listLeaves, updateLeave, createSwap, listSwaps, updateSwap };
}
