-- Deterministic keyed tokens are populated by the Worker after authorization.
-- Historical rows stay untouched and are indexed when an authorized lookup reads them.
CREATE TABLE appointment_contact_index_pending (
  appointment_id TEXT PRIMARY KEY REFERENCES appointments(id) ON UPDATE CASCADE ON DELETE CASCADE,
  generation INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE appointment_contact_index_tokens (
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON UPDATE CASCADE ON DELETE CASCADE,
  token TEXT NOT NULL,
  PRIMARY KEY (appointment_id, token)
);
CREATE INDEX idx_appointment_contact_token ON appointment_contact_index_tokens(token, appointment_id);
INSERT INTO appointment_contact_index_pending(appointment_id,generation)
SELECT id,0 FROM appointments;
CREATE TRIGGER appointment_contact_index_insert AFTER INSERT ON appointments
BEGIN
  INSERT INTO appointment_contact_index_pending(appointment_id,generation) VALUES(NEW.id,0)
    ON CONFLICT(appointment_id) DO UPDATE SET generation=generation+1;
END;
CREATE TRIGGER appointment_contact_index_update AFTER UPDATE OF phone,email,contact_value,social ON appointments
BEGIN
  INSERT INTO appointment_contact_index_pending(appointment_id,generation) VALUES(NEW.id,1)
    ON CONFLICT(appointment_id) DO UPDATE SET generation=generation+1;
END;

-- Exchange workers can read their own assigned customer's identity and contact
-- just like ordinary technicians; no campus-wide contact grant is added.
INSERT OR IGNORE INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec)
VALUES
  ('grant-exchange-own-identity','role-exchange','customer.identity.read','{"self":true}','[{"code":"ownResource","version":1}]'),
  ('grant-exchange-own-contact','role-exchange','customer.contact.read','{"self":true}','[{"code":"ownResource","version":1}]');

-- v1.2 direct repair cutover. Rebuild constrained tables with all dependent rows.
-- The complete old reception/dispatch/ticket facts are archived before removing runtime state.

INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at) SELECT 'v12-repair_receptions-'||appointment_id,'repairs.workflow.archived',json_object('module','repairs','type','repair_receptions','id',appointment_id),json_object('appointment_id',appointment_id,'state',state,'received_at',received_at,'received_by',received_by,'assigned_to',assigned_to,'assigned_member_id',assigned_member_id,'updated_at',updated_at,'ticket_id',ticket_id,'left_at',left_at),'移除排队和人员占用；原事实完整保存',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM repair_receptions;

INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at) SELECT 'v12-repair_queue_tickets-'||id,'repairs.workflow.archived',json_object('module','repairs','type','repair_queue_tickets','id',id),json_object('id',id,'appointment_id',appointment_id,'campus',campus,'queue_date',queue_date,'number',number,'created_at',created_at),'移除排队和人员占用；原事实完整保存',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM repair_queue_tickets;

INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at) SELECT 'v12-active_repairs-'||appointment_id,'repairs.workflow.archived',json_object('module','repairs','type','active_repairs','id',appointment_id),json_object('account',account,'appointment_id',appointment_id,'member_id',member_id),'移除排队和人员占用；原事实完整保存',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM active_repairs;

INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at) SELECT 'v12-repair_queue_counters-'||campus||'-'||queue_date,'repairs.workflow.archived',json_object('module','repairs','type','repair_queue_counters','id',campus||'-'||queue_date),json_object('campus',campus,'queue_date',queue_date,'last_number',last_number),'移除排队和人员占用；原事实完整保存',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM repair_queue_counters;

DROP TRIGGER "attachment_storage_release";

DROP TRIGGER "appointment_active_insert";

DROP TRIGGER "appointment_active_update";

DROP TRIGGER "appointment_active_delete";

DROP TRIGGER "appointment_capacity_insert";

DROP TRIGGER "active_repair_member_sync";

DROP TRIGGER "location_keep_booked";

DROP TRIGGER "location_keep_booked_delete";

DROP TRIGGER "appointment_location_insert";

DROP TRIGGER "appointment_new_slot_deadline";

DROP TRIGGER "appointment_student_day_insert";

DROP TRIGGER "appointment_student_day_update";

DROP TRIGGER "appointment_capacity_update";

DROP TRIGGER "field_presence_busy_guard";

