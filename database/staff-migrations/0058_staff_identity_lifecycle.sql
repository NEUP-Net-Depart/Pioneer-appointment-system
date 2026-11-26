UPDATE staff_accounts SET role='technician',revision=revision+1,
 token_version=token_version+1,auth_version=auth_version+1 WHERE role='admin';
UPDATE staff_whitelist SET expected_role='technician',revision=revision+1 WHERE expected_role='admin';

CREATE TRIGGER obsolete_staff_role_insert BEFORE INSERT ON staff_accounts WHEN NEW.role='admin' BEGIN
 SELECT RAISE(ABORT,'OBSOLETE_STAFF_ROLE');
END;
CREATE TRIGGER obsolete_staff_role_update BEFORE UPDATE OF role ON staff_accounts WHEN NEW.role='admin' BEGIN
 SELECT RAISE(ABORT,'OBSOLETE_STAFF_ROLE');
END;
CREATE TRIGGER obsolete_invitation_role_insert BEFORE INSERT ON staff_whitelist WHEN NEW.expected_role='admin' BEGIN
 SELECT RAISE(ABORT,'OBSOLETE_STAFF_ROLE');
END;
CREATE TRIGGER obsolete_invitation_role_update BEFORE UPDATE OF expected_role ON staff_whitelist WHEN NEW.expected_role='admin' BEGIN
 SELECT RAISE(ABORT,'OBSOLETE_STAFF_ROLE');
END;

ALTER TABLE member_special_identities ADD COLUMN effective_to TEXT;
UPDATE member_special_identities SET effective_to=
 CASE WHEN strftime('%m-%d',granted_at,'+8 hours')='02-29'
 THEN date(granted_at,'+8 hours','+1 year','-1 day')
 ELSE date(granted_at,'+8 hours','+1 year') END;

CREATE TRIGGER special_identity_authorization_update AFTER UPDATE ON member_special_identities BEGIN
 UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id=NEW.member_id;
END;

DROP VIEW staff_access_campuses;
CREATE VIEW staff_access_campuses AS
 SELECT account,campus FROM staff_campus_grants
 UNION SELECT s.account,c.name FROM staff_accounts s CROSS JOIN campuses c
 WHERE EXISTS(SELECT 1 FROM member_department_memberships mm JOIN departments d ON d.id=mm.department_id AND d.enabled=1
 WHERE mm.member_id=s.member_id AND mm.is_primary=1 AND mm.position_code IN ('deputy_director','director','vice_president','president')
 AND mm.effective_from<=date('now','+8 hours') AND (mm.effective_to IS NULL OR mm.effective_to>date('now','+8 hours')))
 OR EXISTS(SELECT 1 FROM member_special_identities si WHERE si.member_id=s.member_id AND si.code='retired_elder'
 AND si.effective_to>date('now','+8 hours'));
