import { initNavigation } from '/shared/navigation.js';
import { useStaffSession } from '/shared/api.js';
import { initAuth } from './auth.js';
import { initActivation } from './activation.js';
import { initStaff } from './staff.js';
import { initStats } from './stats.js';
import { initUsers } from './users.js';
import { initSettings } from './settings.js';
import { initStaffHost } from './app-shell.js';
import { initScan } from './scan.js';
import { initWorkbench } from './workbench.js';

// One session and navigation lifecycle for both DOM and React feature modules.
export function initStaffApplication({ onSession, onView, onLogout }) {
  useStaffSession();
  const host = initStaffHost();
  const controllers = { staff: initStaff(), stats: initStats(), users: initUsers(), settings: initSettings(), scan: initScan() };
  let role = '', activeView = 'staff', scanReady = false;
  const platform = document.getElementById('staff-platform-view');
  const platformLinks = [...document.querySelectorAll('[data-platform-permission]')];
  const workbench = initWorkbench({
    onSettings: () => navigate('settings'), onAdmin: () => navigate('staff'),
    onBack: () => navigate('scan'), onOverlay: open => controllers.scan.activate(!open && activeView === 'scan')
  });
  const nativeSwitch = initNavigation(view => {
    activeView = view;
    workbench.show(view === 'scan');
    controllers.scan.activate(view === 'scan' && !document.body.classList.contains('staff-workspace-enabled'));
    onView(view);
    if (view === 'scan' && !scanReady) {
      scanReady = true;
      controllers.scan.restore().then(() => controllers.scan.activate(activeView === 'scan'));
    } else refresh();
  });
  function refresh() {
    if (!role || document.hidden || document.body.classList.contains('staff-workspace-enabled')) return;
    if (['staff', 'stats', 'settings', 'users'].includes(activeView) && document.body.classList.contains('field-mode')) return;
    if (!['staff', 'settings', 'scan'].includes(activeView) && !['admin', 'superadmin'].includes(role)) return;
    controllers[activeView]?.refresh();
  }
  function navigate(view) {
    const link = document.querySelector(`[data-view-link="${view}"]`);
    if (!role || !link || link.hidden) return;
    if (link.dataset.platformPermission) platform.dataset.view = view;
    nativeSwitch(view);
  }
  function requestNavigation(event) { navigate(event.detail); }
  function profile(event) {
    if (!role) return;
    const user = event.detail;
    workbench.profile(user);
    for (const link of platformLinks) link.hidden = link.dataset.viewLink !== 'workbench' && !(user.grants || []).some(grant => grant.permissionCode === link.dataset.platformPermission);
    if (platformLinks.some(link => link.dataset.viewLink === activeView && link.hidden)) navigate('staff');
    onSession(user);
  }
  window.addEventListener('staff-context-ready', profile);
  window.addEventListener('staff-navigate', requestNavigation);
  // Registered React modules share a single mount and the operational navigator.
  for (const link of platformLinks) link.addEventListener('click', () => {
    platform.dataset.view = link.dataset.viewLink;
    nativeSwitch(link.dataset.viewLink);
  });
  if (!initActivation()) initAuth({
    onLogin(nextRole) {
      role = nextRole; scanReady = false;
      Object.values(controllers).forEach(controller => controller.clear());
      nativeSwitch('staff');
    },
    onLogout() {
      role = ''; scanReady = false; workbench.clear();
      Object.values(controllers).forEach(controller => controller.clear());
      for (const link of platformLinks) link.hidden = true;
      onLogout();
    }
  });
  const timer = setInterval(refresh, 10000);
  return { dispose() {
    clearInterval(timer); host.dispose();
    controllers.scan.clear();
    controllers.settings.dispose();
    window.removeEventListener('staff-context-ready', profile);
    window.removeEventListener('staff-navigate', requestNavigation);
  } };
}
