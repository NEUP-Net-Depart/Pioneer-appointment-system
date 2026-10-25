-- Existing appointments and credentials remain untouched, including historical duplicates.
DROP TRIGGER appointment_student_day_insert;
DROP TRIGGER appointment_student_day_update;
CREATE TRIGGER appointment_student_day_insert BEFORE INSERT ON appointments
WHEN NEW.source='booking' AND NEW.status IN ('booked','in_progress','completed')
BEGIN
  SELECT RAISE(ABORT,'STUDENT_DAY_LIMIT') WHERE (
    SELECT COUNT(*) FROM appointments WHERE source='booking' AND student_id=NEW.student_id AND date=NEW.date AND status IN ('booked','in_progress','completed')
  )>=2;
END;
CREATE TRIGGER appointment_student_day_update BEFORE UPDATE ON appointments
WHEN NEW.source='booking' AND NEW.status IN ('booked','in_progress','completed') AND (
  OLD.source<>NEW.source OR OLD.student_id<>NEW.student_id OR OLD.date<>NEW.date OR OLD.status IN ('cancelled','expired')
)
BEGIN
  SELECT RAISE(ABORT,'STUDENT_DAY_LIMIT') WHERE (
    SELECT COUNT(*) FROM appointments WHERE source='booking' AND student_id=NEW.student_id AND date=NEW.date AND status IN ('booked','in_progress','completed') AND id<>OLD.id
  )>=2;
END;

ALTER TABLE booking_requests ADD COLUMN device_count INTEGER NOT NULL DEFAULT 1 CHECK(device_count IN (1,2));

-- Additional receipt entries share the original request's atomic commit and recovery.
CREATE TABLE booking_request_devices (
  request_key TEXT NOT NULL REFERENCES booking_requests(request_key) ON DELETE CASCADE,
  appointment_id TEXT NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE ON UPDATE CASCADE,
  encrypted_token TEXT NOT NULL,
  PRIMARY KEY(request_key,appointment_id)
);
CREATE TABLE booking_device_links (
  appointment_id TEXT PRIMARY KEY REFERENCES appointments(id) ON DELETE CASCADE ON UPDATE CASCADE,
  parent_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE ON UPDATE CASCADE,
  parent_revision INTEGER NOT NULL CHECK(parent_revision>=0),
  CHECK(appointment_id<>parent_id)
);
CREATE INDEX idx_booking_device_parent ON booking_device_links(parent_id);
INSERT INTO staff_release_markers(id,applied_at) VALUES('multi-device-booking-0041',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
