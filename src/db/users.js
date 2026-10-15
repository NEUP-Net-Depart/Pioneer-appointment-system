const select = `SELECT staff_accounts.*,
  (SELECT json_group_array(campus) FROM staff_campus_grants WHERE account=staff_accounts.account) AS campuses
  FROM staff_accounts`;
export function publicUser(row) {
  return row ? { account: row.account, memberId: row.member_id || '', name: row.name, role: row.role, status: row.status,
    homeCampus: row.home_campus, authorizedCampuses: JSON.parse(row.campuses || '[]'),
    protected: !!row.protected, createdAt: row.created_at, workload: row.workload ?? 0,
    authVersion: row.auth_version ?? row.token_version ?? 0 } : null;
}
export function publicUserView(user) {
  if (!user) return null;
  return Object.fromEntries(Object.entries(user).filter(([key]) => !['passwordHash','tokenVersion','revision'].includes(key)));
}
export function userRepository(db) {
  async function find(id) {
    const row = await db.prepare(`${select} WHERE account=?`).bind(id).first();
    return row ? { ...publicUser(row), passwordHash: row.password_hash, tokenVersion: row.token_version, authVersion: row.auth_version ?? row.token_version ?? 0, revision: row.revision } : null;
  }
  return {
    find,
    async health() { await db.prepare('SELECT account FROM staff_accounts LIMIT 1').first(); },
    async findByName(name) {
      return (await db.prepare(`${select} WHERE name=? LIMIT 2`).bind(name).all()).results.map(publicUser);
    },
    async assignees({ campus, q }) {
      const search = q.toLowerCase();
      return (await db.prepare(`SELECT account,trim(name) AS name FROM staff_accounts
        WHERE status='enabled' AND role IN ('technician','admin','superadmin')
          AND EXISTS(SELECT 1 FROM staff_campus_grants WHERE account=staff_accounts.account AND campus=?)
          AND (instr(lower(name),?)>0 OR instr(lower(account),?)>0)
        ORDER BY name,account`).bind(campus,search,search).all()).results;
    },
    async list() {
      return (await db.prepare(`SELECT staff_accounts.*,
        (SELECT json_group_array(campus) FROM staff_campus_grants WHERE account=staff_accounts.account) AS campuses,
        (SELECT COUNT(*) FROM appointments WHERE assigned_to=staff_accounts.account AND
          (status='in_progress' OR (status='completed' AND outcome IN ('repaired','unrepaired','not_needed','legacy_unknown')))) AS workload
        FROM staff_accounts ORDER BY role DESC,name`).all()).results.map(publicUser);
    },
    async update(target, patch, { selfPassword = false } = {}) {
      const fields = [], args = [];
      for (const [key,column] of Object.entries({ role:'role',status:'status',name:'name',homeCampus:'home_campus',passwordHash:'password_hash' })) {
        if (patch[key] !== undefined) { fields.push(`${column}=?`); args.push(patch[key]); }
      }
      if (['role','status','passwordHash','authorizedCampuses'].some(key => patch[key] !== undefined)) fields.push('token_version=token_version+1','auth_version=auth_version+1');
      const protection = selfPassword ? '' : ' AND protected=0';
      const eligible = `EXISTS(SELECT 1 FROM staff_accounts WHERE account=? AND revision=?${protection})`;
      const statements = [];
      // Grants change before the final revision increment, in the same D1 transaction.
      // A stale revision therefore changes neither account nor grants.
      if (patch.authorizedCampuses !== undefined) {
        statements.push(db.prepare(`DELETE FROM staff_campus_grants WHERE account=? AND ${eligible}`).bind(target.account,target.account,target.revision));
        statements.push(...patch.authorizedCampuses.map(campus => db.prepare(`INSERT INTO staff_campus_grants(account,campus) SELECT ?,? WHERE ${eligible}`)
          .bind(target.account,campus,target.account,target.revision)));
      }
      const accountStatementIndex = statements.length;
      statements.push(db.prepare(`UPDATE staff_accounts SET ${fields.length ? fields.join(',')+',' : ''}revision=revision+1 WHERE account=? AND revision=?${protection} RETURNING account`)
        .bind(...args,target.account,target.revision));
      if (patch.name !== undefined || patch.status !== undefined || patch.homeCampus !== undefined) {
        const memberFields = [], memberArgs = [];
        if (patch.name !== undefined) { memberFields.push('name=?'); memberArgs.push(patch.name); }
        if (patch.status !== undefined) { memberFields.push('status=?'); memberArgs.push(patch.status === 'enabled' ? 'active' : 'inactive'); }
        if (patch.homeCampus !== undefined) { memberFields.push('home_campus_id=?'); memberArgs.push(patch.homeCampus === '浑南' ? 'campus-hunnan' : 'campus-nanhu'); }
        statements.push(db.prepare(`UPDATE members SET ${memberFields.join(',')},revision=revision+1,updated_at=? WHERE id=(SELECT member_id FROM staff_accounts WHERE account=?) AND EXISTS(SELECT 1 FROM staff_accounts WHERE account=? AND revision=?)`)
          .bind(...memberArgs,new Date().toISOString(),target.account,target.account,target.revision + 1));
      }
      const results = await db.batch(statements);
      return results[accountStatementIndex]?.results?.length ? publicUserView(await find(target.account)) : null;
    },
    async revokeTokens(id) { await db.prepare('UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1,revision=revision+1 WHERE account=?').bind(id).run(); }
  };
}
