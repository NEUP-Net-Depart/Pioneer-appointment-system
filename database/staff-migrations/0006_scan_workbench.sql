-- A unique claim serializes all intake paths, including the legacy admin API.
-- Existing simultaneous repairs are preserved and must be finished one by one.
CREATE TABLE active_repairs (
  account TEXT PRIMARY KEY REFERENCES staff_accounts(account),
  appointment_id TEXT NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE
);

INSERT INTO active_repairs(account,appointment_id)
SELECT assigned_to,MIN(id) FROM appointments
WHERE status='in_progress' AND assigned_to IS NOT NULL GROUP BY assigned_to;

CREATE TRIGGER appointment_active_insert AFTER INSERT ON appointments
WHEN NEW.status='in_progress'
BEGIN
  SELECT RAISE(ABORT,'ACTIVE_REPAIR_EXISTS') WHERE NEW.assigned_to IS NULL;
  INSERT INTO active_repairs(account,appointment_id) VALUES(NEW.assigned_to,NEW.id);
END;

CREATE TRIGGER appointment_active_update AFTER UPDATE OF status,assigned_to ON appointments
WHEN OLD.status<>NEW.status OR OLD.assigned_to IS NOT NEW.assigned_to
BEGIN
  DELETE FROM active_repairs WHERE appointment_id=OLD.id;
  INSERT INTO active_repairs(account,appointment_id)
    SELECT OLD.assigned_to,MIN(id) FROM appointments
    WHERE status='in_progress' AND assigned_to=OLD.assigned_to AND OLD.status='in_progress'
      AND (NEW.status<>'in_progress' OR OLD.assigned_to IS NOT NEW.assigned_to)
      AND NOT EXISTS(SELECT 1 FROM active_repairs WHERE account=OLD.assigned_to)
    HAVING COUNT(*)>0;
  SELECT RAISE(ABORT,'ACTIVE_REPAIR_EXISTS') WHERE NEW.status='in_progress' AND NEW.assigned_to IS NULL;
  INSERT INTO active_repairs(account,appointment_id)
    SELECT NEW.assigned_to,NEW.id WHERE NEW.status='in_progress'
      AND NOT (OLD.status='in_progress' AND OLD.assigned_to IS NEW.assigned_to);
END;

CREATE TRIGGER appointment_active_delete AFTER DELETE ON appointments
BEGIN
  INSERT INTO active_repairs(account,appointment_id)
    SELECT OLD.assigned_to,MIN(id) FROM appointments
    WHERE status='in_progress' AND assigned_to=OLD.assigned_to
      AND NOT EXISTS(SELECT 1 FROM active_repairs WHERE account=OLD.assigned_to)
    HAVING COUNT(*)>0;
END;

ALTER TABLE appointments ADD COLUMN source TEXT NOT NULL DEFAULT 'booking' CHECK(source IN ('booking','onsite'));
ALTER TABLE appointments ADD COLUMN registered_by TEXT REFERENCES staff_accounts(account);
ALTER TABLE appointments ADD COLUMN registration_key TEXT;
CREATE UNIQUE INDEX idx_onsite_request ON appointments(registered_by,registration_key);

-- Walk-ins use the same lifecycle, but never consume scheduled booking capacity.
DROP TRIGGER appointment_capacity_insert;
DROP TRIGGER appointment_capacity_update;

CREATE TRIGGER appointment_capacity_insert BEFORE INSERT ON appointments
WHEN NEW.source='booking' AND NOT (NEW.status='completed' AND NEW.outcome='cancelled')
BEGIN
  SELECT RAISE(ABORT,'SLOT_PAUSED') WHERE (
    SELECT capacity FROM slot_capacities WHERE campus=NEW.campus AND time_slot=NEW.time_slot
  ) = 0;
  SELECT RAISE(ABORT,'SLOT_FULL') WHERE (
    SELECT COUNT(*) FROM appointments WHERE source='booking' AND date=NEW.date AND campus=NEW.campus
      AND time_slot=NEW.time_slot AND NOT (status='completed' AND outcome='cancelled')
  ) >= COALESCE((SELECT capacity FROM slot_capacities WHERE campus=NEW.campus AND time_slot=NEW.time_slot),10);
END;

CREATE TRIGGER appointment_capacity_update BEFORE UPDATE ON appointments
WHEN NEW.source='booking' AND NOT (NEW.status='completed' AND NEW.outcome='cancelled') AND (
  (OLD.status='completed' AND OLD.outcome='cancelled') OR NEW.date<>OLD.date
  OR NEW.campus<>OLD.campus OR NEW.time_slot<>OLD.time_slot OR OLD.source<>NEW.source
)
BEGIN
  SELECT RAISE(ABORT,'SLOT_PAUSED') WHERE (
    SELECT capacity FROM slot_capacities WHERE campus=NEW.campus AND time_slot=NEW.time_slot
  ) = 0;
  SELECT RAISE(ABORT,'SLOT_FULL') WHERE (
    SELECT COUNT(*) FROM appointments WHERE source='booking' AND date=NEW.date AND campus=NEW.campus
      AND time_slot=NEW.time_slot AND NOT (status='completed' AND outcome='cancelled') AND id<>OLD.id
  ) >= COALESCE((SELECT capacity FROM slot_capacities WHERE campus=NEW.campus AND time_slot=NEW.time_slot),10);
END;
