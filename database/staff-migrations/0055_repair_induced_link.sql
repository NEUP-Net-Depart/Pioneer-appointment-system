DROP TRIGGER repair_link_insert;
DROP TRIGGER repair_link_update;

ALTER TABLE appointments RENAME COLUMN link_kind TO previous_link_kind;
ALTER TABLE appointments ADD COLUMN link_kind TEXT CHECK(link_kind IN ('continuation','recurrence','repair_induced','historical'));
UPDATE appointments SET link_kind=previous_link_kind;
ALTER TABLE appointments DROP COLUMN previous_link_kind;

CREATE TRIGGER repair_link_insert BEFORE INSERT ON appointments WHEN NEW.parent_appointment_id IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'REPAIR_LINK_INVALID') WHERE NEW.id=NEW.parent_appointment_id OR NEW.link_kind IS NULL OR NEW.link_kind NOT IN ('continuation','recurrence','repair_induced')
 OR NOT EXISTS(SELECT 1 FROM appointments p WHERE p.id=NEW.parent_appointment_id AND p.status='completed' AND p.student_id=NEW.student_id)
 OR NOT EXISTS(SELECT 1 FROM staff_access_campuses g JOIN appointments p ON p.campus=g.campus WHERE p.id=NEW.parent_appointment_id AND g.account=NEW.linked_by)
 OR NOT EXISTS(SELECT 1 FROM staff_access_campuses g WHERE g.campus=NEW.campus AND g.account=NEW.linked_by)
 OR NOT EXISTS(SELECT 1 FROM staff_accounts s JOIN members m ON m.id=s.member_id WHERE s.account=NEW.linked_by AND s.status='enabled' AND m.status='active');
END;
CREATE TRIGGER repair_link_update BEFORE UPDATE OF parent_appointment_id,link_kind ON appointments WHEN NEW.parent_appointment_id IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'REPAIR_LINK_INVALID') WHERE OLD.parent_appointment_id IS NOT NULL OR NEW.id=NEW.parent_appointment_id
 OR NEW.status NOT IN ('booked','in_progress') OR NEW.link_kind IS NULL OR NEW.link_kind NOT IN ('continuation','recurrence','repair_induced')
 OR NOT EXISTS(SELECT 1 FROM appointments p WHERE p.id=NEW.parent_appointment_id AND p.status='completed' AND p.student_id=NEW.student_id)
 OR NOT EXISTS(SELECT 1 FROM staff_access_campuses g JOIN appointments p ON p.campus=g.campus WHERE p.id=NEW.parent_appointment_id AND g.account=NEW.linked_by)
 OR NOT EXISTS(SELECT 1 FROM staff_access_campuses g WHERE g.campus=NEW.campus AND g.account=NEW.linked_by)
 OR NOT EXISTS(SELECT 1 FROM staff_accounts s JOIN members m ON m.id=s.member_id WHERE s.account=NEW.linked_by AND s.status='enabled' AND m.status='active');
END;
