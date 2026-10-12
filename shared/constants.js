export const TIME_SLOTS = ['19:00–19:30', '19:30–20:00', '20:00–20:30', '20:30–21:00'];
export const roleLevel = { technician: 1, admin: 2, superadmin: 3 };
export const CAMPUSES = ['南湖', '浑南'];
export const roleLabels = {technician:'维修人员',admin:'管理员',superadmin:'最高权限者'};
export const appointmentTransitions = {
  booked: ['in_progress', 'completed'], in_progress: ['completed']
};
export const statusLabels = {
  booked: '已预约', in_progress: '维修中', completed: '已结束'
};
export const statusClass = {
  booked: 'status-pending', in_progress: 'status-progress', completed: 'status-completed'
};
export const repairOutcomes = ['repaired', 'unrepaired', 'not_needed'];
export const outcomeLabels = {
  repaired: '修复成功', unrepaired: '未修复', not_needed: '无需维修',
  cancelled: '已取消', no_show: '未到场', legacy_unknown: '历史未分类'
};
export function normalizeTimeSlot(value) {
  const match = String(value ?? '').trim().replace(/：/g, ':').match(/^(\d{1,2})\s*:\s*(\d{2})\s*[‐‑‒–—−-]\s*(\d{1,2})\s*:\s*(\d{2})$/);
  if (!match) return '';
  const slot = `${match[1].padStart(2, '0')}:${match[2]}–${match[3].padStart(2, '0')}:${match[4]}`;
  // Keep accepting the two historical hour slots so old records and links remain usable.
  return TIME_SLOTS.includes(slot) || ['19:00–20:00', '20:00–21:00'].includes(slot) ? slot : '';
}
