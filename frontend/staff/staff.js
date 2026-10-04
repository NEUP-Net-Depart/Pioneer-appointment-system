import { attachmentSize, attachmentUrl } from '/shared/attachments.js';
import { $, $$, showToast, escapeHtml } from '/shared/utils.js';
import { apiFetch, apiJson } from '/shared/api.js';
import { formatDate } from '/shared/time.js';
import { statusLabels } from '/shared/constants.js';

async function openAttachment(appointmentId, attachmentId) {
  const response = await apiFetch(attachmentUrl(appointmentId, attachmentId));
  if (!response.ok) { showToast('附件读取失败'); return; }
  const blob = await response.blob(); const url = URL.createObjectURL(blob); window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function initStaff() {
  let activeFilter = 'all', detailId = '', generation = 0, searchTimer;
  let appointments = [], counts = {};
  async function refresh() {
    const current = ++generation;
    const query = new URLSearchParams({ status: activeFilter, q: $('#staff-search').value.trim(), campus: $('#staff-campus-filter').value, date: $('#staff-date-filter').value });
    try {
      const result = await apiJson(`/api/appointments?${query}`);
      if (current !== generation) return;
      appointments = result.items; counts = result.counts; render();
    } catch (error) { if (current === generation) showToast(error.message || '预约加载失败'); }
  }
  async function patchAppointment(id, patch) {
    await apiJson(`/api/appointments/${encodeURIComponent(id)}/status`, { method: 'PATCH', json: patch });
    await refresh();
  }
async function openDetail(item) {
  detailId = item.id;
  let attachments;
  try { attachments = (await apiJson(`/api/appointments/${encodeURIComponent(item.id)}/attachments`)).items; }
  catch (error) { showToast(error.message || '附件列表读取失败'); return; }
  if (detailId !== item.id) return;
  const attachmentHtml = attachments.length ? `<div class="detail-attachments"><b>预约附件</b>${attachments.map(file => `<button type="button" class="attachment-link" data-attachment-id="${escapeHtml(file.id)}">${escapeHtml(file.filename)} <small>${attachmentSize(file.size)}</small></button>`).join('')}</div>` : '';
  $('#detail-summary').innerHTML = `<strong>${escapeHtml(item.name)} · ${escapeHtml(item.id)}</strong><span>${escapeHtml(item.studentId)} · ${escapeHtml(item.campus)} · ${formatDate(item.date)} ${escapeHtml(item.timeSlot)}</span><span>${escapeHtml(item.deviceType)} · ${escapeHtml(item.brand || '')} ${escapeHtml(item.deviceModel || '')}</span><p>${escapeHtml(item.issue || '未填写故障描述')}</p>${attachmentHtml}`;
  $$('.attachment-link', $('#detail-summary')).forEach(button => button.addEventListener('click', () => openAttachment(item.id, button.dataset.attachmentId).catch(error => showToast(error.message || '附件读取失败'))));
  $('#detail-status').innerHTML = Object.entries(statusLabels).map(([key, label]) => `<option value="${key}" ${item.status === key ? 'selected' : ''}>${label}</option>`).join('');
  $('#detail-assigned').value = item.assignedTo || '';
  $('#detail-repair-note').value = item.repairNote || '';
  $('#detail-modal').hidden = false;
  $('#save-detail').onclick = async () => { const current = appointments.find(entry => entry.id === detailId); if (!current) return; const patch = { status: $('#detail-status').value, assignedTo: $('#detail-assigned').value.trim(), repairNote: $('#detail-repair-note').value.trim() }; try { await patchAppointment(current.id, patch); $('#detail-modal').hidden = true; showToast('预约详情已保存'); } catch (error) { showToast(error.message); } };
}

function render() {
  $('#metric-total').textContent = counts.all || 0; $('#metric-pending').textContent = counts.pending || 0;
  $('#metric-progress').textContent = counts.in_progress || 0; $('#metric-done').textContent = counts.completed || 0;
  $('#count-all').textContent = counts.all || 0; $('#count-pending').textContent = counts.pending || 0;
  $('#count-progress').textContent = counts.in_progress || 0; $('#count-done').textContent = counts.completed || 0;
  $('#appointments-table').innerHTML = appointments.map(item => `<tr><td><span class="person-name">${escapeHtml(item.name)}</span><span class="person-code">${escapeHtml(item.studentId)} · ${escapeHtml(item.id)}</span></td><td>${escapeHtml(item.deviceType)}<span class="person-code">${escapeHtml(item.campus)} · ${escapeHtml(item.brand || '')} ${escapeHtml(item.deviceModel || '')}</span></td><td>${formatDate(item.date)}<span class="person-code">${escapeHtml(item.timeSlot)}</span></td><td><select class="status-select" data-id="${escapeHtml(item.id)}">${Object.entries(statusLabels).map(([key, label]) => `<option value="${key}" ${item.status === key ? 'selected' : ''}>${label}</option>`).join('')}</select></td><td>${item.repairNote ? `<span class="cell-muted">${escapeHtml(item.repairNote)}</span>` : '<span class="cell-muted">暂无记录</span>'}</td><td><button class="record-btn" data-detail="${escapeHtml(item.id)}">${['pending','awaiting_claim'].includes(item.status) ? '抢单' : '详情'}</button></td></tr>`).join('');
  $('#staff-empty').hidden = appointments.length > 0;
  $$('.status-select').forEach(select => select.addEventListener('change', async () => { const item = appointments.find(entry => entry.id === select.dataset.id); if (!item) return; const previous = item.status; try { await patchAppointment(item.id, { status: select.value }); showToast('状态已更新'); } catch (error) { select.value = previous; showToast(error.message); } }));
  $$('[data-detail]').forEach(button => button.addEventListener('click', async () => { const item = appointments.find(entry => entry.id === button.dataset.detail); if (item && ['pending','awaiting_claim'].includes(item.status) && !item.assignedTo) { try { await patchAppointment(item.id, { status: 'claimed', assignedTo: sessionStorage.getItem('pioneerAccount') || '' }); showToast('已成功接单'); } catch (error) { showToast(error.message); } } else if (item) openDetail(item); }));
}


  $$('.filter-tab').forEach(button => button.addEventListener('click', () => { activeFilter = button.dataset.filter; $$('.filter-tab').forEach(item => item.classList.toggle('is-active', item === button)); refresh(); }));
  $('#staff-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(refresh, 200); });
  $('#staff-campus-filter').addEventListener('change', refresh);
  $('#staff-date-filter').addEventListener('change', refresh);
  $('#staff-clear-filters').addEventListener('click', () => { $('#staff-campus-filter').value = 'all'; $('#staff-date-filter').value = ''; $('#staff-search').value = ''; activeFilter = 'all'; $$('.filter-tab').forEach(item => item.classList.toggle('is-active', item.dataset.filter === 'all')); refresh(); });
  $('#close-detail').addEventListener('click', () => { detailId = ''; $('#detail-modal').hidden = true; });
  $('#cancel-detail').addEventListener('click', () => { detailId = ''; $('#detail-modal').hidden = true; });
  $('#detail-modal').addEventListener('click', event => { if (event.target.id === 'detail-modal') { detailId = ''; $('#detail-modal').hidden = true; } });
  $('#export-csv').addEventListener('click', async () => {
    try {
      const response = await apiFetch('/api/export/appointments.csv');
      if (!response.ok) throw new Error((await response.json()).error || '导出失败');
      const link = document.createElement('a'); link.href = URL.createObjectURL(await response.blob());
      link.download = '先锋硬件部免费维修预约记录.csv'; link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10000); showToast('CSV 已导出');
    } catch (error) { showToast(error.message || '无法连接服务器'); }
  });
  render();
  return { refresh, clear() { generation++; clearTimeout(searchTimer); detailId = ''; appointments = []; counts = {}; $('#detail-modal').hidden = true; render(); } };
}
