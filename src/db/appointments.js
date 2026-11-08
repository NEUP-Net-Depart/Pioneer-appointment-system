import { listAppointments, listContactCandidates, listStudentMatches } from './appointment-list.js';
import { serviceDayRepository } from './service-days.js';
import { APPOINTMENT_SEARCH_LIMIT } from '../../shared/appointment-search.js';
import { DEFAULT_SERVICE_LOCATIONS, terminalStatuses } from '../../shared/constants.js';
import { scheduleStatement } from './slot-capacities.js';
import { parseJson } from '../platform/contracts.js';

const columns = {
  parentAppointmentId: 'parent_appointment_id',
  linkKind: 'link_kind',
  linkedBy: 'linked_by',
  linkedAt: 'linked_at',
  receivedAt: 'received_at',
  receivedBy: 'received_by',
  photoDeferredBy: 'photo_deferred_by',
  studentId: 'student_id',
  name: 'name',
  college: 'college',
  campus: 'campus',
  phone: 'phone',
  social: 'social',
  deviceType: 'device_type',
  brand: 'brand',
  deviceModel: 'device_model',
  serial: 'serial',
  warranty: 'warranty',
  faultType: 'fault_type',
  issue: 'issue',
  liquidDrop: 'liquid_drop',
  date: 'date',
  timeSlot: 'time_slot',
  note: 'note',
  status: 'status',
  assignedTo: 'assigned_to',
  repairNote: 'repair_note',
  createdAt: 'created_at',
  outcome: 'outcome',
  startedAt: 'started_at',
  completedAt: 'completed_at',
  expiresAt: 'expires_at',
  agreementAt: 'agreement_at',
  agreementVersion: 'agreement_version',
  signature: 'signature',
  repairNumber: 'repair_number',
  frontPhotoId: 'front_photo_id',
  backPhotoId: 'back_photo_id',
  source: 'source',
  registeredBy: 'registered_by',
  registrationKey: 'registration_key',
  email: 'email',
  contactType: 'contact_type',
  contactValue: 'contact_value',
  liquidMetal: 'liquid_metal',
  dellG15: 'dell_g15',
  locationSnapshot: 'location_snapshot',
  locationRevision: 'location_revision'
};
const assigneeName =
  "(SELECT trim(name) FROM staff_accounts WHERE account=appointments.assigned_to AND status='enabled') AS assigned_to_name";
const memberIdentity =
  '(SELECT member_id FROM staff_accounts WHERE account=appointments.assigned_to) AS assigned_member_id,(SELECT member_id FROM staff_accounts WHERE account=appointments.registered_by) AS registered_member_id';
const select = `SELECT appointments.*,(SELECT trim(name) FROM staff_accounts WHERE account=appointments.received_by) AS received_by_name,(SELECT paused FROM service_day_overrides s JOIN campuses c ON c.id=s.campus_id WHERE s.business_date=appointments.date AND c.name=appointments.campus) AS service_paused,${assigneeName},${memberIdentity} FROM appointments`;
const contactSelect = `SELECT appointments.id,appointments.revision,appointments.campus,appointments.date,
  appointments.time_slot,appointments.status,appointments.phone,appointments.email,
  appointments.contact_value,appointments.social,
  (SELECT generation FROM appointment_contact_index_pending p WHERE p.appointment_id=appointments.id) AS __contact_generation,
  ${memberIdentity}
  FROM appointments`;
// UNION deduplicates ancestors and descendants, including historical branches.
const repairChain = `WITH RECURSIVE repair_chain(id) AS (
 SELECT ? UNION SELECT CASE WHEN a.id=chain.id THEN a.parent_appointment_id ELSE a.id END
 FROM repair_chain chain JOIN appointments a ON a.id=chain.id OR a.parent_appointment_id=chain.id
 WHERE a.parent_appointment_id IS NOT NULL
)`;
const memberAccounts =
  '(SELECT account FROM staff_accounts WHERE member_id=(SELECT member_id FROM staff_accounts WHERE account=?))';
