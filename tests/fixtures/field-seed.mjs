import { hashPassword } from "../../src/lib/passwords.js";

// Used only by disposable local preview and test databases.
export function fieldSeed(day) {
  const password = hashPassword("StaffTest!2026"),
    at = `${day}T00:00:00.000Z`;
  const people = [
    ["20261001", "林悦", "admin"],
    ["20261002", "陈宇", "technician"],
    ["20261003", "周宁", "technician"],
    ["20261004", "许晨", "technician"],
  ];
  return [
    ...people.map(
      ([account, name, role]) =>
        `INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES('${account}','${name}','${role}','南湖','${password}','2026-01-01T00:00:00.000Z'); INSERT INTO staff_campus_grants VALUES('${account}','南湖');`,
    ),
    `INSERT INTO roster_tasks(id,week_start,slot_start,slot_end,deadline,created_at,created_by_member_id) VALUES('field-task','${day}','00:00','23:59','${at}','${at}','member-root001');`,
    `INSERT INTO roster_versions(id,task_id,status,version,rule_version,algorithm_version,created_at) VALUES('field-roster','field-task','published',1,'1.0.0','fixture','${at}');`,
    ...people.map(
      ([account]) =>
        `INSERT INTO duty_assignments(id,version_id,member_id,business_date,campus_id,duty_type,start_at,end_at) VALUES('field-shift-${account}','field-roster','member-${account}','${day}','campus-nanhu','${account === "20261001" ? "office" : "repair"}','00:00','23:59');`,
    ),
    `INSERT INTO duty_roles(id,assignment_id,role_kind) VALUES('field-lead','field-shift-20261004','repair_lead'); INSERT INTO member_roles(id,member_id,role_id,scope_bindings,effective_from) VALUES('field-lead-role','member-20261004','role-repair-lead','{"campusIds":["campus-nanhu"]}','2026-01-01');`,
    // All-day window is an explicit local fixture, not the service's default.
    `INSERT INTO attendance_events(id,type,policy_code,policy_version,campus_id,business_date,starts_at,ends_at,created_by_member_id,created_at) VALUES('field-event','duty','duty.v1','1.0.0','campus-nanhu','${day}','${day}T00:00:00+08:00','${day}T23:59:59+08:00','member-root001','${at}');`,
  ].join("\n");
}
