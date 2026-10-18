import { initNavigation } from '/shared/navigation.js';
import { useStaffSession, apiJson } from '/shared/api.js';
import { $, $$, showToast } from '/shared/utils.js';
import { initAuth } from './auth.js';
import { initActivation } from './activation.js';
import { initStaff } from './staff.js';
import { initStats } from './stats.js';
import { initUsers } from './users.js';
import { initSettings } from './settings.js';
import { initStaffHost } from './app-shell.js';
import { initScan } from './scan.js';
import { initWorkbench } from './workbench.js';
import { staffViewAllowed } from '/shared/staff-access.js';
import { initInputLimits } from '/shared/input-limits.js';

// One session and navigation lifecycle for both DOM and React feature modules.
export function initStaffApplication({ onSession, onView, onLogout }) {
  useStaffSession();
  initInputLimits();
  const host = initStaffHost();
  const controllers = { staff: initStaff(), stats: initStats(), users: initUsers(), settings: initSettings(), scan: initScan() };
  let role = '', activeView = 'staff', scanReady = false, currentUser = null, loginGeneration = 0, scanEnabled = false, workbenchSettings = false;
  const platform = document.getElementById('staff-platform-view');
  const platformLinks = [...document.querySelectorAll('[data-platform-permission]')];
  const workbench = initWorkbench({
    onSettings: () => { workbenchSettings = true; navigate('settings'); $('#current-password').focus(); },
    onAdmin: () => { workbenchSettings = false; navigate('staff'); },
    onBack: () => { workbenchSettings = false; navigate('scan'); }, onOverlay: open => controllers.scan.activate(!open && activeView === 'scan')
  });
  const nativeSwitch = initNavigation(view => {
    activeView = view;
    const personal = view === 'settings' && scanEnabled && (role === 'technician' || workbenchSettings);
    workbench.show(view === 'scan' || personal, personal);
    controllers.scan.activate(view === 'scan' && !document.body.classList.contains('staff-workspace-enabled'));
    onView(view);
    if (view === 'scan' && !scanReady) {
      scanReady = true;
      controllers.scan.restore().then(() => controllers.scan.activate(activeView === 'scan'));
    } else refresh();
  }, view => {
    if (!role) return false;
    if (currentUser?.staffWorkflowEnabled) return staffViewAllowed(currentUser, view);
    if (view === 'scan') return scanEnabled;
    if (view === 'settings') return true;
    if (platformLinks.some(link => link.dataset.viewLink === view)) return true;
    return ['admin', 'superadmin'].includes(role) || (view === 'staff' && !scanEnabled);
  });
  function refresh() {
    if (!role || document.hidden || document.body.classList.contains('staff-workspace-enabled')) return;
    if (['staff', 'stats', 'settings', 'users'].includes(activeView) && document.body.classList.contains('field-mode')) return;
    if (!['staff', 'settings', 'scan'].includes(activeView) && !['admin', 'superadmin'].includes(role)) return;
    controllers[activeView]?.refresh();
  }
  function navigate(view) {
    if (currentUser?.staffWorkflowEnabled && !staffViewAllowed(currentUser, view)) return;
    // Enabled React routes do not need a hidden legacy DOM link to exist.
    if(currentUser?.staffWorkflowEnabled){activeView=view;onView(view);return;}
    const link = document.querySelector(`[data-view-link="${view}"]`);
    if (!role || !link || link.hidden) return;
    if (link.dataset.platformPermission) platform.dataset.view = view;
    nativeSwitch(view);
  }
  function requestNavigation(event) { navigate(event.detail); }
  function profile(event) {
    if (!role) return;
    const user = event.detail;
    currentUser = user;
    workbench.profile(user);
    for (const link of platformLinks) link.hidden = link.dataset.viewLink !== 'workbench' && (user.staffWorkflowEnabled
      ? !staffViewAllowed(user, link.dataset.viewLink)
      : !(user.grants || []).some(grant => grant.permissionCode === link.dataset.platformPermission));
    if (currentUser.staffWorkflowEnabled && !staffViewAllowed(user, activeView)) navigate('workbench');
    else if (platformLinks.some(link => link.dataset.viewLink === activeView && link.hidden)) navigate('staff');
    onSession(user);
  }
  window.addEventListener('staff-context-ready', profile);
  window.addEventListener('staff-navigate', requestNavigation);
  // Registered React modules share a single mount and the operational navigator.
  for (const link of platformLinks) link.addEventListener('click', () => {
    if (link.hidden || currentUser?.staffWorkflowEnabled && !staffViewAllowed(currentUser, link.dataset.viewLink)) return;
    platform.dataset.view = link.dataset.viewLink;
    nativeSwitch(link.dataset.viewLink);
  });
  if (!initActivation()) initAuth({
    async onLogin(nextRole, user) {
      const current = ++loginGeneration;
      role = nextRole; currentUser = user; scanReady = false; scanEnabled = false; workbenchSettings = false;
      Object.values(controllers).forEach(controller => controller.clear());
      if (user.staffWorkflowEnabled) { navigate('workbench'); return; }
      workbench.profile(user);
      $$('.view').forEach(view => view.classList.remove('is-active'));
      const account = sessionStorage.getItem('pioneerAccount');
      try {
        const { enabled } = await apiJson('/api/scan/config');
        if (current !== loginGeneration || account !== sessionStorage.getItem('pioneerAccount')) return;
        scanEnabled = enabled;
        $('[data-view-link="scan"]').hidden = !enabled;
        $('[data-view-link="staff"]').hidden = enabled && role === 'technician';
        document.body.classList.toggle('scan-technician', enabled && role === 'technician');
        const unfinished = enabled && await controllers.scan.restore(); scanReady = enabled;
        if (current !== loginGeneration || account !== sessionStorage.getItem('pioneerAccount')) return;
        nativeSwitch(enabled && (role === 'technician' || unfinished) ? 'scan' : 'staff');
      } catch (error) { showToast('工作台配置读取失败，请刷新重试：' + error.message); }
    },
    onLogout() {
      loginGeneration++; role = ''; scanReady = false; currentUser = null; scanEnabled = false; workbenchSettings = false; workbench.clear();
      document.body.classList.remove('scan-technician');
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
