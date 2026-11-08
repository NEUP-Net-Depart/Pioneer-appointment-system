-- Published rosters keep their original policy. Legacy drafts require an
-- explicit requirements confirmation before adopting repair-minimum-v2.
ALTER TABLE roster_tasks ADD COLUMN rule_version TEXT NOT NULL DEFAULT 'legacy';
CREATE TABLE roster_staffing_requirements (
  task_id TEXT NOT NULL REFERENCES roster_tasks(id),
  business_date TEXT NOT NULL,
  campus_id TEXT NOT NULL REFERENCES campuses(id),
  ordinary_minimum INTEGER NOT NULL CHECK(ordinary_minimum BETWEEN 0 AND 300),
  PRIMARY KEY(task_id,business_date,campus_id)
);
INSERT INTO permission_definitions(code,module_code,name,description,scope_kinds,condition_kinds,sensitive)
  VALUES('roster.repair.configure','rosters','维修人员需求配置','配置普通维修人员最低需求，不授予班表编辑和发布权限','["campus","department"]','[]',0);
INSERT INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec,validity_spec)
  SELECT 'grant-demand-'||rg.id,rg.role_id,'roster.repair.configure',rg.scope_spec,rg.condition_spec,rg.validity_spec
  FROM role_grants rg WHERE rg.permission_code IN ('roster.repair.manage','roster.office.manage')
    AND (rg.permission_code='roster.repair.manage' OR NOT EXISTS (
      SELECT 1 FROM role_grants repair WHERE repair.role_id=rg.role_id AND repair.permission_code='roster.repair.manage'));
UPDATE roles SET revision=revision+1,updated_at=datetime('now') WHERE id IN (
  SELECT role_id FROM role_grants WHERE permission_code='roster.repair.configure');
UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id IN (
  SELECT member_id FROM member_roles WHERE role_id IN (SELECT role_id FROM role_grants WHERE permission_code='roster.repair.configure'));

-- A second department/task must not publish another leader for the same
-- campus/day. Superseded versions of this task do not count twice.
CREATE TRIGGER roster_repair_minimum_publish BEFORE UPDATE OF status ON roster_versions
WHEN NEW.status='published' AND OLD.status<>'published' AND NEW.rule_version='repair-minimum-v2'
BEGIN
  SELECT RAISE(ABORT,'ROSTER_REPAIR_MINIMUM_MISSING') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.input_snapshot_ref,'$.eligibility.slots') s WHERE
      (SELECT COUNT(*) FROM duty_assignments da JOIN duty_roles dr ON dr.assignment_id=da.id AND dr.role_kind='repair_lead'
        WHERE da.version_id=NEW.id AND da.business_date=json_extract(s.value,'$.businessDate') AND da.campus_id=json_extract(s.value,'$.campusId'))<>1
      OR (SELECT COUNT(*) FROM duty_assignments da WHERE da.version_id=NEW.id
        AND da.business_date=json_extract(s.value,'$.businessDate') AND da.campus_id=json_extract(s.value,'$.campusId')
        AND NOT EXISTS(SELECT 1 FROM duty_roles dr WHERE dr.assignment_id=da.id AND dr.role_kind='repair_lead')
        AND NOT EXISTS(SELECT 1 FROM roster_leave_facts lf WHERE lf.origin_assignment_id=COALESCE(da.origin_assignment_id,da.id) AND lf.member_id=da.member_id AND lf.status='approved'))<COALESCE(json_extract(s.value,'$.ordinaryMinimum'),1)
  );
  SELECT RAISE(ABORT,'ROSTER_CAMPUS_LEADER_CONFLICT') WHERE EXISTS (
    SELECT 1 FROM duty_assignments own JOIN duty_roles own_role ON own_role.assignment_id=own.id AND own_role.role_kind='repair_lead'
      JOIN duty_assignments other ON other.campus_id=own.campus_id AND other.business_date=own.business_date AND other.duty_type='repair'
      JOIN roster_versions rv ON rv.id=other.version_id AND rv.status='published' AND rv.task_id<>NEW.task_id
      JOIN duty_roles other_role ON other_role.assignment_id=other.id AND other_role.role_kind='repair_lead'
      WHERE own.version_id=NEW.id AND NOT EXISTS(SELECT 1 FROM roster_leave_facts lf WHERE lf.origin_assignment_id=COALESCE(other.origin_assignment_id,other.id) AND lf.member_id=other.member_id AND lf.status='approved')
  );
END;