DROP TRIGGER "service_day_booking_insert";

DROP TRIGGER "service_day_booking_restore";

DROP TRIGGER "service_day_repair_start";

DROP TRIGGER "appointment_booking_notices";

DROP TRIGGER "appointment_new_expiration_deadline";

DROP TRIGGER "repair_followup_completed_parent_insert";

DROP TRIGGER "repair_followup_schedule_guard";

DROP TRIGGER "reception_assignment_insert";

DROP TRIGGER "reception_assignment_update";

DROP TRIGGER "reception_arrival_guard";

DROP TRIGGER "reception_start_guard";

DROP TRIGGER "reception_presence_guard";

DROP TRIGGER "reception_status_sync";

DROP TRIGGER "appointment_contact_index_insert";

DROP TRIGGER "appointment_contact_index_update";

CREATE TABLE "appointments_v12" (
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL, name TEXT NOT NULL,
  college TEXT NOT NULL DEFAULT '', campus TEXT NOT NULL CHECK(campus IN ('南湖','浑南')),
  phone TEXT NOT NULL DEFAULT '', social TEXT NOT NULL,
  device_type TEXT NOT NULL, brand TEXT NOT NULL, device_model TEXT NOT NULL,
  serial TEXT NOT NULL DEFAULT '', warranty TEXT NOT NULL, fault_type TEXT NOT NULL,
  issue TEXT NOT NULL DEFAULT '', liquid_drop TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL, time_slot TEXT NOT NULL CHECK(time_slot IN ('19:00–20:00','20:00–21:00','19:00–19:30','19:30–20:00','20:00–20:30','20:30–21:00')),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('booked','in_progress','completed','cancelled','expired')),
  outcome TEXT CHECK(outcome IN ('repaired','partially_repaired','unrepaired','not_needed','legacy_unrepaired','legacy_unknown')),
  started_at TEXT, completed_at TEXT,
  expires_at TEXT NOT NULL CHECK(length(expires_at)=24 AND substr(expires_at,24,1)='Z' AND julianday(expires_at) IS NOT NULL),
  assigned_to TEXT REFERENCES staff_accounts(account), repair_note TEXT NOT NULL DEFAULT '',
  access_token_hash TEXT NOT NULL UNIQUE CHECK(length(access_token_hash)=64),
  credential_rotated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  agreement_at TEXT NOT NULL, agreement_version TEXT NOT NULL, signature TEXT NOT NULL DEFAULT '', repair_number TEXT, front_photo_id TEXT, back_photo_id TEXT, source TEXT NOT NULL DEFAULT 'booking' CHECK(source IN ('booking','onsite')), registered_by TEXT REFERENCES staff_accounts(account), registration_key TEXT, email TEXT NOT NULL DEFAULT '', contact_type TEXT NOT NULL DEFAULT '', contact_value TEXT NOT NULL DEFAULT '', liquid_metal TEXT, dell_g15 TEXT, location_snapshot TEXT NOT NULL DEFAULT '', location_revision INTEGER, registration_flow TEXT NOT NULL DEFAULT 'technician_intake', booking_notices TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(booking_notices) AND json_type(booking_notices)='array'),
  received_at TEXT, received_by TEXT REFERENCES staff_accounts(account), photo_deferred_by TEXT REFERENCES staff_accounts(account),
  CHECK((status='completed' AND outcome IS NOT NULL) OR (status<>'completed' AND outcome IS NULL))
);

INSERT INTO "appointments_v12"(id,student_id,name,college,campus,phone,social,device_type,brand,device_model,serial,warranty,fault_type,issue,liquid_drop,date,time_slot,note,status,outcome,started_at,completed_at,expires_at,assigned_to,repair_note,access_token_hash,credential_rotated_at,revision,created_at,agreement_at,agreement_version,signature,repair_number,front_photo_id,back_photo_id,source,registered_by,registration_key,email,contact_type,contact_value,liquid_metal,dell_g15,location_snapshot,location_revision,registration_flow,booking_notices) SELECT id,student_id,name,college,campus,phone,social,device_type,brand,device_model,serial,warranty,fault_type,issue,liquid_drop,date,time_slot,note,status,CASE WHEN outcome='unrepaired' THEN 'legacy_unrepaired' ELSE outcome END,started_at,completed_at,expires_at,assigned_to,repair_note,access_token_hash,credential_rotated_at,revision,created_at,agreement_at,agreement_version,signature,repair_number,front_photo_id,back_photo_id,source,registered_by,registration_key,email,contact_type,contact_value,liquid_metal,dell_g15,location_snapshot,location_revision,registration_flow,booking_notices FROM "appointments";

