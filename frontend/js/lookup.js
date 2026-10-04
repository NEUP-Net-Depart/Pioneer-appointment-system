import { $, $$, formatDate, showToast, escapeHtml, apiFetch } from './utils.js';
import { saveAppointments, statusLabels, statusClass } from './store.js';

let queueTimer;
function attachmentSize(size) { const value = Number(size) || 0; return value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }
function attachmentMarkup(item) {
  if (!item.attachments?.length) return '';
  return `<div class="appointment-attachments"><b>附件</b><div>${item.attachments.map(file => `<a target="_blank" rel="noopener" href="/api/appointments/${encodeURIComponent(item.id)}/attachments/${encodeURIComponent(file.id)}?studentId=${encodeURIComponent(item.studentId)}">${escapeHtml(file.filename)} <small>${attachmentSize(file.size)}</small></a>`).join('')}</div></div>`;
}
function localQueue(item, appointments) { const active = entry => !['cancelled', 'no_show'].includes(entry.status); const queue = appointments.filter(entry => entry.date === item.date && entry.campus === item.campus && entry.timeSlot === item.timeSlot && active(entry)).sort((a, b) => String(a.createdAt || a.id).localeCompare(String(b.createdAt || b.id))); const index = queue.findIndex(entry => entry.id === item.id); return { ahead: index < 0 ? null : index, position: index < 0 ? null : index + 1, queueTotal: queue.length }; }

async function refreshQueue(list, appointments) {
  await Promise.all(list.map(async item => {
    const target = $(`[data-queue-id="${CSS.escape(item.id)}"]`); if (!target) return;
    if (['completed', 'cancelled', 'no_show'].includes(item.status)) { target.textContent = item.status === 'completed' ? '该预约已完成' : '该预约已结束'; return; }
    let result = localQueue(item, appointments);
    try { const query = new URLSearchParams({ appointmentId: item.id, studentId: item.studentId }); const response = await apiFetch(`/api/live/summary?${query}`); if (response.ok) result = await response.json(); } catch { /* Keep local queue information when offline. */ }
    target.textContent = result.ahead === null ? '等待排队计算' : `前面 ${result.ahead} 人 · 当前第 ${result.position} 位 · 本时段共 ${result.queueTotal} 人`;
  }));
}

export function renderLookup(list, key, appointments) {
  const root = $('#lookup-results');
  clearInterval(queueTimer);
  if (!key) { root.innerHTML = '<div class="empty-state"><span class="empty-icon">⌕</span><h2>输入凭证开始查询</h2><p>请使用预约编号 + 学号验证后查询预约。</p></div>'; return; }
  if (!list.length) { root.innerHTML = '<div class="empty-state"><span class="empty-icon">!</span><h2>没有找到预约</h2><p>请检查预约编号和学号是否正确。</p></div>'; return; }
  root.innerHTML = list.map(item => `<article class="appointment-card"><div><h3>${escapeHtml(item.deviceType)} · ${escapeHtml(item.brand || '')} ${escapeHtml(item.deviceModel || '')}</h3><span class="code">预约编号 <strong>${escapeHtml(item.id)}</strong></span><div class="appointment-meta"><span>${escapeHtml(item.campus)}</span><span>${formatDate(item.date)}</span><span>${escapeHtml(item.timeSlot)}</span></div><div class="queue-info" data-queue-id="${escapeHtml(item.id)}">正在计算排队位置…</div>${item.repairNote ? `<p class="record-note"><b>维修结果：</b>${escapeHtml(item.repairNote)}</p>` : ''}${attachmentMarkup(item)}</div><div class="appointment-status"><span class="status-pill ${statusClass[item.status]}">${statusLabels[item.status]}</span><time>${item.status === 'completed' ? '维修已完成' : `提交于 ${formatDate(item.createdAt)}`}</time>${['pending', 'awaiting_claim'].includes(item.status) ? `<button class="cancel-link" data-cancel="${escapeHtml(item.id)}">取消预约</button>` : ''}</div></article>`).join('');
  $$('[data-cancel]').forEach(button => button.addEventListener('click', async () => {
    const item = appointments.find(entry => entry.id === button.dataset.cancel); if (!item || !window.confirm('确认取消这条预约吗？')) return;
    try {
      const response = await apiFetch(`/api/appointments/${encodeURIComponent(item.id)}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled', studentId: item.studentId }) });
      if (!response.ok) { const body = await response.json().catch(() => ({})); showToast(body.error || '取消失败，请刷新后重试'); return; }
      Object.assign(item, await response.json()); saveAppointments(appointments); renderLookup([item], item.id, appointments); showToast('预约已取消');
    } catch { showToast('无法连接服务器'); }
  }));
  refreshQueue(list, appointments); queueTimer = setInterval(() => refreshQueue(list, appointments), 10000);
}

export function initLookup(appointments) {
  $('#lookup-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; if (!form.checkValidity()) { form.reportValidity(); return; }
    const appointmentId = $('#lookup-id').value.trim(); const studentId = $('#lookup-student-id').value.trim();
    try {
      const query = new URLSearchParams({ appointmentId, studentId }); const response = await apiFetch(`/api/appointments/lookup?${query}`);
      if (!response.ok) { const body = await response.json().catch(() => ({})); renderLookup([], appointmentId); showToast(body.error || '预约编号或学号不匹配'); return; }
      const item = await response.json(); const index = appointments.findIndex(entry => entry.id === item.id); if (index >= 0) appointments[index] = item; else appointments.unshift(item); saveAppointments(appointments); renderLookup([item], appointmentId, appointments);
    } catch { showToast('无法连接服务器，请稍后重试'); }
  });
}
