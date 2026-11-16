import { warrantyService } from './services/warranty.js';
import { captchaBridgeOrigin } from './services/warranty/huawei.js';
import {serviceDayRepository} from './db/service-days.js';
import { verifyStaffSchema } from './db/staff-readiness.js';
import { userRepository } from './db/users.js';
import { appointmentRepository } from './db/appointments.js';
import { attachmentRepository } from './db/attachments.js';
import { bookingAvailabilityRepository } from './db/booking-availability.js';
import { statsRepository } from './db/stats.js';
import { rateLimitRepository } from './db/rate-limits.js';
import { slotCapacityRepository } from './db/slot-capacities.js';
import { authService } from './services/auth.js';
import { requireRole } from './services/permissions.js';
import { activationRepository } from './db/activation.js';
import { activationService } from './services/activation.js';
import { appointmentService } from './services/appointments.js';
import { attachmentService } from './services/attachments.js';
import { bookingAvailabilityService } from './services/booking-availability.js';
import { statsService } from './services/stats.js';
import { userService } from './services/users.js';
import { exportService } from './services/export.js';
import { rateLimitService } from './services/rate-limits.js';
import { slotCapacityService } from './services/slot-capacities.js';
import { storageLimit } from './lib/env.js';
import { staffPlatformRepository } from './db/staff-platform.js';
import { composeStaffPlatform } from './app/compose.js';
import { staffPlatformService } from './services/staff-platform.js';
import { createObservation, observedBucket, observedOperation } from './platform/observability.js';
import { observedDatabase } from './db/observed.js';
import { scanService } from './services/scan.js';
import { fieldWorkflow } from './services/field-workflow.js';
import { serviceLocationRepository } from './db/service-locations.js';
import { serviceLocationService } from './services/service-locations.js';
import { bookingSettingsRepository } from './db/booking-settings.js';
import { bookingSettingsService } from './services/booking-settings.js';

export function createContext(request, env, observation = createObservation(request, env)) {
  // Request-scoped D1 session, explicitly injected into D1 repositories. No startup I/O.
  const session = env.DB.withSession('first-primary');
  const db = observation.enabled ? observedDatabase(session, observation) : session;
  const clock = () => new Date();
  const users = userRepository(db), appointments = appointmentRepository(db);
  const staffPlatform = staffPlatformRepository(db);
  const platform = composeStaffPlatform({ repository: staffPlatform, repairs: appointments });
  const staffPlatformServiceInstance = staffPlatformService({ repository: staffPlatform, platform, manifests: platform.manifests });
  const scanSecret = env.SCAN_QR_SECRET || env.PII_ENCRYPTION_KEY;
  const field = fieldWorkflow({ repository: staffPlatform, appointments, users, staff: staffPlatformServiceInstance, authorizer: platform.authorizer,
    encryptionKey: env.PII_ENCRYPTION_KEY, secret: scanSecret });
  staffPlatformServiceInstance.field = field;
  const bookingSettings = bookingSettingsService(bookingSettingsRepository(db), staffPlatformServiceInstance, clock);
  const services = {
    auth: authService(users, env.JWT_SECRET), users: userService(users, staffPlatformServiceInstance),
    activation: activationService(activationRepository(db),users,staffPlatformServiceInstance,staffPlatform),
    appointments: appointmentService(appointments, users, env.PII_ENCRYPTION_KEY, clock, staffPlatformServiceInstance, bookingSettings),
    warranty: warrantyService({ fetcher: observation.enabled ? (...args) => observedOperation(observation, 'upstream', () => fetch(...args), { responseFailure: true }) : fetch, encryptionKey: env.PII_ENCRYPTION_KEY, captchaOrigin: captchaBridgeOrigin(env.WARRANTY_CAPTCHA_ORIGIN) === new URL(request.url).origin ? '' : env.WARRANTY_CAPTCHA_ORIGIN }),
    bookingSettings,
    attachments: attachmentService(appointments, attachmentRepository(db), observation.enabled ? observedBucket(env.ATTACHMENTS, observation) : env.ATTACHMENTS, storageLimit(env), field, observation),
    bookingAvailability: bookingAvailabilityService(bookingAvailabilityRepository(db), clock), stats: statsService(statsRepository(db), appointments, clock, staffPlatformServiceInstance),
    export: exportService(appointments, clock, field),
    limits: rateLimitService(rateLimitRepository(db), env.JWT_SECRET),
    slotCapacities: slotCapacityService(slotCapacityRepository(db), staffPlatformServiceInstance,serviceDayRepository(db)),
    staffPlatform: staffPlatformServiceInstance,
    field,
    async health() {
      const staffRelease = await verifyStaffSchema(db);
      return { ok: true, service: 'pioneer-repair-api', database: 'd1', attachments: 'r2', staffRelease, workflow: 'staff-platform' };
    }
  };
  services.scan = scanService(appointments, services.appointments, scanSecret, clock, field);
  services.serviceLocations = serviceLocationService(serviceLocationRepository(db),appointments,services.bookingAvailability,env.PII_ENCRYPTION_KEY,clock,staffPlatformServiceInstance,bookingSettings);
  let authentication;
  const authenticate = () => authentication ||= services.auth.authenticate(request.headers.get('authorization'));
  const url = new URL(request.url);
  return {
    request, url, query: Object.fromEntries(url.searchParams), services, authenticate, requestId: observation.requestId,
    observation,
    accessToken: request.headers.get('X-Appointment-Token') || '',
    async role(minimum) { return requireRole(await authenticate(), minimum); },
    async permission(code) {
      const actor = requireRole(await authenticate(), 'technician');
      return staffPlatformServiceInstance.scopedActor(actor, code);
    },
    async limit(scope, options) {
      // Supplied by Cloudflare on the edge. Missing IPs share a conservative bucket in local dev.
      await services.limits.check(request.headers.get('CF-Connecting-IP') || 'unknown', scope, options);
    }
  };
}
