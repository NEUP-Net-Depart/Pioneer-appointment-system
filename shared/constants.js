export const SLOT_CAPACITY = 20;
export const TIME_SLOTS = ['19:00–20:00', '20:00–21:00'];
export const roleLevel = { technician: 1, admin: 2, superadmin: 3 };
export const CAMPUSES = ['南湖', '浑南'];
export const statusLabels = {
  pending: '待审核', awaiting_claim: '待接单', claimed: '已接单', in_progress: '维修中',
  completed: '已完成', cancelled: '已取消', no_show: '爽约', no_repair: '无法维修'
};
export const statusClass = {
  pending: 'status-pending', awaiting_claim: 'status-pending', claimed: 'status-progress',
  in_progress: 'status-progress', completed: 'status-completed', cancelled: 'status-pending',
  no_show: 'status-pending', no_repair: 'status-pending'
};
export function normalizeTimeSlot(value) {
  const match = String(value ?? '').trim().replace(/：/g, ':').match(/^(\d{1,2})\s*:\s*(\d{2})\s*[‐‑‒–—−-]\s*(\d{1,2})\s*:\s*(\d{2})$/);
  if (!match) return '';
  const slot = `${match[1].padStart(2, '0')}:${match[2]}–${match[3].padStart(2, '0')}:${match[4]}`;
  return TIME_SLOTS.includes(slot) ? slot : '';
}
