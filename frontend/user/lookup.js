import { attachmentSize, attachmentUrl } from '/shared/attachments.js';
import { $, $$, showToast, escapeHtml } from '/shared/utils.js';
import { apiJson } from '/shared/api.js';
import { formatDate } from '/shared/time.js';
import { statusLabels, statusClass } from '/shared/constants.js';
import { startVisiblePolling } from '/shared/polling.js';

let stopQueuePolling;
function attachmentMarkup(item) {
  if (!item.attachments?.length) return '';
  return `<div class="appointment-attachments"><b>附件</b><div>${item.attachments.map(file => `<a target="_blank" rel="noopener" href="${attachmentUrl(item.id, file.id, item.studentId)}">${escapeHtml(file.filename)} <small>${attachmentSize(file.size)}</small></a>`).join('')}</div></div>`;
}

async function refreshQueue(list) {
  await Promise.all(list.map(async item => {
    const target = $(`[data-queue-id="${CSS.escape(item.id)}"]`); if (!target) return;
    if (['completed', 'cancelled', 'no_show'].includes(item.status)) { target.textContent = item.status === 'completed' ? '该预约已完成' : '该预约已结束'; return; }
    let result;
    try { const query = new URLSearchParams({ appointmentId: item.id, studentId: item.studentId }); result = await apiJson(`/api/live/summary?${query}`); } catch { /* Show an explicit offline state below. */ }
    if (!result) { target.textContent = '排队信息暂不可用，请稍后刷新'; return; }
    target.textContent = result.ahead === null ? '等待排队计算' : `前面 ${result.ahead} 人 · 当前第 ${result.position} 位 · 本时段共 ${result.queueTotal} 人`;
  }));
}

export function renderLookup(list, key, appointments) {
  const root = $('#lookup-results');
  stopQueuePolling?.(); stopQueuePolling = undefined;
  if (!key) { root.innerHTML = '<div class="empty-state"><span class="empty-icon">⌕</span><h2>输入凭证开始查询</h2><p>请使用预约编号 + 学号验证后查询预约。</p></div>'; return; }
  if (!list.length) { root.innerHTML = '<div class="empty-state"><span class="empty-icon">!</span><h2>没有找到预约</h2><p>请检查预约编号和学号是否正确。</p></div>'; return; }
  root.innerHTML = list.map(item => `<article class="appointment-card"><div><h3>${escapeHtml(item.deviceType)} · ${escapeHtml(item.brand || '')} ${escapeHtml(item.deviceModel || '')}</h3><span class="code">预约编号 <strong>${escapeHtml(item.id)}</strong></span><div class="appointment-meta"><span>${escapeHtml(item.campus)}</span><span>${formatDate(item.date)}</span><span>${escapeHtml(item.timeSlot)}</span></div><div class="queue-info" data-queue-id="${escapeHtml(item.id)}">正在计算排队位置…</div>${item.repairNote ? `<p class="record-note"><b>维修结果：</b>${escapeHtml(item.repairNote)}</p>` : ''}${attachmentMarkup(item)}</div><div class="appointment-status"><span class="status-pill ${statusClass[item.status]}">${statusLabels[item.status]}</span><time>${item.status === 'completed' ? '维修已完成' : `提交于 ${formatDate(item.createdAt)}`}</time>${['pending', 'awaiting_claim'].includes(item.status) ? `<button class="cancel-link" data-cancel="${escapeHtml(item.id)}">取消预约</button>` : ''}</div></article>`).join('');
  $$('[data-cancel]').forEach(button => button.addEventListener('click', async () => {
    const item = appointments.find(entry => entry.id === button.dataset.cancel); if (!item || !window.confirm('确认取消这条预约吗？')) return;
    try {
      const updated = await apiJson(`/api/appointments/${encodeURIComponent(item.id)}/status`, { method: 'PATCH', json: { status: 'cancelled', studentId: item.studentId } });
      Object.assign(item, updated); renderLookup([item], item.id, appointments); showToast('预约已取消');
    } catch (error) { showToast(error.message || '无法连接服务器'); }
  }));
  stopQueuePolling = startVisiblePolling(() => refreshQueue(list));
}

export function initLookup(appointments) {
  $('#lookup-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; if (!form.checkValidity()) { form.reportValidity(); return; }
    const appointmentId = $('#lookup-id').value.trim(); const studentId = $('#lookup-student-id').value.trim();
    try {
      const query = new URLSearchParams({ appointmentId, studentId });
      const item = await apiJson(`/api/appointments/lookup?${query}`); const index = appointments.findIndex(entry => entry.id === item.id); if (index >= 0) appointments[index] = item; else appointments.unshift(item); renderLookup([item], appointmentId, appointments);
    } catch (error) { renderLookup([], appointmentId); showToast(error.message || '无法连接服务器，请稍后重试'); }
  });
}
