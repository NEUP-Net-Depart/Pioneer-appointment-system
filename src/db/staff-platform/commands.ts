import type { Database, DatabaseStatement } from '../../platform/environment.ts';
import type { AuditRecordInput, CommandRecord, ResourceRef, SqlGuard } from '../records.ts';

interface ReceiptRow {
  payload_hash: string;
  resource_ref: string;
  result_json: string;
  result_status: 'pending' | 'success';
  created_at: string;
}

interface AuditRow {
  id: string;
  actor_member_id: string | null;
  actor_account: string | null;
  action: string;
  action_version: string;
  source_ref: string;
  before_json: string | null;
  after_json: string | null;
  reason: string;
  request_id: string | null;
  occurred_at: string;
}

export type CommandRepository = ReturnType<typeof commandsDomain>;
import { parseJson } from '../../platform/contracts.ts';
import { nowIso } from '../../platform/time.ts';
import { rows, json } from './shared.ts';

export function commandsDomain({ db }: { db: Database }) {
  async function createReceipt(
    actorMemberId: string,
    action: string,
    requestIdValue: string,
    payloadHash: string,
    resultValue: unknown,
    resourceRef: Partial<ResourceRef> = {}
  ) {
    await db
      .prepare(
        `UPDATE operation_receipts SET resource_ref=?,result_json=?,result_status='success'
      WHERE actor_member_id=? AND action=? AND request_id=? AND payload_hash=?`
      )
      .bind(
        json(resourceRef, {}),
        json(resultValue, {}),
        actorMemberId,
        action,
        requestIdValue,
        payloadHash
      )
      .run();
  }

  async function claimReceipt(
    actorMemberId: string,
    action: string,
    requestIdValue: string,
    payloadHash: string
  ) {
    const result = await db
      .prepare(
        `INSERT OR IGNORE INTO operation_receipts(actor_member_id,action,request_id,payload_hash,resource_ref,result_json,result_status,created_at)
      VALUES(?,?,?,?,?,'{}','pending',?)`
      )
      .bind(actorMemberId, action, requestIdValue, payloadHash, '{}', nowIso())
      .run();
    return !!result.meta?.changes;
  }

  async function releaseReceipt(
    actorMemberId: string,
    action: string,
    requestIdValue: string,
    payloadHash: string
  ) {
    await db
      .prepare(
        `DELETE FROM operation_receipts WHERE actor_member_id=? AND action=? AND request_id=? AND payload_hash=? AND result_status='pending'`
      )
      .bind(actorMemberId, action, requestIdValue, payloadHash)
      .run();
  }

  async function receipt<T extends object = Record<string, unknown>>(
    actorMemberId: string,
    action: string,
    requestIdValue: string
  ) {
    const row = await db
      .prepare(
        'SELECT * FROM operation_receipts WHERE actor_member_id=? AND action=? AND request_id=?'
      )
      .bind(actorMemberId, action, requestIdValue)
      .first<ReceiptRow>();
    return row
      ? {
          payloadHash: row.payload_hash,
          resourceRef: parseJson<Partial<ResourceRef>>(row.resource_ref, {}),
          result: parseJson<T>(row.result_json, {} as T),
          resultStatus: row.result_status,
          createdAt: row.created_at
        }
      : null;
  }

  function auditStatement(input: AuditRecordInput, conditional = false, guard?: SqlGuard) {
    return db
      .prepare(
        `INSERT INTO audit_events(id,actor_member_id,actor_account,action,action_version,source_ref,before_json,after_json,reason,request_id,request_trace_id,occurred_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,? ${guard ? `WHERE ${guard.sql}` : conditional ? 'WHERE changes()>0' : ''}`
      )
      .bind(
        input.id || crypto.randomUUID(),
        input.actorMemberId || null,
        input.actorAccount || null,
        input.action,
        input.actionVersion || '1',
        json(input.sourceRef, {}),
        input.before === undefined ? null : json(input.before, {}),
        input.after === undefined ? null : json(input.after, {}),
        input.reason || '',
        input.requestId || null,
        input.requestTraceId || null,
        input.occurredAt || nowIso(),
        ...(guard?.args || [])
      );
  }

  async function audit(input: AuditRecordInput) {
    await auditStatement(input).run();
  }

  async function listAudit(filters: { actorMemberId?: string; action?: string } = {}) {
    const conditions = [],
      args = [];
    if (filters.actorMemberId) {
      conditions.push('actor_member_id=?');
      args.push(filters.actorMemberId);
    }
    if (filters.action) {
      conditions.push('action=?');
      args.push(filters.action);
    }
    const result = await db
      .prepare(
        `SELECT * FROM audit_events ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY occurred_at DESC,id DESC LIMIT 501`
      )
      .bind(...args)
      .all<AuditRow>();
    return rows(result).map((row) => ({
      id: row.id,
      actorMemberId: row.actor_member_id,
      actorAccount: row.actor_account,
      action: row.action,
      actionVersion: row.action_version,
      sourceRef: parseJson(row.source_ref, {}),
      before: parseJson(row.before_json, null),
      after: parseJson(row.after_json, null),
      reason: row.reason,
      requestId: row.request_id,
      occurredAt: row.occurred_at
    }));
  }

  function commandAuthorization(record?: Partial<AuditRecordInput> | null) {
    if (record?.authVersion === undefined) return { sql: '', args: [] };
    const sql = [
      `AND EXISTS(SELECT 1 FROM staff_accounts account JOIN members actor ON actor.id=account.member_id
      WHERE account.account=? AND account.member_id=? AND account.auth_version=? AND account.status='enabled' AND actor.status='active')`
    ];
    const args: unknown[] = [record.actorAccount, record.actorMemberId, record.authVersion];
    if (record.roleVersions) {
      sql.push(`AND NOT EXISTS(SELECT 1 FROM json_each(?) expected LEFT JOIN roles r ON r.id=json_extract(expected.value,'$.id')
        WHERE r.id IS NULL OR r.revision<>json_extract(expected.value,'$.revision') OR r.enabled<>json_extract(expected.value,'$.enabled'))`);
      args.push(JSON.stringify(record.roleVersions));
    }
    if (record.roleGuard) {
      sql.push(`AND (${record.roleGuard.sql})=?`);
      args.push(...record.roleGuard.args, record.roleGuard.value);
    }
    if (record.targetAccountVersion) {
      sql.push('AND EXISTS(SELECT 1 FROM staff_accounts WHERE account=? AND auth_version=?)');
      args.push(record.targetAccountVersion.account, record.targetAccountVersion.auth_version);
    }
    return { sql: sql.join(' '), args };
  }

  // Facts, their audit and the retry receipt share one batch and one guard.
  async function writeCommand(
    record: CommandRecord,
    guard: string,
    args: unknown[],
    statements: (gate: string, auditId: string) => DatabaseStatement[]
  ) {
    const auth = commandAuthorization(record),
      id = crypto.randomUUID();
    const gate = 'EXISTS(SELECT 1 FROM audit_events WHERE id=?)';
    const commands = [
      db
        .prepare(
          `INSERT INTO audit_events(id,actor_member_id,actor_account,action,source_ref,before_json,after_json,reason,request_id,occurred_at)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE (${guard}) ${auth.sql}
      AND NOT EXISTS(SELECT 1 FROM operation_receipts WHERE actor_member_id=? AND action=? AND request_id=?)`
        )
        .bind(
          id,
          record.actorMemberId,
          record.actorAccount,
          record.action,
          json(record.sourceRef, {}),
          json(record.before, null),
          json(record.after, null),
          record.reason || '',
          record.requestId,
          record.at,
          ...args,
          ...auth.args,
          record.actorMemberId,
          record.action,
          record.requestId
        )
    ];
    commands.push(...statements(gate, id));
    commands.push(
      db
        .prepare(
          `INSERT INTO operation_receipts(actor_member_id,action,request_id,payload_hash,resource_ref,result_json,result_status,created_at)
      SELECT ?,?,?,?,?,?,'success',? WHERE ${gate}`
        )
        .bind(
          record.actorMemberId,
          record.action,
          record.requestId,
          record.payloadHash,
          json(record.sourceRef, {}),
          json(record.result, {}),
          record.at,
          id
        )
    );
    const result = await db.batch(commands);
    return !!result[0]?.meta?.changes;
  }
  return {
    writeCommand,
    async memberAudit(memberId: string) {
      return rows(
        await db
          .prepare(
            `SELECT actor_account,action,occurred_at,reason,
          CASE WHEN action='authorization.account.updated' THEN after_json END AS account_changes FROM audit_events
        WHERE (action IN ('identity.member.created','identity.member.imported','identity.member.updated','identity.retired_elder.granted','identity.retired_elder.revoked','identity.qualification.granted','identity.qualification.ended','identity.qualification.archived','organization.membership.updated','organization.membership.ended','authorization.member_roles.updated','authorization.member_activation.updated')
        AND (json_extract(source_ref,'$.id')=?
          OR json_extract(source_ref,'$.id') IN (SELECT id FROM member_department_memberships WHERE member_id=?)
          OR json_extract(source_ref,'$.id') IN (SELECT json_extract(before_json,'$.id') FROM audit_events WHERE action='identity.qualification.archived' AND json_extract(source_ref,'$.id')=?)))
        OR (action='authorization.account.updated' AND json_extract(source_ref,'$.type')='account'
          AND json_extract(source_ref,'$.id') IN (SELECT account FROM staff_accounts WHERE member_id=?))
        ORDER BY occurred_at DESC,id DESC LIMIT 50`
          )
          .bind(memberId, memberId, memberId, memberId)
          .all<AuditRow & { account_changes: string | null }>()
      ).map((row) => ({
        actorAccount: row.actor_account,
        action: row.action,
        occurredAt: row.occurred_at,
        reason: row.reason,
        ...(row.action === 'authorization.account.updated'
          ? {
              changes: Object.entries(parseJson(row.account_changes, {})).flatMap(
                ([key, value]) => {
                  const labels: Partial<Record<string, string>> = {
                    status: '账号状态',
                    role: '账号类型',
                    authorizedCampuses: '登录授权校区',
                    name: '账号姓名',
                    homeCampus: '所属校区',
                    passwordChanged: value === true ? '重置密码' : ''
                  };
                  const label = labels[key];
                  return label ? [label] : [];
                }
              )
            }
          : {})
      }));
    },
    createReceipt,
    claimReceipt,
    releaseReceipt,
    receipt,
    auditStatement,
    audit,
    listAudit,
    commandAuthorization
  };
}