UPDATE appointments_v12 SET
received_at=COALESCE((SELECT received_at FROM repair_receptions r WHERE r.appointment_id=appointments_v12.id AND r.state IN ('queued','assigned','started')),(SELECT MIN(verified_at) FROM repair_intake_records i WHERE i.appointment_id=appointments_v12.id)),
received_by=COALESCE((SELECT received_by FROM repair_receptions r WHERE r.appointment_id=appointments_v12.id AND r.state IN ('queued','assigned','started')),(SELECT account FROM repair_intake_records i WHERE i.appointment_id=appointments_v12.id ORDER BY verified_at,id LIMIT 1));

CREATE TABLE "appointment_attachments_v12" (
  id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL REFERENCES "appointments_v12"(id),
  filename TEXT NOT NULL, mime_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size>0 AND size<=5242880),
  object_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
, purpose TEXT NOT NULL DEFAULT 'general', uploaded_by TEXT);

INSERT INTO "appointment_attachments_v12"(id,appointment_id,filename,mime_type,size,object_key,created_at,expires_at,purpose,uploaded_by) SELECT id,appointment_id,filename,mime_type,size,object_key,created_at,expires_at,purpose,uploaded_by FROM "appointment_attachments";

CREATE TABLE "appointment_contact_index_pending_v12" (
  appointment_id TEXT PRIMARY KEY REFERENCES "appointments_v12"(id) ON UPDATE CASCADE ON DELETE CASCADE,
  generation INTEGER NOT NULL DEFAULT 0
);

INSERT INTO "appointment_contact_index_pending_v12"(appointment_id,generation) SELECT appointment_id,generation FROM "appointment_contact_index_pending";

CREATE TABLE "appointment_contact_index_tokens_v12" (
  appointment_id TEXT NOT NULL REFERENCES "appointments_v12"(id) ON UPDATE CASCADE ON DELETE CASCADE,
  token TEXT NOT NULL,
  PRIMARY KEY (appointment_id, token)
);

INSERT INTO "appointment_contact_index_tokens_v12"(appointment_id,token) SELECT appointment_id,token FROM "appointment_contact_index_tokens";

CREATE TABLE "appointment_corrections_v12" (
  id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL REFERENCES "appointments_v12"(id),
  actor TEXT NOT NULL REFERENCES staff_accounts(account),
  reason TEXT NOT NULL CHECK(length(reason)<=300),
  before_state TEXT NOT NULL, after_state TEXT NOT NULL, created_at TEXT NOT NULL
);

INSERT INTO "appointment_corrections_v12"(id,appointment_id,actor,reason,before_state,after_state,created_at) SELECT id,appointment_id,actor,reason,before_state,after_state,created_at FROM "appointment_corrections";

