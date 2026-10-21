-- Preserve original customer answers; field verification belongs to the intake.
ALTER TABLE repair_intake_records ADD COLUMN verification_json TEXT;
ALTER TABLE appointments ADD COLUMN registration_flow TEXT NOT NULL DEFAULT 'technician_intake';
DROP INDEX idx_one_pending_onsite_registration;
CREATE UNIQUE INDEX idx_one_pending_onsite_registration ON appointments(registered_by)
WHERE source='onsite' AND status='booked' AND registered_by IS NOT NULL AND registration_flow<>'frontdesk';

INSERT OR IGNORE INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec)
SELECT 'grant-self-attendance-'||id,id,'attendance.self','{"self":true}','[{"code":"attendanceEligible","version":1}]'
FROM roles WHERE code IN ('office','repair_lead','office_lead');
INSERT OR IGNORE INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec) VALUES
 ('grant-office-contact','role-office','customer.contact.read','{"campuses":"bound"}','[{"code":"activeDutyRole","version":1,"parameters":{"dutyType":"office"}}]'),
 ('grant-office-identity','role-office','customer.identity.read','{"campuses":"bound"}','[{"code":"activeDutyRole","version":1,"parameters":{"dutyType":"office"}}]');

-- The active-repair unique constraint and this guard serialize away/start races.
CREATE TRIGGER field_presence_busy_guard BEFORE UPDATE OF state ON staff_presence
WHEN NEW.state<>'available' AND EXISTS(SELECT 1 FROM active_repairs WHERE member_id=NEW.member_id)
BEGIN
  SELECT RAISE(ABORT,'PRESENCE_BUSY');
END;
