import { apiFetch } from './utils.js';
export const STORAGE_KEY = 'pioneerRepairAppointments';

export const statusLabels = {
  pending: '待审核', awaiting_claim: '待接单', claimed: '已接单', in_progress: '维修中',
  completed: '已完成', cancelled: '已取消', no_show: '爽约', no_repair: '无法维修'
};

export const statusClass = {
  pending: 'status-pending', awaiting_claim: 'status-pending', claimed: 'status-progress',
  in_progress: 'status-progress', completed: 'status-completed', cancelled: 'status-pending',
  no_show: 'status-pending', no_repair: 'status-pending'
};

function cacheKey() {
  const account = sessionStorage.getItem('pioneerAccount');
  return `${STORAGE_KEY}:${account || 'anonymous'}`;
}

const seed = [
  { id: '020261003-01', studentId: '2024010101', name: '林同学', college: '信息学院', campus: '南湖', phone: '138****0210', deviceType: '笔记本电脑', brand: '联想', deviceModel: 'ThinkPad T14', serial: '', warranty: '不清楚', faultType: '蓝屏', issue: '开机后屏幕闪烁，偶尔自动重启。', liquidDrop: '否', date: '2026-10-03', timeSlot: '19:00–20:00', note: '', status: 'in_progress', assignedTo: '王工', repairNote: '已完成内存检测，正在进行烤机。', createdAt: '2026-10-03T18:41:00', agreementAt: '2026-10-03T18:41:00', agreementVersion: 'v1.0' },
  { id: '120261003-01', studentId: '2023010822', name: '周同学', college: '机械学院', campus: '浑南', phone: '139****7734', deviceType: '台式电脑', brand: '自组机', deviceModel: 'RTX 4060', serial: '', warranty: '否', faultType: '黑屏', issue: '主机通电无显示，风扇转速异常。', liquidDrop: '否', date: '2026-10-03', timeSlot: '20:00–21:00', note: '', status: 'awaiting_claim', repairNote: '', createdAt: '2026-10-03T18:52:00', agreementAt: '2026-10-03T18:52:00', agreementVersion: 'v1.0' },
  { id: '020261002-02', studentId: '2024020315', name: '陈同学', college: '建筑学院', campus: '南湖', phone: '187****4102', deviceType: '显示器', brand: 'Dell', deviceModel: 'U2720Q', serial: '', warranty: '是', faultType: '其他', issue: '屏幕左侧出现间歇性竖线。', liquidDrop: '否', date: '2026-10-02', timeSlot: '19:00–20:00', note: '', status: 'completed', assignedTo: '李工', repairNote: '确认线材接触不良，已更换 DP 线并完成测试。', createdAt: '2026-10-02T18:26:00', agreementAt: '2026-10-02T18:26:00', agreementVersion: 'v1.0' }
];

function normalize(item) { return { college: '', brand: '', serial: '', warranty: '不清楚', faultType: '其他', liquidDrop: '否', note: '', assignedTo: '', repairNote: '', campus: '南湖', agreementVersion: 'v1.0', ...item }; }
export function loadAppointments() { localStorage.removeItem(STORAGE_KEY); const key = cacheKey(); const raw = localStorage.getItem(key); if (!raw) { localStorage.setItem(key, '[]'); return []; } try { return JSON.parse(raw).map(normalize); } catch { localStorage.setItem(key, '[]'); return []; } }
export function saveAppointments(appointments) { localStorage.setItem(cacheKey(), JSON.stringify(appointments)); }
export async function syncAppointments(appointments) { try { const response = await apiFetch('/api/appointments'); if (!response.ok) { if (response.status === 401) appointments.splice(0); return appointments; } const payload = await response.json(); appointments.splice(0, appointments.length, ...payload.items.map(normalize)); saveAppointments(appointments); } catch { /* Keep the local view if the server is temporarily unavailable. */ } return appointments; }
export async function patchAppointment(id, patch) {
  const response = await apiFetch(`/api/appointments/${encodeURIComponent(id)}/status`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || '预约更新失败');
  }
  return response.json();
}