CREATE TABLE "booking_requests_v12" (
  request_key TEXT PRIMARY KEY CHECK(length(request_key)=43),
  digest TEXT NOT NULL CHECK(length(digest)=64),
  appointment_id TEXT NOT NULL UNIQUE REFERENCES "appointments_v12"(id) ON UPDATE CASCADE,
  encrypted_token TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO "booking_requests_v12"(request_key,digest,appointment_id,encrypted_token,created_at) SELECT request_key,digest,appointment_id,encrypted_token,created_at FROM "booking_requests";

CREATE TABLE "credential_recoveries_v12" (
  id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL REFERENCES "appointments_v12"(id),
  actor TEXT NOT NULL REFERENCES staff_accounts(account), reason TEXT NOT NULL, created_at TEXT NOT NULL
);

INSERT INTO "credential_recoveries_v12"(id,appointment_id,actor,reason,created_at) SELECT id,appointment_id,actor,reason,created_at FROM "credential_recoveries";

CREATE TABLE "repair_followups_v12" (
  id TEXT PRIMARY KEY,
  parent_appointment_id TEXT NOT NULL REFERENCES "appointments_v12"(id),
  status TEXT NOT NULL CHECK(status IN ('pending','scheduled','rejected')),
  request_source TEXT NOT NULL DEFAULT 'customer' CHECK(request_source IN ('customer','staff')),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 2 AND 3000),
  request_id TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
  requested_by TEXT REFERENCES staff_accounts(account),
  requested_at TEXT NOT NULL,
  scheduled_appointment_id TEXT UNIQUE REFERENCES "appointments_v12"(id),
  scheduled_by TEXT REFERENCES staff_accounts(account),
  scheduled_at TEXT,
  resolved_by TEXT REFERENCES staff_accounts(account),
  resolved_at TEXT,
  resolution_note TEXT NOT NULL DEFAULT '',
  decision_request_id TEXT UNIQUE,
  decision_hash TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  CHECK((request_source='customer' AND requested_by IS NULL) OR (request_source='staff' AND requested_by IS NOT NULL)),
  CHECK((status='pending' AND scheduled_appointment_id IS NULL AND scheduled_by IS NULL AND scheduled_at IS NULL AND resolved_by IS NULL AND resolved_at IS NULL)
     OR (status='scheduled' AND scheduled_appointment_id IS NOT NULL AND scheduled_by IS NOT NULL AND scheduled_at IS NOT NULL AND resolved_by=scheduled_by AND resolved_at=scheduled_at)
     OR (status='rejected' AND scheduled_appointment_id IS NULL AND scheduled_by IS NULL AND scheduled_at IS NULL AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)),
  CHECK((decision_request_id IS NULL AND decision_hash IS NULL) OR (decision_request_id IS NOT NULL AND length(decision_hash)=64))
);

INSERT INTO "repair_followups_v12"(id,parent_appointment_id,status,request_source,reason,request_id,request_hash,requested_by,requested_at,scheduled_appointment_id,scheduled_by,scheduled_at,resolved_by,resolved_at,resolution_note,decision_request_id,decision_hash,revision) SELECT id,parent_appointment_id,status,request_source,reason,request_id,request_hash,requested_by,requested_at,scheduled_appointment_id,scheduled_by,scheduled_at,resolved_by,resolved_at,resolution_note,decision_request_id,decision_hash,revision FROM "repair_followups";

CREATE TABLE "repair_intake_records_v12" (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES "appointments_v12"(id) ON DELETE CASCADE,
  member_id TEXT REFERENCES members(id),
  account TEXT NOT NULL REFERENCES staff_accounts(account),
  front_photo_id TEXT NOT NULL,
  back_photo_id TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0
, verification_json TEXT);

INSERT INTO "repair_intake_records_v12"(id,appointment_id,member_id,account,front_photo_id,back_photo_id,verified_at,revision,verification_json) SELECT id,appointment_id,member_id,account,front_photo_id,back_photo_id,verified_at,revision,verification_json FROM "repair_intake_records";

CREATE TABLE _v12_integrity(valid INTEGER NOT NULL CHECK(valid=1));

INSERT INTO _v12_integrity SELECT (SELECT COUNT(*) FROM "appointments")=(SELECT COUNT(*) FROM "appointments_v12");

INSERT INTO _v12_integrity SELECT (SELECT COUNT(*) FROM "appointment_attachments")=(SELECT COUNT(*) FROM "appointment_attachments_v12");

INSERT INTO _v12_integrity SELECT (SELECT COUNT(*) FROM "appointment_contact_index_pending")=(SELECT COUNT(*) FROM "appointment_contact_index_pending_v12");

INSERT INTO _v12_integrity SELECT (SELECT COUNT(*) FROM "appointment_contact_index_tokens")=(SELECT COUNT(*) FROM "appointment_contact_index_tokens_v12");

INSERT INTO _v12_integrity SELECT (SELECT COUNT(*) FROM "appointment_corrections")=(SELECT COUNT(*) FROM "appointment_corrections_v12");

INSERT INTO _v12_integrity SELECT (SELECT COUNT(*) FROM "booking_requests")=(SELECT COUNT(*) FROM "booking_requests_v12");

INSERT INTO _v12_integrity SELECT (SELECT COUNT(*) FROM "credential_recoveries")=(SELECT COUNT(*) FROM "credential_recoveries_v12");

INSERT INTO _v12_integrity SELECT (SELECT COUNT(*) FROM "repair_followups")=(SELECT COUNT(*) FROM "repair_followups_v12");

