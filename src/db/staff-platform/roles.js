import { parseJson } from '../../platform/contracts.js';
import { dateKey, nowIso } from '../../platform/time.js';
import { rows, json } from './shared.js';

export function rolesDomain({ db, auditStatement, commandAuthorization }) {
  async function permissionDefinitions() {
    const result = await db
      .prepare('SELECT * FROM permission_definitions WHERE enabled=1 ORDER BY module_code,code')
      .all();
    return rows(result).map((row) => ({
      code: row.code,
      module: row.module_code,
      name: row.name,
      description: row.description,
      scopeKinds: parseJson(row.scope_kinds, []),
      conditionKinds: parseJson(row.condition_kinds, []),
      sensitive: !!row.sensitive,
      version: row.version
    }));
  }

  async function listRoles() {
    const result = await db
      .prepare(
        `SELECT r.*,json_group_array(json_object('id',rg.id,'permissionCode',rg.permission_code,'scope',rg.scope_spec,'conditions',rg.condition_spec,'validity',rg.validity_spec)) AS grants
      FROM roles r LEFT JOIN role_grants rg ON rg.role_id=r.id GROUP BY r.id ORDER BY r.level DESC,r.name`
      )
      .all();
    return rows(result).map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      level: row.level,
      enabled: !!row.enabled,
      revision: row.revision,
      grants: parseJson(row.grants, [])
        .filter((item) => item.id)
        .map((item) => ({
          ...item,
          scope: parseJson(item.scope, {}),
          conditions: parseJson(item.conditions, []),
          validity: parseJson(item.validity, {})
        }))
    }));
  }

  async function roleMembers(roleId) {
    return rows(
      await db
        .prepare(
          `SELECT DISTINCT m.* FROM members m JOIN member_roles mr ON mr.member_id=m.id
      WHERE mr.role_id=?`
        )
        .bind(roleId)
        .all()
    );
  }

  async function roleGuard(roleId) {
    const sql = `SELECT json_group_array(json_object('id',id,'scope',scope_bindings,'from',effective_from,'to',effective_to,
      'member',member_id,'revision',member_revision,'account',account,'auth',auth_version)) AS value FROM (
      SELECT mr.*,m.revision AS member_revision,sa.account,sa.auth_version FROM member_roles mr JOIN members m ON m.id=mr.member_id
      LEFT JOIN staff_accounts sa ON sa.member_id=mr.member_id WHERE mr.role_id=? ORDER BY mr.id)`;
    const row = await db.prepare(sql).bind(roleId).first();
    return { sql, args: [roleId], value: row.value };
  }

  async function createRole(input, auditRecord) {
    const id = input.id || crypto.randomUUID();
    const at = nowIso();
    const authorization = commandAuthorization(auditRecord);
    const marker = crypto.randomUUID(),
      gate = auditRecord ? 'EXISTS(SELECT 1 FROM audit_events WHERE id=?)' : '1=1',
      gateArgs = auditRecord ? [marker] : [];
    const statements = auditRecord
      ? [
          auditStatement(
            {
              ...auditRecord,
              id: marker,
              sourceRef: { module: 'authorization', type: 'role', id }
            },
            false,
            { sql: `1=1 ${authorization.sql}`, args: authorization.args }
          )
        ]
      : [];
    statements.push(
      db
        .prepare(
          `INSERT INTO roles(id,code,name,description,level,enabled,created_at,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE ${gate}`
        )
        .bind(
          id,
          input.code,
          input.name,
          input.description || '',
          input.level || 1,
          input.enabled === false ? 0 : 1,
          at,
          at,
          ...gateArgs
        )
    );
    for (const grant of input.grants || [])
      statements.push(
        db
          .prepare(
            `INSERT INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec,validity_spec) SELECT ?,?,?,?,?,? WHERE ${gate}`
          )
          .bind(
            grant.id || crypto.randomUUID(),
            id,
            grant.permissionCode,
            json(grant.scope, {}),
            json(grant.conditions, []),
            json(grant.validity, {}),
            ...gateArgs
          )
      );
    await db.batch(statements);
    return (await listRoles()).find((role) => role.id === id);
  }

  async function updateRole(id, input, revision, auditRecord) {
    const at = nowIso();
    const fields = [],
      args = [];
    for (const [key, column] of [
      ['name', 'name'],
      ['description', 'description'],
      ['level', 'level'],
      ['enabled', 'enabled']
    ])
      if (input[key] !== undefined) {
        fields.push(`${column}=?`);
        args.push(key === 'enabled' ? (input[key] ? 1 : 0) : input[key]);
      }
    fields.push('revision=revision+1', 'updated_at=?');
    args.push(at, id, revision);
    const authorization = commandAuthorization(auditRecord),
      marker = crypto.randomUUID();
    const gate = auditRecord
      ? 'EXISTS(SELECT 1 FROM audit_events WHERE id=?)'
      : 'EXISTS(SELECT 1 FROM roles WHERE id=? AND revision=?)';
    const gateArgs = auditRecord ? [marker] : [id, revision];
    const statements = auditRecord
      ? [
          auditStatement({ ...auditRecord, id: marker }, false, {
            sql: `EXISTS(SELECT 1 FROM roles WHERE id=? AND revision=?) ${authorization.sql}`,
            args: [id, revision, ...authorization.args]
          })
        ]
      : [];
    if (input.grants) {
      statements.push(
        db.prepare(`DELETE FROM role_grants WHERE role_id=? AND ${gate}`).bind(id, ...gateArgs)
      );
      for (const grant of input.grants)
        statements.push(
          db
            .prepare(
              `INSERT INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec,validity_spec) SELECT ?,?,?,?,?,? WHERE ${gate}`
            )
            .bind(
              grant.id || crypto.randomUUID(),
              id,
              grant.permissionCode,
              json(grant.scope, {}),
              json(grant.conditions, []),
              json(grant.validity, {}),
              ...gateArgs
            )
        );
    }
    statements.push(
      db
        .prepare(
          `UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id IN (SELECT member_id FROM member_roles WHERE role_id=?) AND ${gate}`
        )
        .bind(id, ...gateArgs)
    );
    statements.push(
      db
        .prepare(`UPDATE roles SET ${fields.join(',')} WHERE id=? AND revision=? AND ${gate}`)
        .bind(...args, ...gateArgs)
    );
    const result = await db.batch(statements);
    if (!result.at(-1)?.meta?.changes) return null;
    return (await listRoles()).find((role) => role.id === id) || null;
  }

  async function roleBindings(memberId) {
    const result = await db
      .prepare('SELECT * FROM member_roles WHERE member_id=? ORDER BY effective_from,id')
      .bind(memberId)
      .all();
    return rows(result).map((row) => ({
      id: row.id,
      roleId: row.role_id,
      scope: parseJson(row.scope_bindings, {}),
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      revision: row.revision
    }));
  }

  async function bindRoles(memberId, bindings, revision, auditRecord) {
    const at = nowIso();
    const authorization = commandAuthorization(auditRecord),
      marker = crypto.randomUUID();
    const gate = auditRecord
      ? 'EXISTS(SELECT 1 FROM audit_events WHERE id=?)'
      : 'EXISTS(SELECT 1 FROM members WHERE id=? AND revision=?)';
    const gateArgs = auditRecord ? [marker] : [memberId, revision];
    const statements = auditRecord
      ? [
          auditStatement({ ...auditRecord, id: marker }, false, {
            sql: `EXISTS(SELECT 1 FROM members WHERE id=? AND revision=?) ${authorization.sql}`,
            args: [memberId, revision, ...authorization.args]
          })
        ]
      : [];
    statements.push(
      db
        .prepare(`DELETE FROM member_roles WHERE member_id=? AND ${gate}`)
        .bind(memberId, ...gateArgs),
      db
        .prepare(
          `UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id=? AND ${gate}`
        )
        .bind(memberId, ...gateArgs)
    );
    for (const binding of bindings)
      statements.push(
        db
          .prepare(
            `INSERT INTO member_roles(id,member_id,role_id,scope_bindings,effective_from,effective_to) SELECT ?,?,?,?,?,? WHERE ${gate}`
          )
          .bind(
            binding.id || crypto.randomUUID(),
            memberId,
            binding.roleId,
            json(binding.scope, {}),
            binding.effectiveFrom || dateKey(),
            binding.effectiveTo || null,
            ...gateArgs
          )
      );
    statements.push(
      db
        .prepare(
          `UPDATE members SET revision=revision+1,updated_at=? WHERE id=? AND revision=? AND ${gate}`
        )
        .bind(at, memberId, revision, ...gateArgs)
    );
    const result = await db.batch(statements);
    return !!result.at(-1)?.meta?.changes;
  }

  async function modules() {
    const result = await db
      .prepare("SELECT * FROM module_catalog WHERE release_state<>'disabled' ORDER BY code")
      .all();
    return rows(result).map((row) => ({
      code: row.code,
      version: row.version,
      manifestHash: row.manifest_hash,
      contractVersion: row.contract_version,
      requiredSchemaVersion: row.required_schema_version,
      releaseState: row.release_state,
      manifest: parseJson(row.manifest_json, {})
    }));
  }
  return {
    permissionDefinitions,
    listRoles,
    roleMembers,
    roleGuard,
    createRole,
    updateRole,
    roleBindings,
    bindRoles,
    modules
  };
}
