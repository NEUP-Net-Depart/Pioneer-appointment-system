import { initNavigation } from '/shared/navigation.js';
import { useStaffSession, apiJson } from '/shared/api.js';
import { $, $$, showToast } from '/shared/utils.js';
import { initAuth } from './auth.js';
import { initActivation } from './activation.js';
import { initStaff } from './staff.js';
import { initStats } from './stats.js';
import { initUsers } from './users.js';
import { initSettings } from './settings.js';
import { initScan } from './scan.js';
import { initWorkbench } from './workbench.js';

useStaffSession();
const controllers = { staff: initStaff(), stats: initStats(), users: initUsers(), settings:initSettings(), scan:initScan() };
let role = '', activeView = 'staff', loginGeneration = 0, scanEnabled = false, workbenchSettings = false;
function refresh() {
  if (!role) return;
  if (!['staff','settings','scan'].includes(activeView) && !['admin', 'superadmin'].includes(role)) return;
  controllers[activeView]?.refresh();
}
const workbench = initWorkbench({
  onSettings() { workbenchSettings = true; switchView('settings'); $('#current-password').focus(); },
  onAdmin() { workbenchSettings = false; switchView('staff'); },
  onBack() { workbenchSettings = false; switchView('scan'); },
  onOverlay(open) { controllers.scan.activate(!open && activeView === 'scan'); }
});
const switchView = initNavigation(view => {
  activeView = view;
  const personal = view === 'settings' && scanEnabled && (role === 'technician' || workbenchSettings);
  workbench.show(view === 'scan' || personal, personal);
  controllers.scan.activate(view === 'scan'); refresh();
}, view => {
  if (!role) return false;
  if (view === 'scan') return scanEnabled;
  if (view === 'settings') return true;
  return ['admin', 'superadmin'].includes(role) || (view === 'staff' && !scanEnabled);
});
if(!initActivation()) initAuth({
  async onLogin(nextRole, user) {
    const current = ++loginGeneration;
    role = nextRole;
    scanEnabled = false; workbenchSettings = false;
    workbench.profile(user);
    Object.values(controllers).forEach(controller => controller.clear());
    $$('.view').forEach(view => view.classList.remove('is-active'));
    const account = sessionStorage.getItem('pioneerAccount');
    try {
      const { enabled } = await apiJson('/api/scan/config');
      if (current !== loginGeneration || account !== sessionStorage.getItem('pioneerAccount')) return;
      scanEnabled = enabled;
      $('[data-view-link="scan"]').hidden = !enabled;
      $('[data-view-link="staff"]').hidden = enabled && role === 'technician';
      document.body.classList.toggle('scan-technician', enabled && role === 'technician');
      const unfinished = enabled && await controllers.scan.restore();
      if (current !== loginGeneration || account !== sessionStorage.getItem('pioneerAccount')) return;
      switchView(enabled && (role === 'technician' || unfinished) ? 'scan' : 'staff');
    } catch (error) { showToast('工作台配置读取失败，请刷新重试：' + error.message); }
  },
  onLogout() {
    loginGeneration++;
    role = '';
    scanEnabled = false; workbenchSettings = false; workbench.clear();
    document.body.classList.remove('scan-technician');
    Object.values(controllers).forEach(controller => controller.clear());
  }
});
setInterval(refresh, 10000);
