import type { StaffAccountDto } from '../../shared/staff-types.ts';
import type { Database } from '../../src/platform/environment.ts';
import { staffPlatformRepository } from '../../src/db/staff-platform.ts';
import { appointmentRepository } from '../../src/db/appointments.ts';
import { composeStaffPlatform } from '../../src/app/compose.ts';
import { staffPlatformService } from '../../src/services/staff-platform.ts';
import { fieldWorkflow } from '../../src/services/field-workflow.ts';

export function staffServices(db: Database, encryptionKey: string, secret = 'test-qr-secret') {
  const repository = staffPlatformRepository(db), appointments = appointmentRepository(db);
  const platform = composeStaffPlatform({ repository, repairs: appointments });
  const staff = staffPlatformService({ repository, platform, manifests: platform.manifests });
  const field = fieldWorkflow({ repository, appointments, staff, authorizer: platform.authorizer, encryptionKey, secret });
  return { ...staff, field };
}


export function staffActor(overrides: Partial<StaffAccountDto> = {}): StaffAccountDto {
  return {
    account: 'staff', memberId: 'member-staff', name: '测试工作人员', role: 'technician',
    status: 'enabled', homeCampus: '南湖', authorizedCampuses: ['南湖'], authVersion: 0,
    ...overrides
  };
}
