export function publicUser(row) {
  return row ? { account: row.account, name: row.name, role: row.role, campus: row.campus, active: !!row.active, protected: !!row.protected, createdAt: row.created_at, workload: row.workload ?? 0 } : null;
}
export function userRepository(db) {
  return {
    async health() { await db.prepare('SELECT account FROM users LIMIT 1').first(); },
    async find(id) {
      const row = await db.prepare('SELECT * FROM users WHERE account=?').bind(id).first();
      return row ? { ...publicUser(row), passwordHash: row.password_hash, tokenVersion: row.token_version, revision: row.revision } : null;
    },
    async findByName(name) {
      return (await db.prepare('SELECT * FROM users WHERE name=? LIMIT 2').bind(name).all()).results.map(publicUser);
    },
    async list() {
      return (await db.prepare(`SELECT users.*,COALESCE(workload.total,0) AS workload FROM users
        LEFT JOIN (SELECT assigned_to,COUNT(*) AS total FROM appointments WHERE assigned_to<>'' GROUP BY assigned_to) AS workload
        ON workload.assigned_to=users.account ORDER BY role DESC,name`).all()).results.map(publicUser);
    },
    async create(item) {
      return publicUser(await db.prepare('INSERT INTO users(account,name,role,campus,password_hash,created_at) VALUES (?,?,?,?,?,?) RETURNING *')
        .bind(item.account, item.name, item.role, item.campus, item.passwordHash, item.createdAt).first());
    },
    async update(target, patch) {
      const fields = [], args = [];
      for (const [key, column] of Object.entries({ role: 'role', active: 'active', name: 'name', campus: 'campus', passwordHash: 'password_hash' })) {
        if (patch[key] !== undefined) { fields.push(`${column}=?`); args.push(key === 'active' ? Number(patch[key]) : patch[key]); }
      }
      if (['role','active','passwordHash'].some(key => patch[key] !== undefined)) fields.push('token_version=token_version+1');
      return publicUser(await db.prepare(`UPDATE users SET ${fields.join(',')},revision=revision+1 WHERE account=? AND protected=0 AND revision=? RETURNING *`)
        .bind(...args, target.account, target.revision).first());
    },
    async delete(target) {
      return db.prepare('DELETE FROM users WHERE account=? AND protected=0 AND revision=? RETURNING account').bind(target.account, target.revision).first();
    },
    async revokeTokens(id) { await db.prepare('UPDATE users SET token_version=token_version+1,revision=revision+1 WHERE account=?').bind(id).run(); }
  };
}
