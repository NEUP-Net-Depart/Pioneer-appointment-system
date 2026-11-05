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

