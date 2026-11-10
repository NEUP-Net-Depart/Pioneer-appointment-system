CREATE TABLE _membership_0052 AS SELECT * FROM member_department_memberships;
DROP TABLE member_department_memberships;
CREATE TABLE member_department_memberships (
 id TEXT PRIMARY KEY,
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 department_id TEXT NOT NULL REFERENCES departments(id),
 assignment_type TEXT NOT NULL DEFAULT 'primary' CHECK(assignment_type IN ('primary','exchange','maintenance_affairs')),
 is_primary INTEGER NOT NULL DEFAULT 1 CHECK(is_primary IN (0,1)),
 effective_from TEXT NOT NULL,
 effective_to TEXT,
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 created_at TEXT NOT NULL,
 position_code TEXT NOT NULL DEFAULT 'member' CHECK(position_code IN ('member','deputy_head','head','deputy_director','director','vice_president','president')),
 CHECK(effective_to IS NULL OR effective_to>=effective_from),
 CHECK((assignment_type='primary' AND is_primary=1) OR (assignment_type IN ('exchange','maintenance_affairs') AND is_primary=0 AND position_code='member'))
);
INSERT INTO member_department_memberships SELECT * FROM _membership_0052;
DROP TABLE _membership_0052;
CREATE INDEX idx_membership_member_time ON member_department_memberships(member_id,effective_from,effective_to);
CREATE UNIQUE INDEX idx_membership_primary_open ON member_department_memberships(member_id) WHERE is_primary=1 AND effective_to IS NULL;
CREATE TRIGGER membership_primary_overlap_guard BEFORE INSERT ON member_department_memberships WHEN NEW.is_primary=1 AND (NEW.effective_to IS NULL OR NEW.effective_from<NEW.effective_to) BEGIN
 SELECT RAISE(ABORT,'PRIMARY_MEMBERSHIP_OVERLAP') WHERE EXISTS(SELECT 1 FROM member_department_memberships old WHERE old.member_id=NEW.member_id AND old.is_primary=1 AND (old.effective_to IS NULL OR old.effective_from<old.effective_to) AND (old.effective_to IS NULL OR NEW.effective_from<old.effective_to) AND (NEW.effective_to IS NULL OR old.effective_from<NEW.effective_to));
END;
CREATE TRIGGER membership_primary_update_guard BEFORE UPDATE OF member_id,is_primary,effective_from,effective_to ON member_department_memberships WHEN NEW.is_primary=1 AND (NEW.effective_to IS NULL OR NEW.effective_from<NEW.effective_to) BEGIN
 SELECT RAISE(ABORT,'PRIMARY_MEMBERSHIP_OVERLAP') WHERE EXISTS(SELECT 1 FROM member_department_memberships old WHERE old.member_id=NEW.member_id AND old.is_primary=1 AND old.id<>NEW.id AND (old.effective_to IS NULL OR old.effective_from<old.effective_to) AND (old.effective_to IS NULL OR NEW.effective_from<old.effective_to) AND (NEW.effective_to IS NULL OR old.effective_from<NEW.effective_to));
END;
CREATE TRIGGER organization_authorization_insert AFTER INSERT ON member_department_memberships BEGIN
 UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id=NEW.member_id;
END;
CREATE TRIGGER organization_authorization_update AFTER UPDATE ON member_department_memberships BEGIN
 UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id IN (OLD.member_id,NEW.member_id);
END;
CREATE TRIGGER organization_authorization_delete AFTER DELETE ON member_department_memberships BEGIN
 UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id=OLD.member_id;
END;
