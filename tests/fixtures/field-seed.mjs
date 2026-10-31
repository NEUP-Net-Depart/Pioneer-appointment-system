import { hashPassword } from '../../src/lib/passwords.js';
import { addDays, weekRange } from '../../shared/time.js';

// Used only by disposable local preview and test databases.
export function fieldSeed(day, { reportDemo = false } = {}) {
  const password = hashPassword('StaffTest!2026'),
    at = `${day}T00:00:00.000Z`;
  const people = [
    ['20261001', '林悦', 'admin'],
    ['20261002', '陈宇', 'technician'],
    ['20261003', '周宁', 'technician'],
    ['20261004', '许晨', 'technician']
  ];
  const statements = [
    ...people.map(
      ([account, name, role]) =>
        `INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES('${account}','${name}','${role}','南湖','${password}','2026-01-01T00:00:00.000Z'); INSERT INTO staff_campus_grants VALUES('${account}','南湖');`
    ),
    // This fixture deliberately assigns the reception post independently of
    // the login's legacy admin label.
    `INSERT INTO member_roles(id,member_id,role_id,scope_bindings,effective_from) VALUES('field-office-role','member-20261001','role-office','{"campuses":"bound"}','2026-01-01');`,
    `INSERT INTO member_work_profiles(id,member_id,profile_code,effective_from) VALUES('field-office-profile','member-20261001','office','2026-01-01');`,
    `INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,effective_from,created_at) VALUES('field-office-membership','member-20261001','dept-office','primary',1,'2026-01-01','2026-01-01');`,
    `INSERT INTO roster_tasks(id,week_start,slot_start,slot_end,deadline,created_at,created_by_member_id) VALUES('field-task','${day}','00:00','23:59','${at}','${at}','member-root001');`,
    `INSERT INTO roster_versions(id,task_id,status,version,rule_version,algorithm_version,created_at) VALUES('field-roster','field-task','published',1,'1.0.0','fixture','${at}');`,
    ...people.map(
      ([account]) =>
        `INSERT INTO duty_assignments(id,version_id,member_id,business_date,campus_id,duty_type,start_at,end_at) VALUES('field-shift-${account}','field-roster','member-${account}','${day}','campus-nanhu','${account === '20261001' ? 'office' : 'repair'}','00:00','23:59');`
    ),
    `INSERT INTO duty_roles(id,assignment_id,role_kind) VALUES('field-lead','field-shift-20261004','repair_lead'); INSERT INTO member_roles(id,member_id,role_id,scope_bindings,effective_from) VALUES('field-lead-role','member-20261004','role-repair-lead','{"campusIds":["campus-nanhu"]}','2026-01-01');`,
    // All-day window is an explicit local fixture, not the service's default.
    `INSERT INTO attendance_events(id,type,policy_code,policy_version,campus_id,business_date,starts_at,ends_at,created_by_member_id,created_at) VALUES('field-event','duty','duty.v1','1.0.0','campus-nanhu','${day}','${day}T00:00:00+08:00','${day}T23:59:59+08:00','member-root001','${at}');`
  ];
  if (reportDemo) {
    const currentWeek = weekRange(day).start;
    const reportDates = [
      addDays(currentWeek, -7),
      addDays(currentWeek, -6),
      currentWeek,
      addDays(currentWeek, 1)
    ].filter((date) => date <= day && date !== day);
    statements.push(
      `UPDATE members SET college='计算机科学与工程学院' WHERE id='member-20261001';`,
      `UPDATE members SET college='软件学院' WHERE id='member-20261002';`,
      `UPDATE members SET college='机械工程与自动化学院' WHERE id='member-20261003';`,
      `UPDATE members SET college='信息科学与工程学院' WHERE id='member-20261004';`
    );
    reportDates.forEach((date, index) => {
      const eventId = `report-demo-event-${index}`;
      statements.push(
        `INSERT INTO attendance_events(id,type,policy_code,policy_version,campus_id,business_date,starts_at,ends_at,created_by_member_id,created_at) VALUES('${eventId}','duty','duty.v1','1.0.0','campus-nanhu','${date}','${date}T00:00:00+08:00','${date}T23:59:59+08:00','member-root001','${at}');`
      );
      const attendees =
        index % 2 ? ['20261001', '20261002', '20261004'] : ['20261002', '20261003', '20261004'];
      attendees.forEach((account) => {
        const departmentId = account === '20261001' ? 'dept-office' : 'dept-hardware';
        const departmentName = account === '20261001' ? '办公部' : '硬件部';
        statements.push(
          `INSERT INTO attendance_records(id,member_id,event_id,dedupe_key,occurred_at,recorded_at,method,primary_department_id_snapshot,primary_department_name_snapshot,identity_snapshot) VALUES('report-demo-${index}-${account}','member-${account}','${eventId}','report-demo-${index}-${account}','${date}T10:00:00+08:00','${date}T10:00:00+08:00','manual','${departmentId}','${departmentName}','{"name":"${people.find(([id]) => id === account)[1]}","studentId":"${account}"}');`
        );
      });
      if (index === 2)
        statements.push(
          `INSERT INTO attendance_records(id,member_id,event_id,dedupe_key,occurred_at,recorded_at,method,primary_department_id_snapshot,primary_department_name_snapshot,identity_snapshot) VALUES('report-demo-repeat','member-20261002','${eventId}','report-demo-repeat','${date}T11:00:00+08:00','${date}T11:00:00+08:00','manual','dept-hardware','硬件部','{"name":"陈宇","studentId":"20261002"}');`
        );
    });
  }
  return statements.join('\n');
}
