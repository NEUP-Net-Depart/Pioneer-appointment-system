import { nowIso } from '../../platform/time.js';
import { memberColumns, rows, json } from './shared.js';

const students = 'SELECT value FROM json_each(?)';
const memberIds = `SELECT id FROM members WHERE student_id IN (${students})`;
const records = (table, columns, condition) =>
  `json((SELECT json_group_array(json_object(${columns.map((column) => `'${column}',${column}`).join(',')}))
    FROM (SELECT * FROM ${table} WHERE ${condition} ORDER BY ${columns[0]})))`;
// One database round trip for the complete import state. The same expression is
// checked inside the write transaction, including relations and invitations.
const snapshotSql = `SELECT json_object(
  'members',${records('members', ['id', 'name', 'student_id', 'home_campus_id', 'college', 'major', 'status', 'revision'], `student_id IN (${students})`)},
  'accounts',${records(
    `(SELECT a.account,a.member_id,a.name,a.home_campus,a.role,a.protected,a.status,a.auth_version,a.revision,
    CAST((SELECT json_group_array(campus) FROM (SELECT campus FROM staff_campus_grants WHERE account=a.account ORDER BY campus)) AS TEXT) AS campuses FROM staff_accounts a)`,
    [
      'account',
      'member_id',
      'name',
      'home_campus',
      'role',
      'protected',
      'status',
      'auth_version',
      'revision',
      'campuses'
    ],
    `member_id IN (${memberIds})`
  )},
  'memberships',${records('member_department_memberships', ['id', 'member_id', 'department_id', 'assignment_type', 'is_primary', 'effective_from', 'effective_to', 'revision'], `member_id IN (${memberIds})`)},
  'profiles',${records('member_work_profiles', ['id', 'member_id', 'profile_code', 'effective_from', 'effective_to', 'revision'], `member_id IN (${memberIds})`)},
  'bindings',${records('member_roles', ['id', 'member_id', 'role_id', 'scope_bindings', 'effective_from', 'effective_to', 'revision'], `member_id IN (${memberIds})`)},
  'invitations',${records(
    `(SELECT w.*,CAST((SELECT json_group_array(campus) FROM (SELECT campus FROM whitelist_campus_grants WHERE student_id=w.student_id ORDER BY campus)) AS TEXT) AS campuses FROM staff_whitelist w)`,
    ['student_id', 'expected_name', 'expected_role', 'status', 'revision', 'campuses'],
    `student_id IN (${students})`
  )},
  'activationBindings',${records('activation_member_bindings', ['student_id', 'member_id'], `student_id IN (${students})`)}
) AS value`;

