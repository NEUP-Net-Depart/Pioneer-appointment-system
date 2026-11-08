import { nowIso } from '../../platform/time.js';

export function departmentsDomain({ db, auditStatement, commandAuthorization }) {
  async function saveDepartment(input, auditRecord) {
    const authorization = commandAuthorization(auditRecord);
    const id = input.id || `dept-${crypto.randomUUID()}`;
    const statement = input.id
      ? db
          .prepare(
            `UPDATE departments SET name=?,enabled=?,revision=revision+1 WHERE id=? AND revision=? ${authorization.sql}`
          )
          .bind(input.name, input.enabled ? 1 : 0, id, input.revision, ...authorization.args)
      : db
          .prepare(
            `INSERT INTO departments(id,code,name,enabled) SELECT ?,?,?,? WHERE 1=1 ${authorization.sql}`
          )
          .bind(id, id, input.name, input.enabled ? 1 : 0, ...authorization.args);
    const result = await db.batch([
      statement,
      auditStatement(
        {
          ...auditRecord,
          sourceRef: { module: 'organization', type: 'department', id },
          occurredAt: nowIso()
        },
        true
      )
    ]);
    return result[0]?.meta?.changes
      ? {
          id,
          code: auditRecord.before?.code || id,
          name: input.name,
          enabled: input.enabled,
          revision: input.id ? input.revision + 1 : 0
        }
      : null;
  }
  return { saveDepartment };
}
