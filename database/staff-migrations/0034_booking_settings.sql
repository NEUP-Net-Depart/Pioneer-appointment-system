-- Extend the live schema in place. Existing appointments and capacity snapshots
-- are preserved; notices are inactive until an administrator publishes them.
CREATE TABLE booking_settings (
  campus TEXT PRIMARY KEY CHECK(campus IN ('南湖','浑南')),
  release_time TEXT NOT NULL DEFAULT '10:00' CHECK(length(release_time)=5 AND release_time GLOB '[0-2][0-9]:[0-5][0-9]' AND substr(release_time,1,2) BETWEEN '00' AND '23'),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES staff_accounts(account)
);
INSERT INTO booking_settings(campus,updated_at) VALUES('南湖',strftime('%Y-%m-%dT%H:%M:%fZ','now')),('浑南',strftime('%Y-%m-%dT%H:%M:%fZ','now'));

CREATE TABLE booking_notices (
  id TEXT PRIMARY KEY,
  campus TEXT NOT NULL REFERENCES booking_settings(campus),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 80),
  content TEXT NOT NULL CHECK(length(trim(content)) BETWEEN 1 AND 2000),
  important INTEGER NOT NULL CHECK(important IN (0,1)),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL CHECK(ends_at>starts_at),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES staff_accounts(account)
);
CREATE INDEX idx_booking_notices_active ON booking_notices(campus,enabled,starts_at,ends_at);
ALTER TABLE appointments ADD COLUMN booking_notices TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(booking_notices) AND json_type(booking_notices)='array');

-- The acceptance snapshot commits with the booking. A notice published or
-- revised during submission cannot silently bypass the confirmation step.
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
