import { initNavigation } from '/shared/navigation.js';
import { useStaffSession } from '/shared/api.js';
import { initAuth } from './auth.js';
import { initStaff } from './staff.js';
import { initStats } from './stats.js';
import { initUsers } from './users.js';

useStaffSession();
const controllers = { staff: initStaff(), stats: initStats(), users: initUsers() };
let role = '', activeView = 'staff';
function refresh() {
  if (!role || role === 'student') return;
  if (activeView !== 'staff' && !['admin', 'superadmin'].includes(role)) return;
  controllers[activeView]?.refresh();
}
const switchView = initNavigation(view => { activeView = view; refresh(); });
initAuth({
  onLogin(nextRole) {
    role = nextRole;
    Object.values(controllers).forEach(controller => controller.clear());
    switchView(role === 'student' ? 'pending-access' : 'staff');
  },
  onLogout() {
    role = '';
    Object.values(controllers).forEach(controller => controller.clear());
  }
});
setInterval(refresh, 10000);
