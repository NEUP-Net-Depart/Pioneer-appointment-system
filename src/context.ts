import type { StaffRole } from '../shared/staff-types.ts';
import type { RateLimitScope } from './services/rate-limits.ts';
import type { PioneerEnvironment } from './platform/environment.ts';
import { warrantyService } from './services/warranty.ts';
import { captchaBridgeOrigin } from './services/warranty/huawei.ts';
import {serviceDayRepository} from './db/service-days.ts';
import { verifyStaffSchema } from './db/staff-readiness.ts';
import { userRepository } from './db/users.ts';
import { appointmentRepository } from './db/appointments.ts';
import { attachmentRepository } from './db/attachments.ts';
import { bookingAvailabilityRepository } from './db/booking-availability.ts';
import { statsRepository } from './db/stats.ts';
import { rateLimitRepository } from './db/rate-limits.ts';
import { slotCapacityRepository } from './db/slot-capacities.ts';
import { authService } from './services/auth.ts';
import { requireRole } from './services/permissions.ts';
import { activationRepository } from './db/activation.ts';
import { activationService } from './services/activation.ts';
import { appointmentService } from './services/appointments.ts';
import { attachmentService } from './services/attachments.ts';
import { bookingAvailabilityService } from './services/booking-availability.ts';
import { statsService } from './services/stats.ts';
import { userService } from './services/users.ts';
import { exportService } from './services/export.ts';
import { rateLimitService } from './services/rate-limits.ts';
import { slotCapacityService } from './services/slot-capacities.ts';
import { storageLimit } from './lib/env.ts';
import { staffPlatformRepository } from './db/staff-platform.ts';
import { composeStaffPlatform } from './app/compose.ts';
import { staffPlatformService } from './services/staff-platform.ts';
import { createObservation, observedBucket, observedOperation } from './platform/observability.ts';
import { observedDatabase } from './db/observed.ts';
import { scanService } from './services/scan.ts';
import { fieldWorkflow } from './services/field-workflow.ts';
import { serviceLocationRepository } from './db/service-locations.ts';
import { serviceLocationService } from './services/service-locations.ts';
import { bookingSettingsRepository } from './db/booking-settings.ts';
import { bookingSettingsService } from './services/booking-settings.ts';

export function createContext(request: Request, env: PioneerEnvironment, observation = createObservation(request, env)) {
  // Request-scoped D1 session, explicitly injected into D1 repositories. No startup I/O.
  const session = env.DB.withSession('first-primary');
  const db = observation.enabled ? observedDatabase(session, observation) : session;
  const clock = () => new Date();
  const users = userRepository(db), appointments = appointmentRepository(db);
  const staffPlatform = staffPlatformRepository(db);
  const platform = composeStaffPlatform({ repository: staffPlatform, repairs: appointments });
  const staffService = staffPlatformService({ repository: staffPlatform, platform, manifests: platform.manifests });
  const scanSecret = env.SCAN_QR_SECRET || env.PII_ENCRYPTION_KEY;
  const field = fieldWorkflow({ repository: staffPlatform, appointments, staff: staffService, authorizer: platform.authorizer,
    encryptionKey: env.PII_ENCRYPTION_KEY, secret: scanSecret });
  const staff = { ...staffService, field };
  const auth = authService(users, env.JWT_SECRET);
  const bookingSettings = bookingSettingsService(bookingSettingsRepository(db), staff, clock);
  const bookingAvailability = bookingAvailabilityService(bookingAvailabilityRepository(db), clock);
  const repairs = appointmentService(appointments, env.PII_ENCRYPTION_KEY, clock, staff, bookingSettings);
  const services = {
    auth,
    users: userService(users, staff),
    activation: activationService(activationRepository(db), users, staff, staffPlatform),
    appointments: repairs,
    scan: scanService(appointments, repairs, scanSecret, clock, field),
    warranty: warrantyService({ fetcher: observation.enabled ? (...args) => observedOperation(observation, 'upstream', () => fetch(...args), { responseFailure: true }) : fetch, encryptionKey: env.PII_ENCRYPTION_KEY, captchaOrigin: captchaBridgeOrigin(env.WARRANTY_CAPTCHA_ORIGIN) === new URL(request.url).origin ? '' : env.WARRANTY_CAPTCHA_ORIGIN }),
    bookingSettings,
    attachments: attachmentService(appointments, attachmentRepository(db), observation.enabled ? observedBucket(env.ATTACHMENTS, observation) : env.ATTACHMENTS, storageLimit(env), field, observation),
    bookingAvailability,
    serviceLocations: serviceLocationService(serviceLocationRepository(db), appointments, bookingAvailability, env.PII_ENCRYPTION_KEY, clock, staff, bookingSettings),
    stats: statsService(statsRepository(db), appointments, clock, staff),
    export: exportService(appointments, clock, field),
    limits: rateLimitService(rateLimitRepository(db), env.JWT_SECRET),
    slotCapacities: slotCapacityService(slotCapacityRepository(db), staff, serviceDayRepository(db)),
    staffPlatform: staff,
    field,
    async health() {
      const staffRelease = await verifyStaffSchema(db);
      return { ok: true, service: 'pioneer-repair-api', database: 'd1', attachments: 'r2', staffRelease, workflow: 'staff-platform' };
    }
  };
  let authentication: ReturnType<typeof auth.authenticate> | undefined;
  const authenticate = () => authentication ??= auth.authenticate(request.headers.get('authorization'));
  const url = new URL(request.url);
  return {
    request, url, query: Object.fromEntries(url.searchParams), services, authenticate, requestId: observation.requestId,
    observation,
    accessToken: request.headers.get('X-Appointment-Token') || '',
    async role(minimum: StaffRole) { return requireRole(await authenticate(), minimum); },
    async permission(code: string) {
      const actor = requireRole(await authenticate(), 'technician');
      return staff.scopedActor(actor, code);
    },
    async limit(scope: RateLimitScope, options?: { consume?: boolean }) {
      // Supplied by Cloudflare on the edge. Missing IPs share a conservative bucket in local dev.
      await services.limits.check(request.headers.get('CF-Connecting-IP') || 'unknown', scope, options);
    }
  };
}
