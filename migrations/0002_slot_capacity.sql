-- Lower new reservations to ten without blocking work on existing bookings.
DROP TRIGGER appointment_capacity_insert;
DROP TRIGGER appointment_capacity_update;

CREATE TRIGGER appointment_capacity_insert BEFORE INSERT ON appointments
WHEN NEW.status NOT IN ('cancelled','no_show')
BEGIN
  SELECT RAISE(ABORT,'SLOT_FULL') WHERE (
    SELECT COUNT(*) FROM appointments WHERE date=NEW.date AND campus=NEW.campus
      AND time_slot=NEW.time_slot AND status NOT IN ('cancelled','no_show')
  ) >= 10;
END;

CREATE TRIGGER appointment_capacity_update BEFORE UPDATE ON appointments
WHEN NEW.status NOT IN ('cancelled','no_show') AND (
  OLD.status IN ('cancelled','no_show') OR NEW.date<>OLD.date
  OR NEW.campus<>OLD.campus OR NEW.time_slot<>OLD.time_slot
)
BEGIN
  SELECT RAISE(ABORT,'SLOT_FULL') WHERE (
    SELECT COUNT(*) FROM appointments WHERE date=NEW.date AND campus=NEW.campus
      AND time_slot=NEW.time_slot AND status NOT IN ('cancelled','no_show') AND id<>OLD.id
  ) >= 10;
END;
