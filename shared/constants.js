export const TIME_SLOTS = ['19:00–20:00', '20:00–21:00'];
export const roleLevel = { technician: 1, admin: 2, superadmin: 3 };
export const CAMPUSES = ['南湖', '浑南'];
export const roleLabels = {technician:'维修人员',admin:'管理员',superadmin:'最高权限者'};
export const appointmentTransitions = {
  booked: ['in_progress', 'cancelled', 'expired'], in_progress: ['completed']
};
export const statusLabels = {
  booked: '已预约', in_progress: '维修中', completed: '已完成', cancelled: '已取消', expired: '已逾期'
};
export const statusClass = {
  booked: 'status-pending', in_progress: 'status-progress', completed: 'status-completed',
  cancelled: 'status-cancelled', expired: 'status-expired'
};
export const terminalStatuses = ['completed', 'cancelled', 'expired'];
export const expirationMessage = '预约时段已结束，本次预约未记录维修开始。如仍需维修，请重新预约或联系工作人员。';
export const endTimeLabels = { completed: '完成时间', cancelled: '取消时间', expired: '逾期处理时间' };
export const repairOutcomes = ['repaired', 'unrepaired', 'not_needed'];
export const outcomeLabels = {
  repaired: '修复成功', unrepaired: '未修复', not_needed: '无需维修',
  legacy_unknown: '历史未分类'
};
export function normalizeTimeSlot(value) {
  const match = String(value ?? '').trim().replace(/：/g, ':').match(/^(\d{1,2})\s*:\s*(\d{2})\s*[‐‑‒–—−-]\s*(\d{1,2})\s*:\s*(\d{2})$/);
  if (!match) return '';
  const slot = `${match[1].padStart(2, '0')}:${match[2]}–${match[3].padStart(2, '0')}:${match[4]}`;
  return TIME_SLOTS.includes(slot) ? slot : '';
}
