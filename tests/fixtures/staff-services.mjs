import { staffPlatformRepository } from '../../src/db/staff-platform.js';
import { appointmentRepository } from '../../src/db/appointments.js';
import { userRepository } from '../../src/db/users.js';
import { composeStaffPlatform } from '../../src/app/compose.js';
import { staffPlatformService } from '../../src/services/staff-platform.js';
import { fieldWorkflow } from '../../src/services/field-workflow.js';

export function staffServices(db, encryptionKey, secret = 'test-qr-secret') {
  const repository = staffPlatformRepository(db), appointments = appointmentRepository(db);
  const platform = composeStaffPlatform({ repository, repairs: appointments });
  const staff = staffPlatformService({ repository, platform, manifests: platform.manifests });
  staff.field = fieldWorkflow({ repository, appointments, users: userRepository(db), staff, authorizer: platform.authorizer, encryptionKey, secret });
  return staff;
}

// Existing appointment regression scenarios assume a member is ready to work.
// Seed those facts explicitly; the service still enforces every eligibility rule.
export async function readyStaff(db, account, day) {
  const row = await db.prepare('SELECT member_id FROM staff_accounts WHERE account=?').bind(account).first();
  if (!row) return;
  await db.prepare(`INSERT OR IGNORE INTO member_work_profiles(id,member_id,profile_code,effective_from)
    VALUES(?,?,'repair','2026-01-01')`).bind(`integration-repair-${row.member_id}`, row.member_id).run();
  await db.prepare(`INSERT OR IGNORE INTO attendance_events(id,type,policy_code,policy_version,campus_id,business_date,starts_at,ends_at,created_by_member_id,created_at)
    VALUES(?,'duty','duty.v1','1.0.0','campus-nanhu',?,?,?,?,?)`)
    .bind(`integration-duty-${day}`, day, `${day}T00:00:00+08:00`, `${day}T23:59:59+08:00`, row.member_id, `${day}T00:00:00Z`).run();
  await db.prepare(`INSERT INTO staff_presence(member_id,business_date,campus_id,state,updated_at)
    VALUES(?,?,'campus-nanhu','available',?) ON CONFLICT(member_id,business_date) DO NOTHING`)
    .bind(row.member_id, day, `${day}T00:00:00Z`).run();
}

export async function grantTestManagement(db, account) {
  await db.prepare(`INSERT OR IGNORE INTO member_roles(id,member_id,role_id,scope_bindings,effective_from)
    SELECT 'integration-manager-'||account,member_id,'role-repair-lead','{"campuses":"bound"}','2026-01-01'
    FROM staff_accounts WHERE account=?`).bind(account).run();
}
