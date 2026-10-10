const select = `SELECT staff_accounts.*,
  (SELECT json_group_array(campus) FROM staff_campus_grants WHERE account=staff_accounts.account) AS campuses
  FROM staff_accounts`;
export function publicUser(row) {
  return row ? { account: row.account, name: row.name, role: row.role, status: row.status,
    homeCampus: row.home_campus, authorizedCampuses: JSON.parse(row.campuses || '[]'),
    protected: !!row.protected, createdAt: row.created_at, workload: row.workload ?? 0 } : null;
}
export function publicUserView(user) {
  if (!user) return null;
  return Object.fromEntries(Object.entries(user).filter(([key]) => !['passwordHash','tokenVersion','revision'].includes(key)));
}
export function userRepository(db) {
  async function find(id) {
    const row = await db.prepare(`${select} WHERE account=?`).bind(id).first();
    return row ? { ...publicUser(row), passwordHash: row.password_hash, tokenVersion: row.token_version, revision: row.revision } : null;
  }
  return {
    find,
    async health() { await db.prepare('SELECT account FROM staff_accounts LIMIT 1').first(); },
    async findByName(name) {
      return (await db.prepare(`${select} WHERE name=? LIMIT 2`).bind(name).all()).results.map(publicUser);
    },
    async list() {
      return (await db.prepare(`SELECT staff_accounts.*,
        (SELECT json_group_array(campus) FROM staff_campus_grants WHERE account=staff_accounts.account) AS campuses,
        (SELECT COUNT(*) FROM appointments WHERE assigned_to=staff_accounts.account) AS workload
        FROM staff_accounts ORDER BY role DESC,name`).all()).results.map(publicUser);
    },
    async create(item) {
      await db.batch([
        db.prepare('INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES (?,?,?,?,?,?)')
          .bind(item.account,item.name,item.role,item.homeCampus,item.passwordHash,item.createdAt),
        ...item.authorizedCampuses.map(campus => db.prepare('INSERT INTO staff_campus_grants(account,campus) VALUES (?,?)').bind(item.account,campus))
      ]);
      return publicUserView(await find(item.account));
    },
    async update(target, patch, { selfPassword = false } = {}) {
      const fields = [], args = [];
      for (const [key,column] of Object.entries({ role:'role',status:'status',name:'name',homeCampus:'home_campus',passwordHash:'password_hash' })) {
        if (patch[key] !== undefined) { fields.push(`${column}=?`); args.push(patch[key]); }
      }
      if (['role','status','passwordHash','authorizedCampuses'].some(key => patch[key] !== undefined)) fields.push('token_version=token_version+1');
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
      statements.push(db.prepare(`UPDATE staff_accounts SET ${fields.length ? fields.join(',')+',' : ''}revision=revision+1 WHERE account=? AND revision=?${protection} RETURNING account`)
        .bind(...args,target.account,target.revision));
      const results = await db.batch(statements);
      return results.at(-1).results.length ? publicUserView(await find(target.account)) : null;
    },
    async revokeTokens(id) { await db.prepare('UPDATE staff_accounts SET token_version=token_version+1,revision=revision+1 WHERE account=?').bind(id).run(); }
  };
}
