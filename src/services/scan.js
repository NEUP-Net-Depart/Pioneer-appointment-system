import { fail } from '../lib/http.js';

// Compatibility adapter for the scan module contract. Live routes use the
// appointment service directly, while this keeps the PR #35 service surface
// available to module checks and downstream callers.
export function scanService(_appointments, service, _encryptionKey, _secret, enabled = true) {
  function available() { if (!enabled) fail(404, '扫码工作台未启用'); }
  return {
    config() { return { enabled }; },
    async code(id, token) { available(); return service.scanCode(id, token); },
    async resolve(input, actor) { available(); return service.resolveScan(input?.code || input?.id, actor); },
    async current(actor) { available(); return { item: await service.current(actor) }; },
    async onsite(input, actor) { available(); return service.createOnsite(input, actor); }
  };
}
