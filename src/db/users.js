import { dateKey } from '../../shared/time.js';
import { staffIdentities } from '../../shared/staff-identities.js';

const roleNames = `(SELECT json_group_array(name) FROM (SELECT DISTINCT r.name FROM member_roles mr JOIN roles r ON r.id=mr.role_id
  WHERE mr.member_id=staff_accounts.member_id AND r.enabled=1 AND mr.effective_from<=? AND (mr.effective_to IS NULL OR mr.effective_to>?) ORDER BY r.level DESC,r.name)) AS role_names`;
const memberships = `(SELECT json_group_array(json_object('assignmentType',mdm.assignment_type,'isPrimary',mdm.is_primary,'positionCode',mdm.position_code,'departmentName',d.name))
  FROM member_department_memberships mdm JOIN departments d ON d.id=mdm.department_id
  WHERE mdm.member_id=staff_accounts.member_id AND d.enabled=1 AND mdm.effective_from<=? AND (mdm.effective_to IS NULL OR mdm.effective_to>?)) AS identity_memberships`;
const select = (extra = '') => `SELECT staff_accounts.*,(SELECT status FROM members WHERE id=staff_accounts.member_id) AS member_status,
  (SELECT json_group_array(campus) FROM staff_access_campuses WHERE account=staff_accounts.account) AS campuses
  ${extra}
  FROM staff_accounts`;