function fromRow(row) {
  return row
    ? {
        id: row.id,
        servicePaused: !!row.service_paused,
        revision: row.revision,
        assignedToName: row.assigned_to_name || '',
        receivedByName: row.received_by_name || '',
        assignedMemberId: row.assigned_member_id || '',
        registeredMemberId: row.registered_member_id || '',
        ...(row.__contact_generation !== undefined ? { contactIndexGeneration: row.__contact_generation } : {}),
        ...Object.fromEntries(
          Object.entries(columns).map(([key, column]) => [
            key,
            row[column] ??
              ([
                'outcome',
                'startedAt',
                'completedAt',
                'repairNumber',
                'frontPhotoId',
                'backPhotoId',
                'liquidMetal',
                'dellG15',
                'locationRevision'
              ].includes(key)
                ? null
                : '')
          ])
        )
      }
    : null;
}
export function appointmentRepository(db) {
  const writeColumns = { ...columns, bookingNotices: 'booking_notices' };
  return {
    ...serviceDayRepository(db),
    async openFieldWork(campus,day) {
      return (await db.prepare(`${select} WHERE campus=? AND (status='in_progress' OR (status='booked' AND (date=? OR received_at IS NOT NULL))) ORDER BY created_at,id`).bind(campus,day).all()).results.map(fromRow);
    },
    async pendingPhotos(account,campus) {
      return (await db.prepare(`${select} WHERE photo_deferred_by=? AND campus=? AND (front_photo_id IS NULL OR back_photo_id IS NULL) ORDER BY received_at,id`).bind(account,campus).all()).results.map(fromRow);
    },
    async searchNumbers(
      text,
      date,
      { campuses },
      accessRules,
      { full = false, limit = APPOINTMENT_SEARCH_LIMIT + 1, offset = 0 } = {}
    ) {
      const scope = campuses.length ? `campus IN (${campuses.map(() => '?').join(',')})` : '0';
      const accessArgs = [];
      const access =
        accessRules
          .map((conditions) =>
            conditions.length
              ? '(' +
                conditions
                  .map(({ field, operator, value }) => {
                    if (!Object.hasOwn(columns, field))
                      throw new Error('Unknown appointment access field');
                    accessArgs.push(value);
                    return `${columns[field]} ${operator === 'ne' ? '<>' : '='} ?`;
                  })
                  .join(' AND ') +
                ')'
              : '1'
          )
          .join(' OR ') || '0';
      const result = (
        await db
          .prepare(
            `${full ? select : 'SELECT id,campus,date,time_slot AS timeSlot,status FROM appointments'}
        WHERE ${scope} AND (${access}) AND ${date ? "date=? AND instr(substr(id,instr(id,'-')+1),?)>0" : 'instr(id,?)>0'}
        ORDER BY CASE WHEN status IN (${terminalStatuses.map(() => '?').join(',')}) THEN 1 ELSE 0 END,date DESC,time_slot,id LIMIT ? OFFSET ?`
          )
          .bind(
            ...campuses,
            ...accessArgs,
            ...(date ? [date] : []),
            text,
            ...terminalStatuses,
            limit,
            offset
          )
          .all()
      ).results;
      return full ? result.map(fromRow) : result;
    },
    async location(date, campus) {
      return db
        .prepare('SELECT location,revision FROM service_locations WHERE date=? AND campus=?')
        .bind(date, campus)
        .first();
    },
    async ensureDefaultLocation(date, campus, instant) {
      const existing = await this.location(date, campus);
      if (existing) return existing;
      const created = await db
        .prepare(
          `INSERT INTO service_locations(campus,date,location,updated_at) VALUES (?,?,?,?)
        ON CONFLICT(campus,date) DO NOTHING RETURNING location,revision`
        )
        .bind(campus, date, DEFAULT_SERVICE_LOCATIONS[campus], instant)
        .first();
      return created || this.location(date, campus);
    },
    async findRequest(key) {
      return db
        .prepare(
          'SELECT request_key AS requestKey,digest,appointment_id AS appointmentId,encrypted_token AS encryptedToken FROM booking_requests WHERE request_key=?'
        )
        .bind(key)
        .first();
    },
    async schedule(date, campus) {
      return (await scheduleStatement(db, date, date, [campus]).all()).results;
    },
    async inProgress(account) {
      return (
        await db
          .prepare(
            `${select} WHERE assigned_to IN ${memberAccounts} AND status='in_progress' ORDER BY started_at,created_at,id`
          )
          .bind(account)
          .all()
      ).results.map(fromRow);
    },
    async findRegistration(account, key) {
      return fromRow(
        await db
          .prepare(`${select} WHERE registered_by IN ${memberAccounts} AND registration_key=?`)
          .bind(account, key)
          .first()
      );
    },
    async intakePhoto(id,photo,purpose,now) {
      if (!photo) return false;
      return !!await db.prepare(`SELECT id FROM appointment_attachments WHERE id=? AND appointment_id=? AND purpose=? AND expires_at>? AND mime_type LIKE 'image/%'`).bind(photo,id,purpose,now).first();
    },
    async countExpirations(instant) {
      return (
        await db
          .prepare(
            "SELECT COUNT(*) AS total FROM appointments WHERE status='booked' AND started_at IS NULL AND expires_at<=? AND received_at IS NULL"
          )
          .bind(instant)
          .first()
      ).total;
    },
    async expirePending(instant, { id, campuses, repairChainId } = {}) {
      const where = ["status='booked'", 'started_at IS NULL', 'expires_at<=?', "received_at IS NULL"],
        args = [instant, instant];
      if (id) {
        where.push('id=?');
        args.push(id);
      }
      if (repairChainId) { where.push(`id IN (${repairChain} SELECT id FROM repair_chain)`); args.push(repairChainId); }
      if (campuses) {
        where.push(campuses.length ? `campus IN (${campuses.map(() => '?').join(',')})` : '0');
        args.push(...campuses);
      }
      return db
        .prepare(
          `UPDATE appointments SET status='expired',outcome=NULL,completed_at=?,revision=revision+1 WHERE ${where.join(' AND ')}`
        )
        .bind(...args)
        .run();
    },
    async find(id) {
      return fromRow(await db.prepare(`${select} WHERE id=?`).bind(id).first());
    },
    async customerHistory(studentId,campuses) {
      if (!campuses.length) return [];
      return (await db.prepare(`${select} WHERE student_id=? AND campus IN (${campuses.map(()=>'?').join(',')}) AND status='completed' ORDER BY completed_at DESC,id`).bind(studentId,...campuses).all()).results.map(fromRow);
    },
    async repairHistory(id,{staff=false,campuses}={}) {
      const scope=campuses ? ` AND campus IN (${campuses.map(()=>'?').join(',') || "''"})` : '';
      const items=(await db.prepare(`${repairChain} ${select} WHERE id IN (SELECT id FROM repair_chain)${scope} ORDER BY created_at,id`).bind(id,...(campuses || [])).all()).results.map(fromRow);
      const fields=['id','campus','date','timeSlot','status','outcome','parentAppointmentId','linkKind','startedAt','completedAt','source','expiresAt','createdAt',...(staff?['repairNote','assignedToName']:[])];
      const result={items:items.map(item=>Object.fromEntries(fields.map(key=>[key,item[key]])))};
      if (staff) {
        const ids=JSON.stringify(items.map(item=>item.id));
        const rows=(await db.prepare(`SELECT action,occurred_at,reason,before_json,after_json,json_extract(source_ref,'$.id') AS appointment_id,
          (SELECT name FROM members WHERE id=actor_member_id) AS actor_name
          FROM audit_events WHERE json_extract(source_ref,'$.module')='repairs'
          AND json_extract(source_ref,'$.id') IN (SELECT value FROM json_each(?))
          AND action LIKE 'repairs.%' ORDER BY occurred_at,rowid`).bind(ids).all()).results;
        result.events=rows.map(row=>({appointmentId:row.appointment_id,action:row.action,occurredAt:row.occurred_at,actorName:row.actor_name,
          reason:row.reason,before:parseJson(row.before_json,null),after:parseJson(row.after_json,null)}));
      }
      return result;
    },
    async relatedForScan(parentId,childId) {
      return db.prepare(`${repairChain} SELECT id FROM appointments WHERE id=? AND id IN (SELECT id FROM repair_chain)`).bind(parentId,childId).first();
    },
    async findByCredential(id, hash) {
      // A legacy repair number is only an alias; the credential selects its owner
      // even when the same text is another appointment's historical primary key.
      return fromRow(
        await db
          .prepare(`${select} WHERE (id=? OR repair_number=?) AND access_token_hash=?`)
          .bind(id, id, hash)
          .first()
      );
    },
    async rotateCredential(item, hash, actor, reason, instant) {
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO credential_recoveries(id,appointment_id,actor,reason,created_at)
          SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM appointments WHERE id=? AND revision=?)`
          )
          .bind(crypto.randomUUID(), item.id, actor, reason, instant, item.id, item.revision),
        db
          .prepare(
            'UPDATE appointments SET access_token_hash=?,credential_rotated_at=?,revision=revision+1 WHERE id=? AND revision=? RETURNING id'
          )
          .bind(hash, instant, item.id, item.revision)
      ]);
      return results.at(-1).results.length > 0;
    },
    list(query, scope) {
      return listAppointments(db, select, fromRow, query, scope);
    },
    searchStudentId(studentId, scope) {
      return listStudentMatches(db, studentId, scope);
    },
    contactCandidates(query, scope, cursor, token) {
      return listContactCandidates(db, contactSelect, fromRow, query, scope, cursor, token);
    },
    async indexContacts(rows) {
      if (!rows.length) return;
      const input = JSON.stringify(rows);
      await db.batch([
        db.prepare(`DELETE FROM appointment_contact_index_tokens WHERE appointment_id IN (
          SELECT p.appointment_id FROM json_each(?) e JOIN appointment_contact_index_pending p
            ON p.appointment_id=json_extract(e.value,'$.id')
            AND p.generation=json_extract(e.value,'$.generation'))`).bind(input),
        db.prepare(`INSERT INTO appointment_contact_index_tokens(appointment_id,token)
          SELECT p.appointment_id,t.value FROM json_each(?) e JOIN appointment_contact_index_pending p
            ON p.appointment_id=json_extract(e.value,'$.id')
            AND p.generation=json_extract(e.value,'$.generation')
          JOIN json_each(e.value,'$.tokens') t`).bind(input),
        db.prepare(`DELETE FROM appointment_contact_index_pending WHERE appointment_id IN (
          SELECT p.appointment_id FROM json_each(?) e JOIN appointment_contact_index_pending p
            ON p.appointment_id=json_extract(e.value,'$.id')
            AND p.generation=json_extract(e.value,'$.generation'))`).bind(input)
      ]);
    },
    async overview(start, end, campuses) {
      const scope = campuses.length ? `campus IN (${campuses.map(() => '?').join(',')})` : '0';
      const [totals, capacities] = await db.batch([
        db
          .prepare(
            `SELECT campus,date,time_slot,COUNT(*) AS occupied,
          COUNT(CASE WHEN status='booked' THEN 1 END) AS booked,
          COUNT(CASE WHEN status='in_progress' THEN 1 END) AS in_progress
        FROM appointments WHERE ${scope} AND date>=? AND date<=? AND source='booking'
          AND status<>'cancelled' GROUP BY campus,date,time_slot`
          )
          .bind(...campuses, start, end),
        scheduleStatement(db, start, end, campuses)
      ]);
      return { totals: totals.results, capacities: capacities.results };
    },
    async create(item, request, onsite) {
      const suffix = `${item.campus === '浑南' ? '1' : '0'}${item.date.replaceAll('-', '')}-`;
      const prefix = `reserve${suffix}`;
      // One D1 statement allocates the ID and runs capacity/uniqueness constraints atomically.
      // Include historical booking prefixes so their suffixes are never reused.
      const values = Object.keys(writeColumns).map((key) =>
        key === 'locationSnapshot'
          ? "COALESCE((SELECT location FROM service_locations WHERE campus=? AND date=?),'')"
          : key === 'locationRevision'
            ? '(SELECT revision FROM service_locations WHERE campus=? AND date=?)'
            : '?'
      );
      const args = Object.keys(writeColumns).flatMap((key) =>
        ['locationSnapshot', 'locationRevision'].includes(key)
          ? [item.campus, item.date]
          : [
              key === 'bookingNotices' ? item[key] || '[]' : key === 'assignedTo'
                ? item[key] || null
                : key === 'source'
                  ? item[key] || 'booking'
                    : ['email', 'contactType', 'contactValue'].includes(key)
                      ? item[key] || ''
                      : (item[key] ?? null)
            ]
      );
      const insert = db
        .prepare(
          `INSERT INTO appointments(id,${Object.values(writeColumns).join(',')},access_token_hash,credential_rotated_at)
        SELECT ? || printf('%02d',COALESCE(MAX(CAST(substr(id,instr(id,'-')+1) AS INTEGER)),0)+1),${values.join(',')},?,?
        FROM appointments WHERE id LIKE ? OR id LIKE ? OR id LIKE ?
        HAVING 1 ${request ? 'AND NOT EXISTS(SELECT 1 FROM booking_requests WHERE request_key=?)' : ''}
        ${onsite ? `AND EXISTS(SELECT 1 FROM staff_accounts s JOIN members m ON m.id=s.member_id JOIN staff_access_campuses g ON g.account=s.account
         WHERE s.account=? AND s.auth_version=? AND s.status='enabled' AND m.status='active' AND g.campus=?)` : ''}
        ON CONFLICT(registered_by,registration_key) DO UPDATE SET registration_key=excluded.registration_key RETURNING *`
        )
        .bind(
          prefix,
          ...args,
          item.accessTokenHash,
          item.credentialRotatedAt,
          `${prefix}%`,
          `reverse${suffix}%`,
          `${suffix}%`,
          ...(request ? [request.key] : []),
          ...(onsite ? [onsite.actor,onsite.authVersion,item.campus] : [])
        );
      if (!request) return fromRow(await insert.first());
      const results = await db.batch([
        insert,
        db
          .prepare(
            `INSERT INTO booking_requests(request_key,digest,appointment_id,encrypted_token,created_at)
        SELECT ?,?,id,?,? FROM appointments WHERE access_token_hash=? ON CONFLICT(request_key) DO NOTHING`
          )
          .bind(
            request.key,
            request.digest,
            request.encryptedToken,
            item.createdAt,
            item.accessTokenHash
          )
      ]);
      return fromRow(results[0].results[0]);
    },
    async update(item,patch,correction,workflow) {
      const writable=['name','faultType','issue','phone','social','email','contactType','contactValue','status','assignedTo','repairNote','outcome','startedAt','completedAt','frontPhotoId','backPhotoId','receivedAt','receivedBy','photoDeferredBy','brand','deviceModel','warranty','liquidMetal','parentAppointmentId','linkKind','linkedBy','linkedAt'];
      const keys=writable.filter(key=>patch[key]!==undefined);
      if (!keys.length) return null;
      const guard=workflow ? ` AND EXISTS(SELECT 1 FROM staff_accounts sa JOIN members m ON m.id=sa.member_id
        WHERE sa.account=? AND sa.auth_version=? AND sa.status='enabled' AND m.status='active')
        AND EXISTS(SELECT 1 FROM staff_access_campuses g WHERE g.account=? AND g.campus=appointments.campus)` : '';
      const statement=db.prepare(`UPDATE appointments SET ${keys.map(key=>columns[key]+'=?').join(',')},revision=revision+1
        WHERE id=? AND revision=?${guard} RETURNING *`)
        .bind(...keys.map(key=>patch[key]),item.id,item.revision,...(workflow ? [workflow.actor.account,workflow.actor.authVersion,workflow.actor.account] : []));
      if (!workflow) return fromRow(await statement.first());
      const auditId=crypto.randomUUID();
      const snapshot=(value,before=false)=>JSON.stringify(Object.fromEntries(['revision',...writable]
        .filter(key=>!['phone','social','email','contactValue'].includes(key) || Object.hasOwn(patch,key))
        .map(key=>[key,before && Object.hasOwn(workflow.contactBefore || {},key) ? workflow.contactBefore[key] : value[key]])));
      const statements=[statement,db.prepare(`INSERT INTO audit_events(id,actor_member_id,actor_account,action,source_ref,before_json,after_json,reason,request_id,occurred_at)
        SELECT ?,?,?,?,?,?,?,?,?,? WHERE changes()>0`).bind(auditId,workflow.actor.memberId,workflow.actor.account,workflow.action,
          JSON.stringify({module:'repairs',type:'appointment',id:item.id}),snapshot(item,true),snapshot({...item,...patch,revision:item.revision+1}),workflow.reason || '',workflow.requestId,workflow.at)];
      if (patch.receivedAt && patch.frontPhotoId && patch.backPhotoId) statements.push(db.prepare(`INSERT INTO repair_intake_records(id,appointment_id,member_id,account,front_photo_id,back_photo_id,verified_at,verification_json)
        SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM audit_events WHERE id=?)`).bind('intake-'+auditId,item.id,workflow.actor.memberId,workflow.actor.account,patch.frontPhotoId,patch.backPhotoId,workflow.at,JSON.stringify(workflow.verification || {}),auditId));
      statements.push(db.prepare(`INSERT INTO operation_receipts(actor_member_id,action,request_id,payload_hash,resource_ref,result_json,result_status,created_at)
        SELECT ?,?,?,?,?,'{}','success',? WHERE EXISTS(SELECT 1 FROM audit_events WHERE id=?)`).bind(workflow.actor.memberId,workflow.action,workflow.requestId,workflow.payloadHash,JSON.stringify({module:'repairs',type:'appointment',id:item.id}),workflow.at,auditId));
      const result=await db.batch(statements);
      return result[0].results.length ? this.find(item.id) : null;
    },
    async exportPage(cursor, limit, campuses) {
      const campusScope = campuses.length
        ? `campus IN (${campuses.map(() => '?').join(',')})`
        : '0';
      const where = campusScope + (cursor ? ' AND (created_at<? OR (created_at=? AND id<?))' : '');
      const args = [
        ...campuses,
        ...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []),
        limit
      ];
      return (
        await db
          .prepare(`${select} WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ?`)
          .bind(...args)
          .all()
      ).results.map(fromRow);
    }
  };
}