INSERT INTO _v12_integrity SELECT (SELECT COUNT(*) FROM "repair_intake_records")=(SELECT COUNT(*) FROM "repair_intake_records_v12");

DROP TABLE "repair_receptions";

DROP TABLE "repair_queue_tickets";

DROP TABLE "repair_queue_counters";

DROP TABLE "active_repairs";

DROP TABLE "repair_intake_records";

DROP TABLE "repair_followups";

DROP TABLE "credential_recoveries";

DROP TABLE "booking_requests";

DROP TABLE "appointment_corrections";

DROP TABLE "appointment_contact_index_tokens";

DROP TABLE "appointment_contact_index_pending";

DROP TABLE "appointment_attachments";

DROP TABLE "appointments";

ALTER TABLE "appointments_v12" RENAME TO "appointments";

ALTER TABLE "appointment_attachments_v12" RENAME TO "appointment_attachments";

ALTER TABLE "appointment_contact_index_pending_v12" RENAME TO "appointment_contact_index_pending";

ALTER TABLE "appointment_contact_index_tokens_v12" RENAME TO "appointment_contact_index_tokens";

ALTER TABLE "appointment_corrections_v12" RENAME TO "appointment_corrections";

ALTER TABLE "booking_requests_v12" RENAME TO "booking_requests";

ALTER TABLE "credential_recoveries_v12" RENAME TO "credential_recoveries";

ALTER TABLE "repair_followups_v12" RENAME TO "repair_followups";

ALTER TABLE "repair_intake_records_v12" RENAME TO "repair_intake_records";

CREATE INDEX idx_correction_appointment ON appointment_corrections(appointment_id,created_at,id);

CREATE INDEX idx_active_queue ON appointments(date,campus,time_slot,created_at,id) WHERE status IN ('booked','in_progress');

CREATE INDEX idx_appointments_created ON appointments(created_at DESC,id DESC);

CREATE INDEX idx_appointments_assigned ON appointments(assigned_to) WHERE assigned_to IS NOT NULL;

CREATE INDEX idx_appointments_status ON appointments(status,date);

CREATE INDEX idx_appointments_fault ON appointments(fault_type);

CREATE INDEX idx_attachment_appointment ON appointment_attachments(appointment_id,created_at);

CREATE INDEX idx_attachment_expiry ON appointment_attachments(expires_at,id);

CREATE INDEX idx_booked_expiry ON appointments(expires_at,id) WHERE status='booked' AND started_at IS NULL;

CREATE UNIQUE INDEX idx_repair_number ON appointments(repair_number);

CREATE UNIQUE INDEX idx_onsite_request ON appointments(registered_by,registration_key);

CREATE INDEX idx_repair_intake_appointment ON repair_intake_records(appointment_id,verified_at);

CREATE INDEX idx_online_student_day ON appointments(student_id,date) WHERE source='booking' AND status IN ('booked','in_progress','completed');

CREATE INDEX idx_appointments_campus_created ON appointments(campus,created_at DESC,id DESC);

CREATE INDEX idx_appointments_campus_facets ON appointments(campus,date,time_slot,status);

CREATE INDEX idx_repair_followups_parent ON repair_followups(parent_appointment_id,requested_at,id);

CREATE INDEX idx_repair_followups_pending ON repair_followups(status,requested_at,id) WHERE status='pending';

CREATE UNIQUE INDEX idx_repair_followups_one_pending_parent ON repair_followups(parent_appointment_id) WHERE status='pending';

CREATE INDEX idx_appointment_contact_token ON appointment_contact_index_tokens(token, appointment_id);

CREATE TRIGGER attachment_storage_release AFTER DELETE ON attachment_storage
BEGIN
  DELETE FROM appointment_attachments WHERE id=OLD.id;
  UPDATE storage_quota SET used_bytes=used_bytes-OLD.size WHERE id=1;
END;

