import { parseJson, SCHEMA_VERSION } from '../../platform/contracts.js';
import { dateKey, nowIso } from '../../platform/time.js';
import { intersectScopes } from '../../modules/authorization/scopes.js';
import {
  memberColumns,
  assignmentLeaveColumn,
  rows,
  json,
  membership,
  profile,
  assignment
} from './shared.js';

export function membersDomain({ db, auditStatement, commandAuthorization }) {
  async function accountRow(account) {
    return db
      .prepare(
        `SELECT staff_accounts.*,m.id AS mapped_member_id,m.status AS member_status
      FROM staff_accounts LEFT JOIN members m ON m.id=staff_accounts.member_id WHERE staff_accounts.account=?`
      )
      .bind(account)
      .first();
  }

  async function ensureMember(account) {
    const row = await accountRow(account);
    // Migrations and the insert trigger own identity creation. Reading a
    // session must never recreate revoked roles, work posts or memberships.
    return row?.mapped_member_id || null;
  }

  async function memberRow(memberId) {
    return db.prepare(`SELECT ${memberColumns} FROM members m WHERE m.id=?`).bind(memberId).first();
  }

  async function accountForMember(memberId) {
    return db
      .prepare(
        `SELECT staff_accounts.*,m.id AS mapped_member_id,m.status AS member_status,
      (SELECT json_group_array(campus) FROM staff_campus_grants WHERE account=staff_accounts.account) AS campuses
      FROM staff_accounts LEFT JOIN members m ON m.id=staff_accounts.member_id
      WHERE staff_accounts.member_id=?`
      )
      .bind(memberId)
      .first();
  }

  async function memberships(memberId, businessDate = dateKey()) {
    const result = await db
      .prepare(
        `SELECT mdm.*,d.name AS department_name FROM member_department_memberships mdm
      JOIN departments d ON d.id=mdm.department_id WHERE mdm.member_id=?
      AND mdm.effective_from<=? AND (mdm.effective_to IS NULL OR ?<mdm.effective_to)
      ORDER BY mdm.is_primary DESC,mdm.effective_from`
      )
      .bind(memberId, businessDate, businessDate)
      .all();
    return rows(result).map(membership);
  }

  async function membershipsForMembers(memberIds, businessDate = dateKey()) {
    if (!memberIds.length) return [];
    const statements = [];
    // Keep each statement below D1's 100 bound-parameter limit.
    for (let offset = 0; offset < memberIds.length; offset += 90) {
      const ids = memberIds.slice(offset, offset + 90);
      statements.push(
        db
          .prepare(
            `SELECT mdm.*,d.name AS department_name FROM member_department_memberships mdm
        JOIN departments d ON d.id=mdm.department_id WHERE mdm.member_id IN (${ids.map(() => '?').join(',')})
        AND mdm.effective_from<=? AND (mdm.effective_to IS NULL OR ?<mdm.effective_to)
        ORDER BY mdm.is_primary DESC,mdm.effective_from`
          )
          .bind(...ids, businessDate, businessDate)
      );
    }
    return (await db.batch(statements)).flatMap((result) => rows(result).map(membership));
  }

  async function profiles(memberId, businessDate = dateKey()) {
    const result = await db
      .prepare(
        `SELECT * FROM member_work_profiles WHERE member_id=?
      AND effective_from<=? AND (effective_to IS NULL OR ?<effective_to) ORDER BY profile_code`
      )
      .bind(memberId, businessDate, businessDate)
      .all();
    return rows(result).map(profile);
  }

  async function profileHistory(memberId) {
    return rows(
      await db
        .prepare(
          'SELECT * FROM member_work_profiles WHERE member_id=? ORDER BY effective_from DESC,id'
        )
        .bind(memberId)
        .all()
    ).map(profile);
  }

  async function saveWorkProfile(memberId, input, revision, auditRecord) {
    const at = nowIso(),
      id = input.id || crypto.randomUUID();
    const authorization = commandAuthorization(auditRecord);
    const guard = input.id
      ? 'AND EXISTS(SELECT 1 FROM member_work_profiles WHERE id=? AND member_id=? AND revision=?)'
      : "AND NOT EXISTS(SELECT 1 FROM member_work_profiles WHERE member_id=? AND profile_code=? AND effective_from<COALESCE(?,'9999-12-31') AND (effective_to IS NULL OR effective_to>?))";
    const args = input.id
      ? [id, memberId, input.profileRevision]
      : [memberId, input.profileCode, input.effectiveTo || null, input.effectiveFrom];
    const statements = [
      db
        .prepare(
          `UPDATE members SET revision=revision+1,updated_at=? WHERE id=? AND revision=? ${guard} ${authorization.sql}`
        )
        .bind(at, memberId, revision, ...args, ...authorization.args),
      input.id
        ? db
            .prepare(
              'UPDATE member_work_profiles SET effective_to=?,revision=revision+1 WHERE id=? AND member_id=? AND changes()>0'
            )
            .bind(input.effectiveTo, id, memberId)
        : db
            .prepare(
              'INSERT INTO member_work_profiles(id,member_id,profile_code,effective_from,effective_to) SELECT ?,?,?,?,? WHERE changes()>0'
            )
            .bind(id, memberId, input.profileCode, input.effectiveFrom, input.effectiveTo || null),
      auditStatement(
        { ...auditRecord, sourceRef: { module: 'identity', type: 'work-profile', id } },
        true
      ),
      db
        .prepare(
          'UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id=? AND changes()>0'
        )
        .bind(memberId)
    ];
    const result = await db.batch(statements);
    return result[0]?.meta?.changes ? profileHistory(memberId) : null;
  }

  async function grants(memberId, businessDate = dateKey()) {
    const result = await db
      .prepare(
        `SELECT rg.*,mr.scope_bindings,mr.effective_from,mr.effective_to,r.code AS role_code
      FROM member_roles mr JOIN roles r ON r.id=mr.role_id AND r.enabled=1
      JOIN role_grants rg ON rg.role_id=r.id
      WHERE mr.member_id=? AND mr.effective_from<=? AND (mr.effective_to IS NULL OR ?<mr.effective_to)
      ORDER BY rg.permission_code`
      )
      .bind(memberId, businessDate, businessDate)
      .all();
    return rows(result).map((row) => ({
      id: row.id,
      roleId: row.role_id,
      roleCode: row.role_code,
      permissionCode: row.permission_code,
      scope: intersectScopes(parseJson(row.scope_spec, {}), parseJson(row.scope_bindings, {})),
      conditions: parseJson(row.condition_spec, []),
      validity: parseJson(row.validity_spec, {}),
      binding: { effectiveFrom: row.effective_from, effectiveTo: row.effective_to }
    }));
  }

  async function todayDuties(memberId, businessDate = dateKey()) {
    const result = await db
      .prepare(
        `SELECT da.*,(SELECT paused FROM service_day_overrides s WHERE s.business_date=da.business_date AND s.campus_id=da.campus_id) AS service_paused,c.name AS campus_name,dr.role_kind,${assignmentLeaveColumn} FROM duty_assignments da
      JOIN roster_versions rv ON rv.id=da.version_id AND rv.status='published'
      JOIN campuses c ON c.id=da.campus_id LEFT JOIN duty_roles dr ON dr.assignment_id=da.id
      WHERE da.member_id=? AND da.business_date=? ORDER BY da.start_at`
      )
      .bind(memberId, businessDate)
      .all();
    return rows(result).map(assignment);
  }

  async function authorizationContext(user, businessDate = dateKey()) {
    const memberId = await ensureMember(user.account, user);
    const member = await db
      .prepare(
        'SELECT m.id,m.name,m.student_id,m.home_campus_id,m.status,m.revision,m.created_at,m.updated_at FROM members m WHERE m.id=?'
      )
      .bind(memberId)
      .first();
    const [membershipItems, profileItems, grantItems, duties, presence] = await Promise.all([
      memberships(memberId, businessDate),
      profiles(memberId, businessDate),
      grants(memberId, businessDate),
      todayDuties(memberId, businessDate),
      db
        .prepare('SELECT * FROM staff_presence WHERE member_id=? AND business_date=?')
        .bind(memberId, businessDate)
        .first()
    ]);
    const authVersion = user.authVersion ?? user.tokenVersion ?? 0;
    return {
      actor: {
        memberId,
        account: user.account,
        name: member?.name || user.name,
        status: member?.status || user.status
      },
      member,
      memberships: membershipItems,
      workProfiles: profileItems,
      grants: grantItems,
      todayDuties: duties,
      presence: presence
        ? {
            memberId: presence.member_id,
            businessDate: presence.business_date,
            campusId: presence.campus_id,
            state: presence.state,
            revision: presence.revision
          }
        : null,
      authVersion,
      schemaVersion: SCHEMA_VERSION
    };
  }

  async function listMembers(filters = {}) {
    const conditions = [],
      args = [];
    if (filters.studentId) {
      conditions.push('m.student_id=?');
      args.push(filters.studentId);
    }
    if (filters.q) {
      conditions.push(
        '(m.name LIKE ? OR m.student_id LIKE ? OR EXISTS(SELECT 1 FROM staff_accounts searched WHERE searched.member_id=m.id AND searched.account LIKE ?))'
      );
      const q = `%${filters.q}%`;
      args.push(q, q, q);
    }
    if (filters.status) {
      conditions.push('m.status=?');
      args.push(filters.status);
    }
    if (filters.homeCampusId) {
      conditions.push('m.home_campus_id=?');
      args.push(filters.homeCampusId);
    }
    if (filters.homeCampusIds?.length) {
      conditions.push(`m.home_campus_id IN (${filters.homeCampusIds.map(() => '?').join(',')})`);
      args.push(...filters.homeCampusIds);
    }
    if (filters.after) {
      conditions.push('(m.name>? OR (m.name=? AND m.id>?))');
      args.push(filters.after.name, filters.after.name, filters.after.memberId);
    }
    const query = `SELECT ${memberColumns},sa.account,sa.status AS account_status,sa.role,sa.auth_version,
      (SELECT GROUP_CONCAT(d.name,'、') FROM member_department_memberships mdm JOIN departments d ON d.id=mdm.department_id
       WHERE mdm.member_id=m.id AND mdm.is_primary=1 AND mdm.effective_from<=?
         AND (mdm.effective_to IS NULL OR ?<mdm.effective_to)) AS primary_department
      FROM members m LEFT JOIN staff_accounts sa ON sa.account=(SELECT account FROM staff_accounts WHERE member_id=m.id ORDER BY account LIMIT 1)
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY m.name,m.id LIMIT 101`;
    const businessDate = filters.businessDate || dateKey();
    const result = await db
      .prepare(query)
      .bind(businessDate, businessDate, ...args)
      .all();
    return rows(result).map((row) => ({
      memberId: row.id,
      name: row.name,
      studentId: row.student_id || '',
      college: row.college || '',
      major: row.major || '',
      homeCampusId: row.home_campus_id || '',
      status: row.status,
      account: row.account || '',
      accountStatus: row.account_status || '',
      role: row.role || '',
      authVersion: row.auth_version || 0,
      primaryDepartment: row.primary_department || '',
      revision: row.revision,
      memberships: []
    }));
  }

  async function updateMember(memberId, patch, revision, auditRecord) {
    const fields = [],
      args = [];
    if (patch.name !== undefined) {
      fields.push('name=?');
      args.push(patch.name);
    }
    if (patch.studentId !== undefined) {
      fields.push('student_id=?');
      args.push(patch.studentId || null);
    }
    if (patch.college !== undefined) {
      fields.push('college=?');
      args.push(patch.college);
    }
    if (patch.major !== undefined) {
      fields.push('major=?');
      args.push(patch.major);
    }
    if (patch.homeCampusId !== undefined) {
      fields.push('home_campus_id=?');
      args.push(patch.homeCampusId);
    }
    if (patch.status !== undefined) {
      fields.push('status=?');
      args.push(patch.status);
    }
    if (!fields.length) return await memberRow(memberId);
    const at = nowIso();
    fields.push('revision=revision+1', 'updated_at=?');
    args.push(at, memberId, revision);
    const authorization = commandAuthorization(auditRecord);
    const account = await accountForMember(memberId);
    // All effects follow the successful CAS in the same transaction, including
    // the audit. A failed audit must not leave a changed member or session behind.
    const statements = [
      db
        .prepare(
          `UPDATE members SET ${fields.join(',')} WHERE id=? AND revision=? ${authorization.sql}`
        )
        .bind(...args, ...authorization.args)
    ];
    if (auditRecord) statements.push(auditStatement(auditRecord, true));
    if (
      account &&
      (patch.name !== undefined || patch.status !== undefined || patch.homeCampusId !== undefined)
    ) {
      const accountFields = [],
        accountArgs = [];
      if (patch.name !== undefined) {
        accountFields.push('name=?');
        accountArgs.push(patch.name);
      }
      // Member availability is independent of an individual login's enabled state.
      if (patch.homeCampusId !== undefined) {
        accountFields.push('home_campus=?');
        accountArgs.push(
          patch.homeCampusId === 'campus-hunnan'
            ? '浑南'
            : patch.homeCampusId === 'campus-nanhu'
              ? '南湖'
              : patch.homeCampusId
        );
      }
      if (patch.status !== undefined || patch.homeCampusId !== undefined)
        accountFields.push('token_version=token_version+1', 'auth_version=auth_version+1');
      statements.push(
        db
          .prepare(
            `UPDATE staff_accounts SET ${accountFields.join(',')} WHERE member_id=? AND changes()>0`
          )
          .bind(...accountArgs, memberId)
      );
    }
    const result = await db.batch(statements);
    if (!result[0]?.meta?.changes) return null;
    return memberRow(memberId);
  }

  async function listMemberships(memberId, includeHistory = true) {
    const result = await db
      .prepare(
        `SELECT mdm.*,d.name AS department_name FROM member_department_memberships mdm JOIN departments d ON d.id=mdm.department_id
      WHERE mdm.member_id=? ${includeHistory ? '' : 'AND mdm.effective_to IS NULL'} ORDER BY mdm.effective_from DESC`
      )
      .bind(memberId)
      .all();
    return rows(result).map(membership);
  }

  async function addMembership(memberId, input, revision, auditRecord) {
    const id = input.id || crypto.randomUUID();
    const createdAt = nowIso();
    const authorization = commandAuthorization(auditRecord);
    const statements = [
      db
        .prepare(
          `UPDATE members SET revision=revision+1,updated_at=? WHERE id=? AND revision=? ${authorization.sql}`
        )
        .bind(createdAt, memberId, revision, ...authorization.args),
      db
        .prepare(
          `INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,effective_from,effective_to,created_at) SELECT ?,?,?,?,?,?,?,? WHERE changes()>0`
        )
        .bind(
          id,
          memberId,
          input.departmentId,
          input.assignmentType || 'secondary',
          input.isPrimary ? 1 : 0,
          input.effectiveFrom,
          input.effectiveTo || null,
          createdAt
        )
    ];
    if (auditRecord)
      statements.push(
        auditStatement(
          { ...auditRecord, sourceRef: { module: 'organization', type: 'membership', id } },
          true
        )
      );
    statements.push(
      db
        .prepare(
          'UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id=? AND changes()>0'
        )
        .bind(memberId)
    );
    const result = await db.batch(statements);
    if (!result[0]?.meta?.changes && !result[0]?.results?.length) return null;
    return (await listMemberships(memberId)).find((item) => item.id === id) || null;
  }

  async function endMembership(memberId, membershipId, effectiveTo, revision, auditRecord) {
    const authorization = commandAuthorization(auditRecord);
    const statements = [
      db
        .prepare(
          `UPDATE member_department_memberships SET effective_to=?,revision=revision+1
      WHERE id=? AND member_id=? AND revision=? AND (effective_to IS NULL OR effective_to>?) ${authorization.sql}`
        )
        .bind(effectiveTo, membershipId, memberId, revision, effectiveTo, ...authorization.args)
    ];
    if (auditRecord) statements.push(auditStatement(auditRecord, true));
    statements.push(
      db
        .prepare('UPDATE members SET revision=revision+1,updated_at=? WHERE id=? AND changes()>0')
        .bind(nowIso(), memberId),
      db
        .prepare(
          'UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id=? AND changes()>0'
        )
        .bind(memberId)
    );
    const result = await db.batch(statements);
    return result[0]?.meta?.changes
      ? (await listMemberships(memberId)).find((item) => item.id === membershipId)
      : null;
  }

  async function accountsForMember(memberId) {
    return rows(
      await db
        .prepare('SELECT account FROM staff_accounts WHERE member_id=? ORDER BY account')
        .bind(memberId)
        .all()
    ).map((row) => row.account);
  }

  async function importMembers(items, actorAccount, auditRecord) {
    const at = nowIso();
    const statements = [];
    const authorization = commandAuthorization(auditRecord);
    if (auditRecord?.authVersion !== undefined)
      statements.push(
        db
          .prepare(
            `SELECT CASE WHEN 1=1 ${authorization.sql}
      THEN 1 ELSE abs(-9223372036854775808) END AS authorized`
          )
          .bind(...authorization.args)
      );
    for (const item of items.filter((item) => Object.hasOwn(item, 'expectedMember'))) {
      const expected = item.expectedMember;
      let check = expected
        ? 'EXISTS(SELECT 1 FROM members WHERE id=? AND revision=?)'
        : 'NOT EXISTS(SELECT 1 FROM members WHERE student_id=?)';
      const args = expected ? [expected.memberId, expected.revision] : [item.studentId];
      if (expected && Object.hasOwn(expected, 'account')) {
        check += expected.account
          ? ' AND EXISTS(SELECT 1 FROM staff_accounts WHERE member_id=? AND account=? AND auth_version=?)'
          : ' AND NOT EXISTS(SELECT 1 FROM staff_accounts WHERE member_id=?)';
        args.push(expected.memberId);
        if (expected.account) args.push(expected.account.account, expected.account.authVersion);
      }
      statements.push(
        db
          .prepare(`SELECT CASE WHEN ${check} THEN 1 ELSE abs(-9223372036854775808) END AS current`)
          .bind(...args)
      );
    }
    const roleRows = rows(await db.prepare('SELECT id,code FROM roles WHERE enabled=1').all());
    const rolesByCode = Object.fromEntries(roleRows.map((row) => [row.code, row.id]));
    for (const item of items) {
      const existing = await db
        .prepare('SELECT id FROM members WHERE student_id=?')
        .bind(item.studentId)
        .first();
      const id = existing?.id || item.memberId || `member-${item.studentId}`;
      statements.push(
        db
          .prepare(
            `INSERT INTO members(id,name,student_id,home_campus_id,college,major,status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(student_id) DO UPDATE SET name=excluded.name,home_campus_id=excluded.home_campus_id,
          college=excluded.college,major=excluded.major,status=excluded.status,
          revision=members.revision+1,updated_at=excluded.updated_at`
          )
          .bind(
            id,
            item.name,
            item.studentId,
            item.homeCampusId,
            item.college || '',
            item.major || '',
            item.status || 'active',
            at,
            at
          )
      );
      if (item.departmentId)
        statements.push(
          db
            .prepare(
              `INSERT OR IGNORE INTO member_department_memberships
        (id,member_id,department_id,assignment_type,is_primary,effective_from,created_at)
        VALUES(?,?,?,?,?,?,?)`
            )
            .bind(
              `membership-${item.studentId}-${item.departmentId}`,
              id,
              item.departmentId,
              item.assignmentType || 'primary',
              item.isPrimary === false ? 0 : 1,
              item.effectiveFrom || dateKey(),
              at
            )
        );
      for (const profileCode of item.workProfiles || [])
        statements.push(
          db
            .prepare(
              `INSERT OR IGNORE INTO member_work_profiles(id,member_id,profile_code,effective_from)
        VALUES(?,?,?,?)`
            )
            .bind(
              `profile-import-${item.studentId}-${profileCode}`,
              id,
              profileCode,
              item.effectiveFrom || dateKey()
            )
        );
      for (const roleCode of item.roleCodes || []) {
        if (!rolesByCode[roleCode]) continue;
        const campusIds = (item.authorizedCampuses || []).map(
          (value) => ({ 南湖: 'campus-nanhu', 浑南: 'campus-hunnan' })[value] || value
        );
        statements.push(
          db
            .prepare(
              `INSERT OR IGNORE INTO member_roles(id,member_id,role_id,scope_bindings,effective_from)
          VALUES(?,?,?,?,?)`
            )
            .bind(
              `member-role-import-${item.studentId}-${roleCode}`,
              id,
              rolesByCode[roleCode],
              json(item.roleScope || (campusIds.length ? { campusIds } : {})),
              item.effectiveFrom || dateKey()
            )
        );
      }
      const accounts = await accountsForMember(id);
      const campusIds = (item.authorizedCampuses || []).map(
        (value) => ({ 'campus-nanhu': '南湖', 'campus-hunnan': '浑南' })[value] || value
      );
      // Profile imports preserve login authorization. The service resolves a
      // single login, enforced by the unique member index.
      const targets = item.accountTargets || [];
      if (targets.some((account) => !accounts.includes(account)))
        throw new Error('IMPORT_ACCOUNT_CHANGED');
      for (const account of targets) {
        // Also clear grants when the import intentionally supplies an empty
        // list; leaving old rows behind would keep stale access alive.
        statements.push(
          db.prepare('DELETE FROM staff_campus_grants WHERE account=?').bind(account)
        );
        for (const campus of campusIds)
          statements.push(
            db
              .prepare('INSERT OR IGNORE INTO staff_campus_grants(account,campus) VALUES(?,?)')
              .bind(account, campus)
          );
      }
      if (accounts.length)
        statements.push(
          db
            .prepare(
              'UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id=?'
            )
            .bind(id)
        );
      if (
        !accounts.length &&
        (item.workProfiles?.length || item.roleCodes?.length) &&
        item.roleCodes?.length &&
        campusIds.length
      ) {
        statements.push(
          db
            .prepare(
              `INSERT INTO staff_whitelist(student_id,expected_name,expected_role,created_by,created_at)
          VALUES(?,?,?,?,?) ON CONFLICT(student_id) DO UPDATE SET expected_name=excluded.expected_name,expected_role=excluded.expected_role,revision=staff_whitelist.revision+1
          WHERE staff_whitelist.status='open'`
            )
            .bind(item.studentId, item.name, item.accountRole || 'technician', actorAccount, at)
        );
        statements.push(
          db
            .prepare(
              'INSERT OR IGNORE INTO activation_member_bindings(student_id,member_id) VALUES(?,?)'
            )
            .bind(item.studentId, id)
        );
        statements.push(
          db
            .prepare(
              "DELETE FROM whitelist_campus_grants WHERE student_id=? AND EXISTS(SELECT 1 FROM staff_whitelist WHERE student_id=? AND status='open')"
            )
            .bind(item.studentId, item.studentId)
        );
        for (const campus of campusIds)
          statements.push(
            db
              .prepare(
                "INSERT OR IGNORE INTO whitelist_campus_grants(student_id,campus) SELECT ?,? WHERE EXISTS(SELECT 1 FROM staff_whitelist WHERE student_id=? AND status='open')"
              )
              .bind(item.studentId, campus, item.studentId)
          );
      }
    }
    if (statements.length) {
      if (auditRecord) statements.push(auditStatement(auditRecord));
      await db.batch(statements);
    }
    const result = [];
    for (let offset = 0; offset < items.length; offset += 90) {
      const page = items.slice(offset, offset + 90);
      result.push(
        ...rows(
          await db
            .prepare(
              `SELECT ${memberColumns} FROM members m WHERE m.student_id IN (${page.map(() => '?').join(',')})`
            )
            .bind(...page.map((item) => item.studentId))
            .all()
        )
      );
    }
    return result.sort((a, b) => a.student_id.localeCompare(b.student_id));
  }
  async function importEducation(items, auditRecord) {
    const authorization = commandAuthorization(auditRecord);
    const at = nowIso();
    const statements = items.map((item) =>
      db
        .prepare(
          `UPDATE members SET college=?,major=?,revision=revision+1,updated_at=?
       WHERE id=? AND student_id=? AND revision=? ${authorization.sql}`
        )
        .bind(
          item.college,
          item.major,
          at,
          item.memberId,
          item.studentId,
          item.revision,
          ...authorization.args
        )
    );
    for (const item of items)
      statements.push(
        db
          .prepare(
            `SELECT CASE WHEN EXISTS(SELECT 1 FROM members WHERE id=? AND revision=?)
       THEN 1 ELSE abs(-9223372036854775808) END AS current`
          )
          .bind(item.memberId, item.revision + 1)
      );
    statements.push(auditStatement(auditRecord));
    await db.batch(statements);
  }
  return {
    accountRow,
    ensureMember,
    memberRow,
    accountForMember,
    accountsForMember,
    memberships,
    membershipsForMembers,
    profiles,
    profileHistory,
    saveWorkProfile,
    grants,
    todayDuties,
    authorizationContext,
    listMembers,
    updateMember,
    listMemberships,
    addMembership,
    endMembership,
    importMembers,
    importEducation
  };
}
