CREATE TABLE slot_capacities (
  campus TEXT NOT NULL CHECK(campus IN ('南湖','浑南')),
  time_slot TEXT NOT NULL CHECK(time_slot IN ('19:00–20:00','20:00–21:00')),
  capacity INTEGER NOT NULL DEFAULT 10 CHECK(typeof(capacity)='integer' AND capacity BETWEEN 0 AND 9007199254740991),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(typeof(revision)='integer' AND revision BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY(campus,time_slot)
);

INSERT INTO slot_capacities(campus,time_slot) VALUES
  ('南湖','19:00–20:00'),('南湖','20:00–21:00'),
  ('浑南','19:00–20:00'),('浑南','20:00–21:00');

DROP TRIGGER appointment_capacity_insert;
DROP TRIGGER appointment_capacity_update;

CREATE TRIGGER appointment_capacity_insert BEFORE INSERT ON appointments
WHEN NOT (NEW.status='completed' AND NEW.outcome='cancelled')
BEGIN
  SELECT RAISE(ABORT,'SLOT_PAUSED') WHERE (
    SELECT capacity FROM slot_capacities WHERE campus=NEW.campus AND time_slot=NEW.time_slot
  ) = 0;
  SELECT RAISE(ABORT,'SLOT_FULL') WHERE (
    SELECT COUNT(*) FROM appointments WHERE date=NEW.date AND campus=NEW.campus
      AND time_slot=NEW.time_slot AND NOT (status='completed' AND outcome='cancelled')
  ) >= COALESCE((SELECT capacity FROM slot_capacities WHERE campus=NEW.campus AND time_slot=NEW.time_slot),10);
END;

CREATE TRIGGER appointment_capacity_update BEFORE UPDATE ON appointments
WHEN NOT (NEW.status='completed' AND NEW.outcome='cancelled') AND (
  (OLD.status='completed' AND OLD.outcome='cancelled') OR NEW.date<>OLD.date
  OR NEW.campus<>OLD.campus OR NEW.time_slot<>OLD.time_slot
)
BEGIN
  SELECT RAISE(ABORT,'SLOT_PAUSED') WHERE (
    SELECT capacity FROM slot_capacities WHERE campus=NEW.campus AND time_slot=NEW.time_slot
  ) = 0;
  SELECT RAISE(ABORT,'SLOT_FULL') WHERE (
    SELECT COUNT(*) FROM appointments WHERE date=NEW.date AND campus=NEW.campus
      AND time_slot=NEW.time_slot AND NOT (status='completed' AND outcome='cancelled') AND id<>OLD.id
  ) >= COALESCE((SELECT capacity FROM slot_capacities WHERE campus=NEW.campus AND time_slot=NEW.time_slot),10);
END;