CREATE TRIGGER appointment_capacity_insert BEFORE INSERT ON appointments
WHEN NEW.source='booking'
BEGIN
 INSERT INTO booking_day_slots(campus,date,time_slot,capacity)
 SELECT NEW.campus,NEW.date,time_slot,capacity FROM slot_capacities
 WHERE campus=NEW.campus AND NEW.time_slot IN ('19:00–20:00','20:00–21:00')
 AND NOT EXISTS(SELECT 1 FROM booking_day_slots WHERE campus=NEW.campus AND date=NEW.date);
 INSERT INTO booking_day_slots(campus,date,time_slot,capacity)
 SELECT NEW.campus,NEW.date,time_slot,capacity FROM weekday_slot_capacities
 WHERE campus=NEW.campus AND weekday=CAST(strftime('%w',NEW.date) AS INTEGER)
 AND NOT EXISTS(SELECT 1 FROM booking_day_slots WHERE campus=NEW.campus AND date=NEW.date);
 SELECT RAISE(ABORT,'SLOT_CHANGED') WHERE NOT EXISTS(
 SELECT 1 FROM booking_day_slots WHERE campus=NEW.campus AND date=NEW.date AND time_slot=NEW.time_slot);
 SELECT RAISE(ABORT,'SLOT_PAUSED') WHERE NEW.status<>'cancelled' AND
 (SELECT capacity FROM booking_day_slots WHERE campus=NEW.campus AND date=NEW.date AND time_slot=NEW.time_slot)=0;
 SELECT RAISE(ABORT,'SLOT_FULL') WHERE NEW.status<>'cancelled' AND
 (SELECT COUNT(*) FROM appointments WHERE source='booking' AND date=NEW.date AND campus=NEW.campus AND time_slot=NEW.time_slot
 AND status<>'cancelled') >=
 (SELECT capacity FROM booking_day_slots WHERE campus=NEW.campus AND date=NEW.date AND time_slot=NEW.time_slot);
END;

CREATE TRIGGER location_keep_booked BEFORE UPDATE OF location ON service_locations
WHEN trim(NEW.location)='' AND EXISTS(SELECT 1 FROM appointments WHERE source='booking' AND campus=NEW.campus AND date=NEW.date)
BEGIN
  SELECT RAISE(ABORT,'LOCATION_REQUIRED');
END;

CREATE TRIGGER location_keep_booked_delete BEFORE DELETE ON service_locations
WHEN EXISTS(SELECT 1 FROM appointments WHERE source='booking' AND campus=OLD.campus AND date=OLD.date)
BEGIN
  SELECT RAISE(ABORT,'LOCATION_REQUIRED');
END;

CREATE TRIGGER appointment_location_insert BEFORE INSERT ON appointments
WHEN NEW.source='booking'
BEGIN
  SELECT RAISE(ABORT,'LOCATION_MISSING') WHERE NOT EXISTS(
    SELECT 1 FROM service_locations WHERE campus=NEW.campus AND date=NEW.date AND trim(location)<>''
  );
END;

CREATE TRIGGER appointment_new_slot_deadline BEFORE INSERT ON appointments
WHEN NEW.source='booking'
BEGIN
  SELECT RAISE(ABORT,'SLOT_ENDED') WHERE julianday(NEW.created_at)>=julianday(NEW.date || 'T' || substr(NEW.time_slot,7,5) || ':00+08:00');
END;

CREATE TRIGGER appointment_student_day_insert BEFORE INSERT ON appointments
WHEN NEW.source='booking' AND NEW.status IN ('booked','in_progress','completed')
BEGIN
  SELECT RAISE(ABORT,'STUDENT_DAY_EXISTS') WHERE EXISTS(
    SELECT 1 FROM appointments WHERE source='booking' AND student_id=NEW.student_id AND date=NEW.date AND status IN ('booked','in_progress','completed')
  );
END;

CREATE TRIGGER appointment_student_day_update BEFORE UPDATE ON appointments
WHEN NEW.source='booking' AND NEW.status IN ('booked','in_progress','completed') AND (
  OLD.source<>NEW.source OR OLD.student_id<>NEW.student_id OR OLD.date<>NEW.date OR OLD.status IN ('cancelled','expired')
)
BEGIN
  SELECT RAISE(ABORT,'STUDENT_DAY_EXISTS') WHERE EXISTS(
    SELECT 1 FROM appointments WHERE source='booking' AND student_id=NEW.student_id AND date=NEW.date AND status IN ('booked','in_progress','completed') AND id<>OLD.id
  );
END;