export function publicUser(row) {
  return row ? { account: row.account, memberId: row.member_id || '', memberStatus: row.member_status || 'active', name: row.name, role: row.role, status: row.status,
    homeCampus: row.home_campus, authorizedCampuses: JSON.parse(row.campuses || '[]'),
    protected: !!row.protected, createdAt: row.created_at, workload: row.workload ?? 0,
    authVersion: row.auth_version ?? row.token_version ?? 0,
    ...(row.role_names !== undefined ? { roleNames: JSON.parse(row.role_names || '[]') } : {}),
    ...(row.identity_memberships !== undefined ? { identities: staffIdentities({ actor: { role: row.role }, memberships: JSON.parse(row.identity_memberships || '[]') }) } : {}) } : null;
}
export function publicUserView(user) {
  if (!user) return null;
  return Object.fromEntries(Object.entries(user).filter(([key]) => !['passwordHash','tokenVersion','revision'].includes(key)));
}
export function userRepository(db) {
  async function find(id, { withRoles = false } = {}) {
    const day = dateKey();
    const row = await db.prepare(`${select(withRoles ? `,${roleNames},${memberships}` : '')} WHERE account=?`)
      .bind(...(withRoles ? [day, day, day, day, id] : [id])).first();
    return row ? { ...publicUser(row), passwordHash: row.password_hash, tokenVersion: row.token_version, authVersion: row.auth_version ?? row.token_version ?? 0, revision: row.revision } : null;
  }
  return {
    find,
    async health() { await db.prepare('SELECT account FROM staff_accounts LIMIT 1').first(); },
    async findByName(name) {
      return (await db.prepare(`${select()} WHERE name=? LIMIT 2`).bind(name).all()).results.map(publicUser);
    },
    async assignees({ campus, q }) {
      const search = q.toLowerCase();
      return (await db.prepare(`SELECT account,trim(name) AS name FROM staff_accounts
        WHERE status='enabled'
          AND EXISTS(SELECT 1 FROM members WHERE id=staff_accounts.member_id AND status='active')
          AND EXISTS(SELECT 1 FROM staff_access_campuses WHERE account=staff_accounts.account AND campus=?)
          AND (instr(lower(name),?)>0 OR instr(lower(account),?)>0)
        ORDER BY name,account`).bind(campus,search,search).all()).results;
    },
    async list(campuses = []) {
      const day = dateKey();
      return (await db.prepare(`${select(`,${roleNames},${memberships},
        (SELECT COUNT(*) FROM appointments WHERE campus IN (SELECT value FROM json_each(?)) AND assigned_to=staff_accounts.account AND
          status IN ('in_progress','completed')) AS workload`)}
        ORDER BY role DESC,name`).bind(day,day,day,day,JSON.stringify(campuses)).all()).results.map(publicUser);
    },
    async update(target, patch, { selfPassword = false, auditRecord } = {}) {
      const fields = [], args = [];
      for (const [key,column] of Object.entries({ role:'role',status:'status',name:'name',homeCampus:'home_campus',passwordHash:'password_hash' })) {
        if (patch[key] !== undefined) { fields.push(`${column}=?`); args.push(patch[key]); }
      }
      if (['role','status','passwordHash','authorizedCampuses'].some(key => patch[key] !== undefined)) fields.push('token_version=token_version+1','auth_version=auth_version+1');
      const protection = selfPassword ? '' : ' AND protected=0';
      const authorization=auditRecord?.authVersion !== undefined ? " AND EXISTS(SELECT 1 FROM staff_accounts writer JOIN members m ON m.id=writer.member_id WHERE writer.account=? AND writer.member_id=? AND writer.auth_version=? AND writer.status='enabled' AND m.status='active')" : '';
      const authorizationArgs=auditRecord?.authVersion !== undefined ? [auditRecord.actorAccount,auditRecord.actorMemberId,auditRecord.authVersion] : [];
      const initialEligible = `EXISTS(SELECT 1 FROM staff_accounts WHERE account=? AND revision=?${protection})${authorization}`;
      const initialArgs=[target.account,target.revision,...authorizationArgs];
      const marker=crypto.randomUUID();
      const eligible='EXISTS(SELECT 1 FROM audit_events WHERE id=?)';
      const eligibleArgs=[marker];
      const statements = [];
      statements.push(db.prepare(`INSERT INTO audit_events(id,actor_member_id,actor_account,action,source_ref,before_json,after_json,occurred_at)
        SELECT ?,?,?,'authorization.account.updated',?,?,?,? WHERE ${initialEligible}`).bind(marker,auditRecord?.actorMemberId || null,auditRecord?.actorAccount || null,
        JSON.stringify({module:'identity',type:'account',id:target.account}),JSON.stringify(publicUserView(target)),
        JSON.stringify({...Object.fromEntries(Object.entries(patch).filter(([key])=>key!=='passwordHash')),passwordChanged:patch.passwordHash!==undefined}),new Date().toISOString(),...initialArgs));
      // Claim the expected revision once. Campus triggers can then invalidate
      // sessions without invalidating this transaction's remaining statements.
      if (patch.authorizedCampuses !== undefined) {
        statements.push(db.prepare(`DELETE FROM staff_campus_grants WHERE account=? AND ${eligible}`).bind(target.account,...eligibleArgs));
        statements.push(...patch.authorizedCampuses.map(campus => db.prepare(`INSERT INTO staff_campus_grants(account,campus) SELECT ?,? WHERE ${eligible}`)
          .bind(target.account,campus,...eligibleArgs)));
      }
      if (patch.name !== undefined || patch.homeCampus !== undefined) {
        const memberFields = [], memberArgs = [];
        if (patch.name !== undefined) { memberFields.push('name=?'); memberArgs.push(patch.name); }
        if (patch.homeCampus !== undefined) { memberFields.push('home_campus_id=?'); memberArgs.push(patch.homeCampus === '浑南' ? 'campus-hunnan' : 'campus-nanhu'); }
        statements.push(db.prepare(`UPDATE members SET ${memberFields.join(',')},revision=revision+1,updated_at=? WHERE id=(SELECT member_id FROM staff_accounts WHERE account=?) AND ${eligible}`)
          .bind(...memberArgs,new Date().toISOString(),target.account,...eligibleArgs));
      }
      const accountStatementIndex = statements.length;
      statements.push(db.prepare(`UPDATE staff_accounts SET ${fields.length ? fields.join(',')+',' : ''}revision=revision+1 WHERE account=? AND ${eligible} RETURNING account`)
        .bind(...args,target.account,...eligibleArgs));
      const results = await db.batch(statements);
      return results[accountStatementIndex]?.results?.length ? publicUserView(await find(target.account)) : null;
    },
    async revokeTokens(id) { await db.prepare('UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1,revision=revision+1 WHERE account=?').bind(id).run(); }
  };
}
