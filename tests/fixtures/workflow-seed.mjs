import { hashPassword } from '../../src/lib/passwords.js';
export const WORKFLOW_TIME = '2026-10-15T02:00:00Z';
export const STAFF_PASSWORD = 'StaffTest!2026';
// Only for disposable local D1/R2. Real memberships supply reception/repair permissions; attendance and duty are independent.
export function workflowSeed(day) {
  const password = hashPassword(STAFF_PASSWORD);
  return [
    ...[
      ['20261001', '林悦', '南湖', 'dept-office', 'head'],
      ['20261002', '陈宇', '南湖', 'dept-network', 'member'],
      ['20261003', '周宁', '南湖', 'dept-hardware', 'member'],
      ['20261004', '许晨', '浑南', 'dept-art', 'member']
    ].map(
      ([account, name, campus, department, position]) => `
 INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES('${account}','${name}','technician','${campus}','${password}','2026-01-01');
 INSERT INTO staff_campus_grants VALUES('${account}','${campus}');
 INSERT INTO member_department_memberships(id,member_id,department_id,position_code,assignment_type,is_primary,effective_from,created_at) VALUES('post-${account}','member-${account}','${department}','${position}','primary',1,'2026-01-01','2026-01-01');`
    ),
    "INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,effective_from,created_at) VALUES('affairs-20261001','member-20261001','dept-office','maintenance_affairs',0,'2026-01-01','2026-01-01');",
    "INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,effective_from,created_at) VALUES('affairs-20261002','member-20261002','dept-network','maintenance_affairs',0,'2026-01-01','2026-01-01'),('exchange-20261002','member-20261002','dept-hardware','exchange',0,'2026-01-01','2026-01-01');",
    ...['南湖', '浑南'].map(
      (campus) =>
        `INSERT INTO service_locations(campus,date,location,updated_at) VALUES('${campus}','${day}','${campus}测试维修室','${day}');`
    )
  ].join('\n');
}
