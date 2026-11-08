CREATE TABLE service_day_overrides (
  business_date TEXT NOT NULL,
  campus_id TEXT NOT NULL REFERENCES campuses(id),
  paused INTEGER NOT NULL CHECK(paused IN (0,1)),
  reason TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(business_date,campus_id)
);
CREATE TABLE service_day_receipts (
  actor_member_id TEXT NOT NULL REFERENCES members(id),
  request_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  result_json TEXT NOT NULL,
  PRIMARY KEY(actor_member_id,request_id)
);
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
CREATE TRIGGER service_day_attendance_insert BEFORE INSERT ON attendance_records
WHEN EXISTS(SELECT 1 FROM attendance_events e JOIN service_day_overrides s ON s.business_date=e.business_date AND s.campus_id=e.campus_id WHERE e.id=NEW.event_id AND e.type='duty' AND s.paused=1)
BEGIN
  SELECT RAISE(ABORT,'SERVICE_DAY_PAUSED');
END;
CREATE TRIGGER service_day_roster_publish BEFORE UPDATE OF status ON roster_versions
WHEN NEW.status='published' AND OLD.status<>'published'
BEGIN
  SELECT RAISE(ABORT,'SERVICE_DAY_PAUSED') WHERE EXISTS (
    SELECT 1 FROM duty_assignments old JOIN roster_versions rv ON rv.id=old.version_id AND rv.task_id=NEW.task_id AND rv.status='published'
    JOIN service_day_overrides s ON s.business_date=old.business_date AND s.campus_id=old.campus_id AND s.paused=1
    WHERE NOT EXISTS(SELECT 1 FROM duty_assignments a WHERE a.version_id=NEW.id AND a.member_id=old.member_id
      AND a.business_date=old.business_date AND a.campus_id=old.campus_id AND a.duty_type=old.duty_type AND a.start_at=old.start_at AND a.end_at=old.end_at
      AND COALESCE((SELECT role_kind FROM duty_roles WHERE assignment_id=a.id),'')=COALESCE((SELECT role_kind FROM duty_roles WHERE assignment_id=old.id),''))
  );
  SELECT RAISE(ABORT,'SERVICE_DAY_PAUSED') WHERE EXISTS (
    SELECT 1 FROM duty_assignments a JOIN service_day_overrides s ON s.business_date=a.business_date AND s.campus_id=a.campus_id AND s.paused=1
    WHERE a.version_id=NEW.id AND NOT EXISTS(SELECT 1 FROM duty_assignments old JOIN roster_versions rv ON rv.id=old.version_id AND rv.task_id=NEW.task_id AND rv.status='published'
    WHERE old.member_id=a.member_id AND old.business_date=a.business_date AND old.campus_id=a.campus_id AND old.start_at=a.start_at AND old.end_at=a.end_at)
  );
END;