CREATE TRIGGER appointment_capacity_update BEFORE UPDATE ON appointments
WHEN NEW.source='booking' AND ((OLD.status='cancelled' OR (NEW.status='booked' AND OLD.status IN ('completed','expired'))) OR NEW.date<>OLD.date OR NEW.campus<>OLD.campus OR NEW.time_slot<>OLD.time_slot OR OLD.source<>NEW.source)
BEGIN
 SELECT RAISE(ABORT,'SLOT_CHANGED') WHERE NEW.date<>OLD.date AND (
 length(NEW.date)<>10 OR date(NEW.date,'+0 days') IS NULL OR date(NEW.date,'+0 days')<>NEW.date);
 INSERT INTO booking_day_slots(campus,date,time_slot,capacity)
 SELECT NEW.campus,NEW.date,time_slot,capacity FROM slot_capacities
 WHERE campus=NEW.campus AND NEW.time_slot IN ('19:00–20:00','20:00–21:00')
 AND NOT EXISTS(SELECT 1 FROM booking_day_slots WHERE campus=NEW.campus AND date=NEW.date);
 INSERT INTO booking_day_slots(campus,date,time_slot,capacity)
 SELECT NEW.campus,NEW.date,time_slot,capacity FROM weekday_slot_capacities
 WHERE campus=NEW.campus AND weekday=CAST(strftime('%w',NEW.date) AS INTEGER)
 AND NOT EXISTS(SELECT 1 FROM booking_day_slots WHERE campus=NEW.campus AND date=NEW.date);
 -- Date-only archival backfills may predate the weekday schedule. Freeze
 -- their original slots only on past, unsnapshotted dates. Never use this
 -- fallback for restoration, rescheduling, or changes of campus/source/student.
 INSERT INTO booking_day_slots(campus,date,time_slot,capacity)
 SELECT NEW.campus,NEW.date,time_slot,capacity FROM booking_day_slots
 WHERE campus=OLD.campus AND date=OLD.date
 AND NEW.date<OLD.date AND NEW.date<date(OLD.created_at,'+8 hours')
 AND length(NEW.date)=10 AND date(NEW.date,'+0 days')=NEW.date
 AND NEW.campus=OLD.campus AND NEW.time_slot=OLD.time_slot
 AND NEW.student_id=OLD.student_id AND NEW.source=OLD.source
 AND (NEW.status=OLD.status OR (OLD.status IN ('booked','in_progress') AND NEW.status IN ('completed','cancelled','expired')))
 AND NOT EXISTS(SELECT 1 FROM booking_day_slots WHERE campus=NEW.campus AND date=NEW.date);
 SELECT RAISE(ABORT,'SLOT_CHANGED') WHERE NOT EXISTS(
 SELECT 1 FROM booking_day_slots WHERE campus=NEW.campus AND date=NEW.date AND time_slot=NEW.time_slot);
 SELECT RAISE(ABORT,'SLOT_PAUSED') WHERE NEW.status<>'cancelled' AND
 (SELECT capacity FROM booking_day_slots WHERE campus=NEW.campus AND date=NEW.date AND time_slot=NEW.time_slot)=0;
 SELECT RAISE(ABORT,'SLOT_FULL') WHERE NEW.status<>'cancelled' AND
 (SELECT COUNT(*) FROM appointments WHERE source='booking' AND date=NEW.date AND campus=NEW.campus AND time_slot=NEW.time_slot
 AND status<>'cancelled' AND id<>OLD.id) >=
 (SELECT capacity FROM booking_day_slots WHERE campus=NEW.campus AND date=NEW.date AND time_slot=NEW.time_slot);
END;

CREATE TRIGGER service_day_booking_insert BEFORE INSERT ON appointments
WHEN EXISTS(SELECT 1 FROM service_day_overrides s JOIN campuses c ON c.id=s.campus_id WHERE s.paused=1 AND s.business_date=NEW.date AND c.name=NEW.campus)
BEGIN
  SELECT RAISE(ABORT,'SERVICE_DAY_PAUSED');
END;

CREATE TRIGGER service_day_booking_restore BEFORE UPDATE OF status,date,campus ON appointments
WHEN NEW.status='booked' AND (OLD.status<>'booked' OR OLD.date<>NEW.date OR OLD.campus<>NEW.campus)
AND EXISTS(SELECT 1 FROM service_day_overrides s JOIN campuses c ON c.id=s.campus_id WHERE s.paused=1 AND s.business_date=NEW.date AND c.name=NEW.campus)
BEGIN
  SELECT RAISE(ABORT,'SERVICE_DAY_PAUSED');
