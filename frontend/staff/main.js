import { initNavigation } from '/shared/navigation.js';
import { useStaffSession } from '/shared/api.js';
import { initAuth } from './auth.js';
import { initStaff } from './staff.js';
import { initStats } from './stats.js';
import { initUsers } from './users.js';
import { initSettings } from './settings.js';

useStaffSession();
const controllers = { staff: initStaff(), stats: initStats(), users: initUsers(), settings:initSettings() };
let role = '', activeView = 'staff';
function refresh() {
  if (!role) return;
  if (!['staff','settings'].includes(activeView) && !['admin', 'superadmin'].includes(role)) return;
  controllers[activeView]?.refresh();
}
const switchView = initNavigation(view => { activeView = view; refresh(); });
initAuth({
  onLogin(nextRole) {
    role = nextRole;
    Object.values(controllers).forEach(controller => controller.clear());
    switchView('staff');
  },
  onLogout() {
    role = '';
    Object.values(controllers).forEach(controller => controller.clear());
  }
});
setInterval(refresh, 10000);
