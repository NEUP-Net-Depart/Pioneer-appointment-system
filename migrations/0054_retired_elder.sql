-- A manually granted identity, independent of organization appointments.
-- No historical appointments, attendance or volunteer credits are rewritten.
CREATE TABLE member_special_identities (
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 code TEXT NOT NULL CHECK(code IN ('retired_elder')),
 granted_at TEXT NOT NULL,
 PRIMARY KEY(member_id,code)
);
CREATE TRIGGER special_identity_authorization_insert AFTER INSERT ON member_special_identities BEGIN
 UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id=NEW.member_id;
END;
CREATE TRIGGER special_identity_authorization_delete AFTER DELETE ON member_special_identities BEGIN
 UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id=OLD.member_id;
END;
DROP VIEW staff_access_campuses;
CREATE VIEW staff_access_campuses AS
 SELECT account,campus FROM staff_campus_grants
 UNION SELECT s.account,c.name FROM staff_accounts s CROSS JOIN campuses c
 WHERE EXISTS(SELECT 1 FROM member_department_memberships mm JOIN departments d ON d.id=mm.department_id AND d.enabled=1
 WHERE mm.member_id=s.member_id AND mm.is_primary=1 AND mm.position_code IN ('deputy_director','director','vice_president','president')
 AND mm.effective_from<=date('now','+8 hours') AND (mm.effective_to IS NULL OR mm.effective_to>date('now','+8 hours')))
 OR EXISTS(SELECT 1 FROM member_special_identities si WHERE si.member_id=s.member_id AND si.code='retired_elder');
INSERT INTO staff_release_markers VALUES('retired-elder-0054',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
