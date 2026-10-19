// Read before building the solver input and compare again inside publication.
// This covers authorization/qualification and concurrent leave/roster edits,
// rather than relying only on the draft's optimistic version number.
export const rosterFingerprintSql = `WITH target AS (SELECT * FROM roster_tasks WHERE id=?),
  people AS (SELECT member_id AS id FROM availability WHERE task_id=(SELECT id FROM target)
    UNION SELECT value FROM target,json_each(target.member_ids)
    UNION SELECT p.member_id FROM member_work_profiles p,target t WHERE t.duty_type='office' AND p.profile_code='office'
      AND p.effective_from<=date(t.week_start,'+3 day') AND (p.effective_to IS NULL OR p.effective_to>t.week_start)
    UNION SELECT da.member_id FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id WHERE rv.task_id=(SELECT id FROM target)),
  period AS (SELECT da.* FROM duty_assignments da JOIN roster_versions rv ON rv.id=da.version_id
    WHERE rv.status='published' AND da.member_id IN (SELECT id FROM people)
    AND da.business_date BETWEEN (SELECT week_start FROM target) AND date((SELECT week_start FROM target),'+6 day'))
  SELECT json_object(
    'serviceDays',(SELECT json_group_array(json_array(business_date,campus_id,paused,revision)) FROM (SELECT * FROM service_day_overrides WHERE business_date BETWEEN (SELECT week_start FROM target) AND date((SELECT week_start FROM target),'+3 day') ORDER BY business_date,campus_id)),
    'task',(SELECT json_array(id,revision,rule_version) FROM target),
    'requirements',(SELECT json_group_array(json_array(business_date,campus_id,ordinary_minimum)) FROM (SELECT * FROM roster_staffing_requirements WHERE task_id=(SELECT id FROM target) ORDER BY business_date,campus_id)),
    'availability',(SELECT json_group_array(json_array(member_id,business_date,start_at,end_at,campus_id,revision)) FROM (SELECT * FROM availability WHERE task_id=(SELECT id FROM target) ORDER BY id)),
    'members',(SELECT json_group_array(json_array(id,status,revision)) FROM (SELECT * FROM members WHERE id IN (SELECT id FROM people) ORDER BY id)),
    'accounts',(SELECT json_group_array(json_array(account,member_id,status,auth_version)) FROM (SELECT * FROM staff_accounts WHERE member_id IN (SELECT id FROM people) ORDER BY account)),
    'campuses',(SELECT json_group_array(json_array(account,campus)) FROM (SELECT * FROM staff_campus_grants WHERE account IN (SELECT account FROM staff_accounts WHERE member_id IN (SELECT id FROM people)) ORDER BY account,campus)),
    'profiles',(SELECT json_group_array(json_array(id,profile_code,effective_from,effective_to,revision)) FROM (SELECT * FROM member_work_profiles WHERE member_id IN (SELECT id FROM people) ORDER BY id)),
    'memberships',(SELECT json_group_array(json_array(id,department_id,effective_from,effective_to,revision)) FROM (SELECT * FROM member_department_memberships WHERE member_id IN (SELECT id FROM people) ORDER BY id)),
    'bindings',(SELECT json_group_array(json_array(id,role_id,scope_bindings,effective_from,effective_to)) FROM (SELECT * FROM member_roles WHERE member_id IN (SELECT id FROM people) ORDER BY id)),
    'grants',(SELECT json_group_array(json_array(id,permission_code,scope_spec,condition_spec,validity_spec)) FROM (SELECT * FROM role_grants WHERE role_id IN (SELECT role_id FROM member_roles WHERE member_id IN (SELECT id FROM people)) ORDER BY id)),
    'roles',(SELECT json_group_array(json_array(id,enabled,revision)) FROM (SELECT * FROM roles WHERE id IN (SELECT role_id FROM member_roles WHERE member_id IN (SELECT id FROM people)) ORDER BY id)),
    'assignments',(SELECT json_group_array(json_array(id,version_id,member_id,revision)) FROM (SELECT * FROM period ORDER BY id)),
    'leaves',(SELECT json_group_array(json_array(id,status,revision)) FROM (SELECT * FROM roster_leave_facts WHERE member_id IN (SELECT id FROM people) ORDER BY id))
  ) AS fingerprint`;
