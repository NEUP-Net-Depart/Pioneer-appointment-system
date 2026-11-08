-- Additive migration: preserve every historical appointment and attachment.
ALTER TABLE appointments ADD COLUMN email TEXT NOT NULL DEFAULT '';
ALTER TABLE appointments ADD COLUMN contact_type TEXT NOT NULL DEFAULT '';
ALTER TABLE appointments ADD COLUMN contact_value TEXT NOT NULL DEFAULT '';
ALTER TABLE appointments ADD COLUMN liquid_metal TEXT;
ALTER TABLE appointments ADD COLUMN dell_g15 TEXT;
ALTER TABLE appointments ADD COLUMN location_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE appointments ADD COLUMN location_revision INTEGER;

CREATE TABLE service_locations (
  campus TEXT NOT NULL CHECK(campus IN ('南湖','浑南')),
  date TEXT NOT NULL,
  location TEXT NOT NULL CHECK(length(location)<=200),
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES staff_accounts(account),
  PRIMARY KEY(campus,date)
);
CREATE TABLE service_location_changes (
  id TEXT PRIMARY KEY,
  campus TEXT NOT NULL,
  date TEXT NOT NULL,
  actor TEXT NOT NULL REFERENCES staff_accounts(account),
  before_location TEXT NOT NULL,
  after_location TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_location_changes ON service_location_changes(campus,date,created_at);
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

-- Triggers enforce the daily constraint without deleting pre-existing duplicates.
-- Keep an indexed lookup; a new unique index would fail on historical duplicates.
DROP INDEX idx_active_student_slot;
DROP TRIGGER appointment_overlap_insert;
DROP TRIGGER appointment_overlap_update;
CREATE INDEX idx_online_student_day ON appointments(student_id,date) WHERE source='booking' AND status IN ('booked','in_progress','completed');
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

CREATE TABLE booking_requests (
  request_key TEXT PRIMARY KEY CHECK(length(request_key)=43),
  digest TEXT NOT NULL CHECK(length(digest)=64),
  appointment_id TEXT NOT NULL UNIQUE REFERENCES appointments(id) ON UPDATE CASCADE,
  encrypted_token TEXT NOT NULL,
  created_at TEXT NOT NULL
);
ALTER TABLE attachment_storage ADD COLUMN appointment_id TEXT;
ALTER TABLE attachment_storage ADD COLUMN purpose TEXT NOT NULL DEFAULT 'general';
CREATE INDEX idx_pending_student_photos ON attachment_storage(appointment_id) WHERE state='pending' AND purpose='student_photo';
