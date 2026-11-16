import { readFile, readdir } from 'node:fs/promises';
import { migrationStatements } from './staff-cutover.mjs';

export async function seedSqlProfile(db, accounts) {
  for (const name of (await readdir('migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = await readFile(`migrations/${name}`, 'utf8');
    await db.batch(migrationStatements(sql).map((statement) => db.prepare(statement)));
  }
  const numbers = (count) =>
    `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<${count})`;
  // Inserts use the production triggers that connect accounts and members.
  await db
    .prepare(
      `${numbers(accounts)} INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at)
    SELECT CAST(20260000+x AS TEXT),'SQL fixture','technician','南湖','unused','2000-01-01' FROM n`
    )
    .run();
  await db
    .prepare(
      "INSERT INTO staff_campus_grants(account,campus) SELECT account,'南湖' FROM staff_accounts"
    )
    .run();
  await db
    .prepare(
      `INSERT INTO member_department_memberships(id,member_id,department_id,position_code,assignment_type,is_primary,effective_from,created_at)
    SELECT 'post-'||account,member_id,CASE WHEN account='20260002' THEN 'unit-device' ELSE 'dept-hardware' END,
      CASE WHEN account='20260002' THEN 'director' ELSE 'member' END,'primary',1,'2000-01-01','2000-01-01' FROM staff_accounts`
    )
    .run();
  await db
    .prepare(
      `INSERT INTO service_locations(campus,date,location,updated_at) VALUES
    ('南湖','2026-11-05','SQL fixture','2026-01-01'),('浑南','2026-11-05','SQL fixture','2026-01-01')`
    )
    .run();
  // Grow both unrelated history and same-day work in the other campus. Target
  // campus occupancy remains constant, so scans cannot hide in empty fixtures.
  await db
    .prepare(
      `${numbers(accounts * 20)} INSERT INTO appointments(
    id,student_id,name,campus,social,device_type,brand,device_model,warranty,fault_type,date,time_slot,
    status,outcome,source,expires_at,access_token_hash,credential_rotated_at,created_at,agreement_at,agreement_version)
    SELECT 'noise-'||x,'student-'||x,'SQL fixture',CASE WHEN x%2=0 THEN '浑南' ELSE '南湖' END,
      '','笔记本','Lenovo','','unknown','系统',CASE WHEN x%2=0 THEN '2026-11-05' ELSE '2020-01-01' END,
      '19:00–19:30','completed','unrepaired','onsite','2026-11-05T16:00:00.000Z',printf('%064d',x),
      '2020-01-01','2020-01-01','2020-01-01','fixture' FROM n`
    )
    .run();
  await db
    .prepare(
      `INSERT INTO appointments(id,student_id,name,campus,social,device_type,brand,device_model,
    warranty,fault_type,date,time_slot,status,expires_at,access_token_hash,credential_rotated_at,created_at,agreement_at,agreement_version)
    VALUES('target-booking','target-student','SQL fixture','南湖','','笔记本','Lenovo','','unknown','系统',
      '2026-11-05','19:00–19:30','booked','2026-11-05T16:00:00.000Z',printf('%064d',999999),'2026-11-05','2026-11-05','2026-11-05','fixture')`
    )
    .run();
}
