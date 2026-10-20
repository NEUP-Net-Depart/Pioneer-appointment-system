import { parseJson } from '../../platform/contracts.js';
import { nowIso } from '../../platform/time.js';
import { rows, json } from './shared.js';

export function commandsDomain({ db }) {
  async function createReceipt(
    actorMemberId,
    action,
    requestIdValue,
    payloadHash,
    resultValue,
    resourceRef = {}
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

  async function claimReceipt(actorMemberId, action, requestIdValue, payloadHash) {
    const result = await db
      .prepare(
        `INSERT OR IGNORE INTO operation_receipts(actor_member_id,action,request_id,payload_hash,resource_ref,result_json,result_status,created_at)
      VALUES(?,?,?,?,?,'{}','pending',?)`
      )
      .bind(actorMemberId, action, requestIdValue, payloadHash, '{}', nowIso())
      .run();
    return !!result.meta?.changes;
  }

  async function releaseReceipt(actorMemberId, action, requestIdValue, payloadHash) {
    await db
      .prepare(
        `DELETE FROM operation_receipts WHERE actor_member_id=? AND action=? AND request_id=? AND payload_hash=? AND result_status='pending'`
      )
      .bind(actorMemberId, action, requestIdValue, payloadHash)
      .run();
  }

  async function receipt(actorMemberId, action, requestIdValue) {
    const row = await db
      .prepare(
        'SELECT * FROM operation_receipts WHERE actor_member_id=? AND action=? AND request_id=?'
      )
      .bind(actorMemberId, action, requestIdValue)
      .first();
    return row
      ? {
          payloadHash: row.payload_hash,
          resourceRef: parseJson(row.resource_ref, {}),
          result: parseJson(row.result_json, {}),
          resultStatus: row.result_status,
          createdAt: row.created_at
        }
      : null;
  }

  function auditStatement(input, conditional = false, guard) {
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

  async function audit(input) {
    await auditStatement(input).run();
  }

  async function listAudit(filters = {}) {
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
      .all();
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

  function commandAuthorization(record) {
    if (record?.authVersion === undefined) return { sql: '', args: [] };
    return {
      sql: `AND EXISTS(SELECT 1 FROM staff_accounts account JOIN members actor ON actor.id=account.member_id
      WHERE account.account=? AND account.member_id=? AND account.auth_version=? AND account.status='enabled' AND actor.status='active')`,
      args: [record.actorAccount, record.actorMemberId, record.authVersion]
    };
  }
  return {
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