export function memberImportDomain({ db, auditStatement, commandAuthorization }) {
  async function memberImportSnapshot(studentIds) {
    const ids = json([...studentIds].sort());
    const args = Array(7).fill(ids);
    const { value } = await db
      .prepare(snapshotSql)
      .bind(...args)
      .first();
    return { data: JSON.parse(value), guard: { sql: snapshotSql, args, value } };
  }

  async function importMembers(items, actorAccount, auditRecord) {
    const at = nowIso();
    const authorization = commandAuthorization(auditRecord);
    const statements = [
      db
        .prepare(
          `SELECT CASE WHEN 1=1 ${authorization.sql} THEN 1 ELSE abs(-9223372036854775808) END`
        )
        .bind(...authorization.args)
    ];
    const guard = auditRecord.importGuard;
    statements.push(
      db
        .prepare(`SELECT CASE WHEN (${guard.sql})=? THEN 1 ELSE abs(-9223372036854775808) END`)
        .bind(...guard.args, guard.value)
    );
    if (auditRecord.departmentVersions.length)
      statements.push(
        db
          .prepare(
            `SELECT CASE WHEN NOT EXISTS(
        SELECT 1 FROM json_each(?) expected LEFT JOIN departments d ON d.id=json_extract(expected.value,'$.id')
        WHERE d.id IS NULL OR d.enabled<>1 OR d.revision<>json_extract(expected.value,'$.revision'))
        THEN 1 ELSE abs(-9223372036854775808) END`
          )
          .bind(json(auditRecord.departmentVersions))
      );
    for (const item of items.filter((item) => item.status !== 'skipped')) {
      const id = item.memberId;
      const member = item.member;
      if (item.status === 'created') {
        statements.push(
          db
            .prepare(
              `INSERT INTO members(id,name,student_id,home_campus_id,college,major,status,created_at,updated_at)
          VALUES(?,?,?,?,?,?,'active',?,?)`
            )
            .bind(
              id,
              member.name,
              item.studentId,
              member.homeCampusId,
              member.college,
              member.major,
              at,
              at
            )
        );
      } else {
        statements.push(
          db
            .prepare(
              `UPDATE members SET name=?,home_campus_id=?,college=?,major=?,revision=revision+1,updated_at=? WHERE id=?`
            )
            .bind(member.name, member.homeCampusId, member.college, member.major, at, id)
        );
      }
      if (item.membership)
        statements.push(
          db
            .prepare(
              `INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,effective_from,created_at)
          VALUES(?,?,?,?,?,?,?)`
            )
            .bind(
              crypto.randomUUID(),
              id,
              item.membership.departmentId,
              item.membership.assignmentType,
              item.membership.assignmentType === 'primary' ? 1 : 0,
              item.effectiveFrom,
              at
            )
        );
      for (const profileCode of item.addProfiles)
        statements.push(
          db
            .prepare(
              'INSERT INTO member_work_profiles(id,member_id,profile_code,effective_from) VALUES(?,?,?,?)'
            )
            .bind(crypto.randomUUID(), id, profileCode, item.effectiveFrom)
        );
      for (const role of item.addRoles)
        statements.push(
          db
            .prepare(
              'INSERT INTO member_roles(id,member_id,role_id,scope_bindings,effective_from) VALUES(?,?,?,?,?)'
            )
            .bind(crypto.randomUUID(), id, role.id, json(item.roleScope), item.effectiveFrom)
        );
      if (item.updateAccountCampuses) {
        statements.push(
          db.prepare('DELETE FROM staff_campus_grants WHERE account=?').bind(item.account)
        );
        for (const campus of item.authorizedCampuses)
          statements.push(
            db
              .prepare('INSERT INTO staff_campus_grants(account,campus) VALUES(?,?)')
              .bind(item.account, campus)
          );
      }
      if (item.account && (item.syncAccount || item.authChanged))
        statements.push(
          db
            .prepare(
              `UPDATE staff_accounts SET name=?,home_campus=?,revision=revision+1,token_version=token_version+?,auth_version=auth_version+? WHERE account=?`
            )
            .bind(
              member.name,
              member.homeCampusId === 'campus-hunnan' ? '浑南' : '南湖',
              item.authChanged ? 1 : 0,
              item.authChanged ? 1 : 0,
              item.account
            )
        );
      if (item.invitation) {
        statements.push(
          db
            .prepare(
              `INSERT INTO staff_whitelist(student_id,expected_name,expected_role,created_by,created_at)
          VALUES(?,?,?,?,?) ON CONFLICT(student_id) DO UPDATE SET expected_name=excluded.expected_name,
          expected_role=excluded.expected_role,revision=staff_whitelist.revision+1 WHERE staff_whitelist.status='open'`
            )
            .bind(item.studentId, member.name, item.accountRole || 'technician', actorAccount, at)
        );
        statements.push(
          db
            .prepare(
              'INSERT OR IGNORE INTO activation_member_bindings(student_id,member_id) VALUES(?,?)'
            )
            .bind(item.studentId, id)
        );
        statements.push(
          db.prepare('DELETE FROM whitelist_campus_grants WHERE student_id=?').bind(item.studentId)
        );
        for (const campus of item.authorizedCampuses)
          statements.push(
            db
              .prepare('INSERT INTO whitelist_campus_grants(student_id,campus) VALUES(?,?)')
              .bind(item.studentId, campus)
          );
      }
      statements.push(
        auditStatement({
          ...auditRecord,
          action:
            item.status === 'created' ? 'identity.member.created' : 'identity.member.imported',
          sourceRef: { module: 'identity', type: 'member', id },
          before: item.before,
          after: { member, changes: item.changes }
        })
      );
    }
    await db.batch(statements);
    return rows(
      await db
        .prepare(
          `SELECT ${memberColumns} FROM members m WHERE m.student_id IN (${students}) ORDER BY m.student_id`
        )
        .bind(json(items.map((item) => item.studentId)))
        .all()
    );
  }
  return { memberImportSnapshot, importMembers };
}
