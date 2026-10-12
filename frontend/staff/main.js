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

useStaffSession();
const controllers = { staff: initStaff(), stats: initStats(), users: initUsers(), settings:initSettings(), scan:initScan() };
let role = '', activeView = 'staff', loginGeneration = 0;
function refresh() {
  if (!role) return;
  if (!['staff','settings','scan'].includes(activeView) && !['admin', 'superadmin'].includes(role)) return;
  controllers[activeView]?.refresh();
}
const switchView = initNavigation(view => { activeView = view; controllers.scan.activate(view === 'scan'); refresh(); });
if(!initActivation()) initAuth({
  async onLogin(nextRole) {
    const current = ++loginGeneration;
    role = nextRole;
    Object.values(controllers).forEach(controller => controller.clear());
    $$('.view').forEach(view => view.classList.remove('is-active'));
    const account = sessionStorage.getItem('pioneerAccount');
    try {
      const { enabled } = await apiJson('/api/scan/config');
      if (current !== loginGeneration || account !== sessionStorage.getItem('pioneerAccount')) return;
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
    document.body.classList.remove('scan-technician');
    Object.values(controllers).forEach(controller => controller.clear());
  }
});
setInterval(refresh, 10000);
