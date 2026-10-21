import { commandsDomain } from './staff-platform/commands.js';
import { stableJson } from '../platform/contracts.js';

const setting = row => row && ({ campus: row.campus, releaseTime: row.release_time, revision: row.revision });
const notice = row => row && ({ id: row.id, campus: row.campus, title: row.title, content: row.content,
  important: !!row.important, enabled: !!row.enabled, displayMode: row.display_mode, startsAt: row.starts_at, endsAt: row.ends_at, revision: row.revision });

export function bookingSettingsRepository(db) {
  const { receipt, commandAuthorization, auditStatement } = commandsDomain({ db });
  async function notices(campus, at) {
    const result = await db.prepare(`SELECT * FROM booking_notices WHERE campus=?
      ${at ? 'AND enabled=1 AND starts_at<=? AND ends_at>?' : ''} ORDER BY important DESC,starts_at DESC,id LIMIT 101`)
      .bind(campus, ...(at ? [at, at] : [])).all();
    return result.results.map(notice);
  }
  async function save(kind, input, audit) {
    const action = `booking.${kind}.updated`, digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(input)));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join('');
    const previous = await receipt(audit.actorMemberId, action, input.requestId);
    if (previous) return { matches: previous.payloadHash === hash, result: previous.result };
    const marker = crypto.randomUUID(), at = audit.occurredAt;
    const result = { ...input, revision: input.revision + 1 };
    delete result.requestId;
    const auth = commandAuthorization(audit);
    const table = kind === 'settings' ? 'booking_settings' : 'booking_notices';
    const guard = kind === 'settings' ? 'campus=?' : 'id=? AND campus=?';
    const args = kind === 'settings' ? [input.campus] : [input.id, input.campus];
    const statements = [auditStatement({ ...audit, id: marker, action,
      sourceRef: { module: 'settings', type: kind, id: kind === 'settings' ? input.campus : input.id }, after: result }, false,
    { sql: `COALESCE((SELECT revision FROM ${table} WHERE ${guard}),-1)=? ${kind === 'notice' ? 'AND NOT EXISTS(SELECT 1 FROM booking_notices WHERE id=? AND campus<>?)' : ''} ${auth.sql}`, args: [...args, input.revision, ...(kind === 'notice' ? [input.id, input.campus] : []), ...auth.args] })];
    if (kind === 'settings') statements.push(db.prepare(`UPDATE booking_settings SET release_time=?,revision=revision+1,updated_at=?,updated_by=?
      WHERE campus=? AND EXISTS(SELECT 1 FROM audit_events WHERE id=?)`).bind(input.releaseTime, at, audit.actorAccount, input.campus, marker));
    else statements.push(db.prepare(`INSERT INTO booking_notices(id,campus,title,content,important,enabled,display_mode,starts_at,ends_at,revision,updated_at,updated_by)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM audit_events WHERE id=?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,content=excluded.content,important=excluded.important,enabled=excluded.enabled,
      display_mode=excluded.display_mode,starts_at=excluded.starts_at,ends_at=excluded.ends_at,revision=excluded.revision,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
      .bind(input.id, input.campus, input.title, input.content, +input.important, +input.enabled, input.displayMode, input.startsAt, input.endsAt, result.revision, at, audit.actorAccount, marker));
    statements.push(db.prepare(`INSERT INTO operation_receipts(actor_member_id,action,request_id,payload_hash,resource_ref,result_json,result_status,created_at)
      SELECT ?,?,?,?,'{}',?,'success',? WHERE EXISTS(SELECT 1 FROM audit_events WHERE id=?)`)
      .bind(audit.actorMemberId, action, input.requestId, hash, JSON.stringify(result), at, marker));
    try { await db.batch(statements); }
    catch (error) {
      const concurrent = await receipt(audit.actorMemberId, action, input.requestId);
      if (concurrent) return { matches: concurrent.payloadHash === hash, result: concurrent.result };
      throw error;
    }
    const saved = await receipt(audit.actorMemberId, action, input.requestId);
    return saved && { matches: saved.payloadHash === hash, result: saved.result };
  }
  return {
    async settings(campus) { return setting(await db.prepare('SELECT * FROM booking_settings WHERE campus=?').bind(campus).first()); },
    async suspensions(campus,today) {
      return (await db.prepare(`SELECT s.business_date AS businessDate,s.reason,s.revision,s.campus_id AS campusId
        FROM service_day_overrides s JOIN campuses c ON c.id=s.campus_id
        WHERE c.name=? AND s.paused=1 AND s.business_date>=? ORDER BY s.business_date LIMIT 100`).bind(campus,today).all()).results;
    },
    notices,
    save
  };
}