END;

CREATE TRIGGER service_day_repair_start BEFORE UPDATE OF status ON appointments
WHEN NEW.status='in_progress' AND OLD.status<>'in_progress'
AND EXISTS(SELECT 1 FROM service_day_overrides s JOIN campuses c ON c.id=s.campus_id WHERE s.paused=1 AND s.business_date=date(NEW.started_at,'+8 hours') AND c.name=NEW.campus)
BEGIN
  SELECT RAISE(ABORT,'SERVICE_DAY_PAUSED');
END;

CREATE TRIGGER appointment_booking_notices BEFORE INSERT ON appointments
WHEN NEW.source='booking'
BEGIN
  SELECT RAISE(ABORT,'BOOKING_NOTICE_CHANGED') WHERE EXISTS(
    SELECT 1 FROM booking_notices n WHERE n.campus=NEW.campus AND n.enabled=1 AND n.important=1
    AND n.starts_at<=NEW.created_at AND n.ends_at>NEW.created_at
    AND NOT EXISTS(SELECT 1 FROM json_each(NEW.booking_notices) a
      WHERE json_extract(a.value,'$.id')=n.id AND json_extract(a.value,'$.revision')=n.revision)
  );
END;

CREATE TRIGGER appointment_new_expiration_deadline BEFORE INSERT ON appointments
WHEN NEW.source='booking' AND NEW.status='booked'
BEGIN
  SELECT RAISE(ABORT,'SLOT_ENDED') WHERE julianday(NEW.created_at)>=julianday(NEW.expires_at);
END;

CREATE TRIGGER repair_followup_completed_parent_insert BEFORE INSERT ON repair_followups
BEGIN
  SELECT RAISE(ABORT,'FOLLOWUP_PARENT_NOT_COMPLETED') WHERE NOT EXISTS(
    SELECT 1 FROM appointments WHERE id=NEW.parent_appointment_id AND status='completed'
  );
END;

CREATE TRIGGER repair_followup_schedule_guard BEFORE UPDATE OF status,scheduled_appointment_id ON repair_followups
WHEN NEW.status='scheduled'
BEGIN
  SELECT RAISE(ABORT,'FOLLOWUP_APPOINTMENT_INVALID') WHERE NOT EXISTS(
    SELECT 1 FROM appointments child JOIN appointments parent ON parent.id=NEW.parent_appointment_id
    WHERE child.id=NEW.scheduled_appointment_id AND child.status='booked'
      AND child.source='onsite' AND child.registration_flow='repair_followup'
      AND child.student_id=parent.student_id AND child.campus=parent.campus
  );
END;

CREATE TRIGGER appointment_contact_index_insert AFTER INSERT ON appointments
BEGIN
  INSERT INTO appointment_contact_index_pending(appointment_id,generation) VALUES(NEW.id,0)
    ON CONFLICT(appointment_id) DO UPDATE SET generation=generation+1;
END;

CREATE TRIGGER appointment_contact_index_update AFTER UPDATE OF phone,email,contact_value,social ON appointments
BEGIN
  INSERT INTO appointment_contact_index_pending(appointment_id,generation) VALUES(NEW.id,1)
    ON CONFLICT(appointment_id) DO UPDATE SET generation=generation+1;
END;

DROP TABLE _v12_integrity;

INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at)
SELECT 'v12-repair-grant-'||id,'authorization.repair-grant.retired',json_object('module','authorization','type','grant','id',id),
json_object('id',id,'roleId',role_id,'permissionCode',permission_code,'scope',json(scope_spec),'conditions',json(condition_spec),'validity',json(validity_spec),'revision',revision),
'维修改为有效账号在授权校区内直接操作，不再配置维修资格',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM role_grants
WHERE permission_code IN ('repair.summary.read','repair.start','repair.receive','repair.dispatch','repair.finish.own','repair.transfer','customer.identity.read','customer.contact.read','onsite.create','onsite.frontdesk.create');
DELETE FROM role_grants WHERE permission_code IN ('repair.summary.read','repair.start','repair.receive','repair.dispatch','repair.finish.own','repair.transfer','customer.identity.read','customer.contact.read','onsite.create','onsite.frontdesk.create');
DELETE FROM permission_definitions WHERE code='repair.dispatch';

INSERT INTO staff_release_markers VALUES('direct-repairs-0045',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
