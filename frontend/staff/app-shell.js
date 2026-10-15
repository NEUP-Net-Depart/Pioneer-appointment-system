import { apiJson } from '/shared/api.js';
import { normalizeAuthContext } from '/shared/contracts/staff-platform.js';

// The staff host owns routing, authorization context and module mounting. A
// module only supplies a route, navigation item and resumable tasks; business
// state remains behind its API. Keeping this boundary small makes the current
// DOM screens and future React feature bundles interchangeable.
export function queryKey({ memberId = '', authVersion = 0, module = '', resource = '', filters = {} } = {}) {
  return JSON.stringify([memberId, authVersion, module, resource, Object.keys(filters).sort().map(key => [key, filters[key]])]);
}

export function createModuleRegistry(entries = []) {
  const byPath = Object.fromEntries(entries.filter(entry => entry?.path).map(entry => [entry.path, entry]));
  return { entries, resolve(path) { return byPath[path] || null; } };
}

export function createStaffHost({ documentRef = document, windowRef = window } = {}) {
  let context = null;
  let registry = createModuleRegistry([]);
  let disposed = false;

  function renderNavigation() {
    const nav = documentRef.querySelector('.main-nav');
    if (!nav || !context) return;
    nav.querySelectorAll('[data-generated-module]').forEach(node => node.remove());
    for (const item of context.navigation || []) {
      if ([...nav.querySelectorAll('[data-view-link]')].some(node => node.dataset.viewLink === item.id || node.dataset.platformModule === item.id)) continue;
      // Publish only registered screens; a manifest alone is not a mounted UI.
      if (!documentRef.querySelector(`[data-view="${item.id}"]`)) continue;
      const button = documentRef.createElement('button');
      button.type = 'button'; button.className = 'nav-link'; button.dataset.viewLink = item.id; button.dataset.generatedModule = 'true';
      button.textContent = item.title; button.title = `${item.module || 'module'} · ${item.moduleVersion || ''}`;
      button.addEventListener('click', () => windowRef.history.pushState({ path: item.path }, '', item.path));
      nav.append(button);
    }
    registry = createModuleRegistry(context.navigation || []);
  }

  function renderResumeTasks() {
    const shell = documentRef.querySelector('#app-shell');
    if (!shell || !context) return;
    let region = shell.querySelector('[data-resume-tasks]');
    if (!region) { region = documentRef.createElement('section'); region.dataset.resumeTasks = 'true'; region.className = 'staff-resume-tasks'; shell.querySelector('main')?.prepend(region); }
    region.replaceChildren();
    for (const task of context.resumeTasks || []) {
      const link = documentRef.createElement('a'); link.href = task.path || '#'; link.textContent = task.title || '继续处理'; link.dataset.module = task.module || '';
      region.append(link);
    }
    region.hidden = !(context.resumeTasks || []).length;
  }

  async function refresh() {
    const token = sessionStorage.getItem('pioneerToken');
    if (disposed || !token) return null;
    // The legacy staff screen can continue to operate when a context refresh
    // is unavailable (for example while a deployment is warming up). A
    // rejected context request must not revoke the freshly established login;
    // auth.js owns session expiry and will handle it on its own request.
    const payload = await apiJson('/api/auth/me', { suppressAuthExpired: true });
    if (disposed || sessionStorage.getItem('pioneerToken') !== token) return null;
    context = { ...payload, ...normalizeAuthContext(payload) };
    renderNavigation(); renderResumeTasks();
    windowRef.dispatchEvent(new CustomEvent('staff-context-ready', { detail: context }));
    return context;
  }

  function dispose() { disposed = true; windowRef.removeEventListener('staff-session-ready', sessionReady); windowRef.removeEventListener('auth-expired', clearContext); }
  function sessionReady() { refresh().catch(() => {}); }
  function clearContext() { context = null; registry = createModuleRegistry([]); }
  windowRef.addEventListener('staff-session-ready', sessionReady);
  windowRef.addEventListener('auth-expired', clearContext);
  refresh().catch(() => {});
  return { refresh, dispose, get context() { return context; }, get registry() { return registry; }, queryKey };
}

export function initStaffHost(options) { return createStaffHost(options); }
