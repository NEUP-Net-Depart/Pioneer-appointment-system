-- Append-only repair for databases that already applied 0009 and 0010.
-- Preserve all appointments and existing date snapshots; retain every guard.
DROP TRIGGER appointment_capacity_update;

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
