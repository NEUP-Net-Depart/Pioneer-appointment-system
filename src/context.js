import { userRepository } from './db/users.js';
import { appointmentRepository } from './db/appointments.js';
import { attachmentRepository } from './db/attachments.js';
import { queueRepository } from './db/queue.js';
import { statsRepository } from './db/stats.js';
import { rateLimitRepository } from './db/rate-limits.js';
import { slotCapacityRepository } from './db/slot-capacities.js';
import { authService } from './services/auth.js';
import { requireRole } from './services/permissions.js';
import { activationRepository } from './db/activation.js';
import { activationService } from './services/activation.js';
import { appointmentService } from './services/appointments.js';
import { attachmentService } from './services/attachments.js';
import { queueService } from './services/queue.js';
import { statsService } from './services/stats.js';
import { userService } from './services/users.js';
import { exportService } from './services/export.js';
import { rateLimitService } from './services/rate-limits.js';
import { slotCapacityService } from './services/slot-capacities.js';
import { storageLimit } from './lib/env.js';
import { staffPlatformRepository } from './db/staff-platform.js';
import { composeStaffPlatform } from './app/compose.js';
import { staffPlatformService } from './services/staff-platform.js';
import { requestTrace } from './platform/observability.js';
import { scanService } from './services/scan.js';
import { fieldWorkflow } from './services/field-workflow.js';

export function createContext(request, env) {
  // Request-scoped D1 session, explicitly injected into D1 repositories. No startup I/O.
  const db = env.DB.withSession('first-primary');
  const users = userRepository(db), appointments = appointmentRepository(db, { workflowSchema: env.STAFF_WORKFLOW_ENABLED === 'true' });
  const staffPlatform = staffPlatformRepository(db);
  const platform = composeStaffPlatform({ repository: staffPlatform, repairs: appointments });
  const staffPlatformServiceInstance = staffPlatformService({ repository: staffPlatform, platform, manifests: platform.manifests });
  const field = fieldWorkflow({ repository: staffPlatform, appointments, users, staff: staffPlatformServiceInstance, authorizer: platform.authorizer,
    encryptionKey: env.PII_ENCRYPTION_KEY, secret: env.JWT_SECRET, enabled: env.STAFF_WORKFLOW_ENABLED === 'true' });
  staffPlatformServiceInstance.field = field;
  const services = {
    auth: authService(users, env.JWT_SECRET), users: userService(users),
    activation: activationService(activationRepository(db),users),
    appointments: appointmentService(appointments, users, env.PII_ENCRYPTION_KEY, undefined, staffPlatformServiceInstance),
    attachments: attachmentService(appointments, attachmentRepository(db), env.ATTACHMENTS, storageLimit(env), field),
    queue: queueService(appointments, queueRepository(db)), stats: statsService(statsRepository(db), appointments),
    export: exportService(appointments, env.PII_ENCRYPTION_KEY, undefined, field),
    limits: rateLimitService(rateLimitRepository(db), env.JWT_SECRET),
    slotCapacities: slotCapacityService(slotCapacityRepository(db)),
    staffPlatform: staffPlatformServiceInstance,
    field,
    async health() { await Promise.all([users.health(), env.ATTACHMENTS.list({ limit: 1 })]); return { ok: true, service: 'pioneer-repair-api', database: 'd1', attachments: 'r2' }; }
  };
  services.scan = scanService(appointments, services.appointments, env.PII_ENCRYPTION_KEY, env.JWT_SECRET, env.SCAN_WORKBENCH_ENABLED !== 'false', undefined, field);
  let authentication;
  const authenticate = () => authentication ||= services.auth.authenticate(request.headers.get('authorization'));
  const url = new URL(request.url);
  return {
    request, url, query: Object.fromEntries(url.searchParams), services, authenticate, requestId: requestTrace(request),
    observe(record) { if (env.OBSERVABILITY_LOGS === 'true') console.log(JSON.stringify(record)); },
    accessToken: request.headers.get('X-Appointment-Token') || '',
    async role(minimum) { return requireRole(await authenticate(), minimum); },
    async limit(scope, options) {
      // Supplied by Cloudflare on the edge. Missing IPs share a conservative bucket in local dev.
      await services.limits.check(request.headers.get('CF-Connecting-IP') || 'unknown', scope, options);
    }
  };
}
