import { listAppointments } from './appointment-list.js';
import { serviceDayRepository } from './service-days.js';
import { APPOINTMENT_SEARCH_LIMIT } from '../../shared/appointment-search.js';
import { DEFAULT_SERVICE_LOCATIONS, terminalStatuses } from '../../shared/constants.js';
import { scheduleStatement } from './slot-capacities.js';

const columns = {
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
  registrationFlow: 'registration_flow',
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
const select = `SELECT appointments.*,(SELECT paused FROM service_day_overrides s JOIN campuses c ON c.id=s.campus_id WHERE s.business_date=appointments.date AND c.name=appointments.campus) AS service_paused,${assigneeName},${memberIdentity} FROM appointments`;
const memberAccounts =
  '(SELECT account FROM staff_accounts WHERE member_id=(SELECT member_id FROM staff_accounts WHERE account=?))';
function fromRow(row) {
  return row
    ? {
        id: row.id,
        servicePaused: !!row.service_paused,
        revision: row.revision,
        assignedToName: row.assigned_to_name || '',
        assignedMemberId: row.assigned_member_id || '',
        registeredMemberId: row.registered_member_id || '',
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
  const writeColumns = { ...columns };
  return {
    ...serviceDayRepository(db),
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
    async currentRepair(account) {
      const row = await db
        .prepare(
          `${select} WHERE id IN (SELECT appointment_id FROM active_repairs
        WHERE account IN ${memberAccounts}) AND status='in_progress' LIMIT 1`
        )
        .bind(account)
        .first();
      return fromRow(row);
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
    async pendingRegistration(account) {
      return fromRow(
        await db
          .prepare(
            `${select} WHERE registered_by IN ${memberAccounts} AND source='onsite' AND registration_flow<>'frontdesk' AND status='booked' ORDER BY created_at DESC,id DESC LIMIT 1`
          )
          .bind(account)
          .first()
      );
    },
    async intakePhotos(id, account, front, back, now) {
      if (!front || !back || front === back) return false;
      const row = await db
        .prepare(
          `SELECT COUNT(*) AS total FROM appointment_attachments
        WHERE appointment_id=? AND uploaded_by=? AND expires_at>? AND mime_type LIKE 'image/%'
        AND created_at>=COALESCE((SELECT MAX(created_at) FROM appointment_corrections
          WHERE appointment_id=? AND json_extract(after_state,'$.status')='booked'),'')
        AND ((id=? AND purpose='intake_front') OR (id=? AND purpose='intake_back'))`
        )
        .bind(id, account, now, id, front, back)
        .first();
      return row.total === 2;
    },
    async countExpirations(instant) {
      return (
        await db
          .prepare(
            "SELECT COUNT(*) AS total FROM appointments WHERE status='booked' AND started_at IS NULL AND expires_at<=?"
          )
          .bind(instant)
          .first()
      ).total;
    },
    async expirePending(instant, { id, campuses } = {}) {
      const where = ["status='booked'", 'started_at IS NULL', 'expires_at<=?'],
        args = [instant, instant];
      if (id) {
        where.push('id=?');
        args.push(id);
      }
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
    async create(item, request) {
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
              key === 'assignedTo'
                ? item[key] || null
                : key === 'source'
                  ? item[key] || 'booking'
                  : key === 'registrationFlow'
                    ? item[key] || 'technician_intake'
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
        ${request ? 'HAVING NOT EXISTS(SELECT 1 FROM booking_requests WHERE request_key=?)' : ''}
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
          ...(request ? [request.key] : [])
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
    async update(item, patch, correction, workflow) {
      const fields = [],
        args = [];
      for (const [key, column] of Object.entries({
        status: 'status',
        assignedTo: 'assigned_to',
        repairNote: 'repair_note',
        outcome: 'outcome',
        startedAt: 'started_at',
        completedAt: 'completed_at',
        expiresAt: 'expires_at',
        frontPhotoId: 'front_photo_id',
        backPhotoId: 'back_photo_id'
      })) {
        if (patch[key] !== undefined) {
          fields.push(`${column}=?`);
          args.push(key === 'assignedTo' ? patch[key] || null : patch[key]);
        }
      }
      let guard = '';
      const guardArgs = [];
      if (workflow?.eligibility) {
        const { context, event } = workflow.eligibility;
        guard += ` AND EXISTS(SELECT 1 FROM staff_presence WHERE member_id=? AND business_date=? AND campus_id=? AND state='available' AND revision=?)
          AND EXISTS(SELECT 1 FROM attendance_events WHERE id=? AND julianday(starts_at)<=julianday(?) AND julianday(ends_at)>=julianday(?))`;
        guardArgs.push(
          context.actor.memberId,
          context.businessDate,
          context.presence.campusId,
          context.presence.revision,
          event.id,
          workflow.at,
          workflow.at
        );
        guard += ` AND EXISTS(SELECT 1 FROM staff_accounts sa JOIN members m ON m.id=sa.member_id WHERE sa.account=? AND sa.auth_version=? AND sa.status='enabled' AND m.status='active')`;
        guardArgs.push(context.actor.account, context.authVersion);
      }
      if (workflow?.actor) {
        guard += ` AND EXISTS(SELECT 1 FROM staff_accounts sa JOIN members m ON m.id=sa.member_id WHERE sa.account=? AND sa.auth_version=? AND sa.status='enabled' AND m.status='active')`;
        guardArgs.push(workflow.actor.account, workflow.actor.authVersion ?? 0);
      }
      const update = db
        .prepare(
          `UPDATE appointments SET ${fields.join(',')},revision=revision+1 WHERE id=? AND revision=?${guard} RETURNING *,${assigneeName},${memberIdentity}`
        )
        .bind(...args, item.id, item.revision, ...guardArgs);
      const start =
        patch.status === 'in_progress' &&
        patch.frontPhotoId &&
        patch.backPhotoId &&
        patch.assignedTo;
      if (!correction && !start && !workflow) return fromRow(await update.first());
      const intake = start
        ? db
            .prepare(
              `INSERT INTO repair_intake_records(id,appointment_id,member_id,account,front_photo_id,back_photo_id,verified_at)
        SELECT ?,?,(SELECT member_id FROM staff_accounts WHERE account=?),?,?,?,? WHERE changes()>0`
            )
            .bind(
              `intake-${item.id}-${item.revision + 1}`,
              item.id,
              patch.assignedTo,
              patch.assignedTo,
              patch.frontPhotoId,
              patch.backPhotoId,
              patch.startedAt || new Date().toISOString()
            )
        : null;
      if (start && !correction && !workflow) {
        const results = await db.batch([update, intake]);
        return fromRow(results[0].results[0]);
      }
      const snapshot = (value) =>
        JSON.stringify(
          Object.fromEntries(
            [
              'revision',
              'status',
              'outcome',
              'assignedTo',
              'repairNote',
              'startedAt',
              'completedAt',
              'expiresAt',
              'frontPhotoId',
              'backPhotoId'
            ].map((key) => [key, value[key]])
          )
        );
      const correctionId = correction?.id || crypto.randomUUID();
      const correctionStatement = correction
        ? db
            .prepare(
              `INSERT INTO appointment_corrections(id,appointment_id,actor,reason,before_state,after_state,created_at)
        SELECT ?,?,?,?,?,?,? WHERE changes()>0`
            )
            .bind(
              correctionId,
              item.id,
              correction.actor,
              correction.reason,
              snapshot(item),
              snapshot({ ...item, ...patch, revision: item.revision + 1 }),
              correction.instant
            )
        : null;
      if (workflow) {
        // The appointment write, correction snapshot, audit event, intake record,
        // and idempotency receipt are one D1 batch.  A trigger or constraint on
        // any later statement therefore rolls the appointment update back too.
        const auditId = workflow.auditId || crypto.randomUUID();
        const statements = [update];
        if (correctionStatement) statements.push(correctionStatement);
        statements.push(
          db
            .prepare(
              `INSERT INTO audit_events(id,actor_member_id,actor_account,action,action_version,source_ref,before_json,after_json,reason,request_id,request_trace_id,occurred_at)
          SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE changes()>0`
            )
            .bind(
              auditId,
              workflow.actor.memberId,
              workflow.actor.account,
              workflow.action,
              workflow.actionVersion || '1',
              JSON.stringify({ module: 'repairs', type: 'appointment', id: item.id }),
              JSON.stringify({ status: item.status, assignedTo: item.assignedTo }),
              JSON.stringify({
                status: patch.status || item.status,
                assignedTo: patch.assignedTo || item.assignedTo,
                revision: item.revision + 1,
                ...(workflow.eligibility?.context
                  ? {
                      assigneeIdentity: {
                        memberId: workflow.eligibility.context.actor.memberId,
                        name: workflow.eligibility.context.actor.name,
                        identities: workflow.eligibility.context.identities || []
                      }
                    }
                  : {})
              }),
              workflow.reason || '',
              workflow.requestId || null,
              workflow.requestTraceId || null,
              workflow.at
            )
        );
        if (start && !correction)
          statements.push(
            db
              .prepare(
                `INSERT INTO repair_intake_records(id,appointment_id,member_id,account,front_photo_id,back_photo_id,verified_at,verification_json)
          SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM audit_events WHERE id=?)`
              )
              .bind(
                `intake-${item.id}-${item.revision + 1}`,
                item.id,
                workflow.actor.memberId,
                patch.assignedTo,
                patch.frontPhotoId,
                patch.backPhotoId,
                workflow.at,
                JSON.stringify(workflow.verification),
                auditId
              )
          );
        if (!correction)
          statements.push(
            db
              .prepare(
                `INSERT INTO operation_receipts(actor_member_id,action,request_id,payload_hash,resource_ref,result_json,result_status,created_at)
          SELECT ?,?,?,?,?,'{}','success',? WHERE EXISTS(SELECT 1 FROM audit_events WHERE id=?)`
              )
              .bind(
                workflow.actor.memberId,
                workflow.action,
                workflow.requestId,
                workflow.payloadHash,
                JSON.stringify({ module: 'repairs', type: 'appointment', id: item.id }),
                workflow.at,
                auditId
              )
          );
        const result = await db.batch(statements);
        return fromRow(result[0].results[0]);
      }
      const statements = [update];
      if (correctionStatement) statements.push(correctionStatement);
      const results = await db.batch(statements);
      return fromRow(results[0].results[0]);
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
