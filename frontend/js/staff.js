import { $, $$, formatDate, showToast, escapeHtml, apiFetch } from './utils.js';
import { saveAppointments, patchAppointment, statusLabels } from './store.js';

let activeFilter = 'all';
let detailId = '';
function attachmentSize(size) { const value = Number(size) || 0; return value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }
async function openAttachment(appointmentId, attachmentId) {
  const response = await apiFetch(`/api/appointments/${encodeURIComponent(appointmentId)}/attachments/${encodeURIComponent(attachmentId)}`);
  if (!response.ok) { showToast('附件读取失败'); return; }
  const blob = await response.blob(); const url = URL.createObjectURL(blob); window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function activeRows(appointments) {
  const query = $('#staff-search').value.trim().toLowerCase();
  const campus = $('#staff-campus-filter').value;
  const date = $('#staff-date-filter').value;
  return appointments.filter(item => (activeFilter === 'all' || item.status === activeFilter || (activeFilter === 'pending' && item.status === 'awaiting_claim')) && (campus === 'all' || item.campus === campus) && (!date || item.date === date) && (!query || [item.name, item.studentId, item.id, item.deviceModel, item.campus].some(value => (value || '').toLowerCase().includes(query))));
}

async function openDetail(item, appointments) {
  detailId = item.id;
  let attachments = item.attachments || [];
  try { const response = await apiFetch(`/api/appointments/${encodeURIComponent(item.id)}/attachments`); if (response.ok) attachments = (await response.json()).items || []; } catch { /* Keep the appointment details usable if attachment lookup fails. */ }
  const attachmentHtml = attachments.length ? `<div class="detail-attachments"><b>预约附件</b>${attachments.map(file => `<button type="button" class="attachment-link" data-attachment-id="${escapeHtml(file.id)}">${escapeHtml(file.filename)} <small>${attachmentSize(file.size)}</small></button>`).join('')}</div>` : '';
  $('#detail-summary').innerHTML = `<strong>${escapeHtml(item.name)} · ${escapeHtml(item.id)}</strong><span>${escapeHtml(item.studentId)} · ${escapeHtml(item.campus)} · ${formatDate(item.date)} ${escapeHtml(item.timeSlot)}</span><span>${escapeHtml(item.deviceType)} · ${escapeHtml(item.brand || '')} ${escapeHtml(item.deviceModel || '')}</span><p>${escapeHtml(item.issue || '未填写故障描述')}</p>${attachmentHtml}`;
  $$('.attachment-link', $('#detail-summary')).forEach(button => button.addEventListener('click', () => openAttachment(item.id, button.dataset.attachmentId)));
  $('#detail-status').innerHTML = Object.entries(statusLabels).map(([key, label]) => `<option value="${key}" ${item.status === key ? 'selected' : ''}>${label}</option>`).join('');
  $('#detail-assigned').value = item.assignedTo || '';
  $('#detail-repair-note').value = item.repairNote || '';
  $('#detail-modal').hidden = false;
  $('#save-detail').onclick = async () => { const current = appointments.find(entry => entry.id === detailId); if (!current) return; const patch = { status: $('#detail-status').value, assignedTo: $('#detail-assigned').value.trim(), repairNote: $('#detail-repair-note').value.trim() }; try { const updated = await patchAppointment(current.id, patch); Object.assign(current, updated); saveAppointments(appointments); $('#detail-modal').hidden = true; renderStaff(appointments); showToast('预约详情已保存'); } catch (error) { showToast(error.message); } };
}

export function renderStaff(appointments) {
  const counts = { all: appointments.length, pending: 0, awaiting_claim: 0, in_progress: 0, completed: 0 };
  appointments.forEach(item => { if (counts[item.status] !== undefined) counts[item.status] += 1; });
  $('#metric-total').textContent = counts.all; $('#metric-pending').textContent = counts.pending + counts.awaiting_claim; $('#metric-progress').textContent = counts.in_progress; $('#metric-done').textContent = counts.completed;
  $('#count-all').textContent = counts.all; $('#count-pending').textContent = counts.pending + counts.awaiting_claim; $('#count-progress').textContent = counts.in_progress; $('#count-done').textContent = counts.completed;
  const filtered = activeRows(appointments);
  $('#appointments-table').innerHTML = filtered.map(item => `<tr><td><span class="person-name">${escapeHtml(item.name)}</span><span class="person-code">${escapeHtml(item.studentId)} · ${escapeHtml(item.id)}</span></td><td>${escapeHtml(item.deviceType)}<span class="person-code">${escapeHtml(item.campus)} · ${escapeHtml(item.brand || '')} ${escapeHtml(item.deviceModel || '')}</span></td><td>${formatDate(item.date)}<span class="person-code">${escapeHtml(item.timeSlot)}</span></td><td><select class="status-select" data-id="${escapeHtml(item.id)}">${Object.entries(statusLabels).map(([key, label]) => `<option value="${key}" ${item.status === key ? 'selected' : ''}>${label}</option>`).join('')}</select></td><td>${item.repairNote ? `<span class="cell-muted">${escapeHtml(item.repairNote)}</span>` : '<span class="cell-muted">暂无记录</span>'}</td><td><button class="record-btn" data-detail="${escapeHtml(item.id)}">${item.status === 'awaiting_claim' ? '抢单' : '详情'}</button></td></tr>`).join('');
  $('#staff-empty').hidden = filtered.length > 0;
  $$('.status-select').forEach(select => select.addEventListener('change', async () => { const item = appointments.find(entry => entry.id === select.dataset.id); if (!item) return; const previous = item.status; try { const updated = await patchAppointment(item.id, { status: select.value }); Object.assign(item, updated); saveAppointments(appointments); renderStaff(appointments); showToast('状态已更新'); } catch (error) { select.value = previous; showToast(error.message); } }));
  $$('[data-detail]').forEach(button => button.addEventListener('click', async () => { const item = appointments.find(entry => entry.id === button.dataset.detail); if (item?.status === 'awaiting_claim') { try { const updated = await patchAppointment(item.id, { status: 'claimed', assignedTo: sessionStorage.getItem('pioneerAccount') || '' }); Object.assign(item, updated); saveAppointments(appointments); renderStaff(appointments); showToast('已成功接单'); } catch (error) { showToast(error.message); } } else if (item) openDetail(item, appointments); }));
}

export function initStaff(appointments) {
  $$('.filter-tab').forEach(button => button.addEventListener('click', () => { activeFilter = button.dataset.filter; $$('.filter-tab').forEach(item => item.classList.toggle('is-active', item === button)); renderStaff(appointments); }));
  $('#staff-search').addEventListener('input', () => renderStaff(appointments));
  $('#staff-campus-filter').addEventListener('change', () => renderStaff(appointments));
  $('#staff-date-filter').addEventListener('change', () => renderStaff(appointments));
  $('#staff-clear-filters').addEventListener('click', () => { $('#staff-campus-filter').value = 'all'; $('#staff-date-filter').value = ''; $('#staff-search').value = ''; activeFilter = 'all'; $$('.filter-tab').forEach(item => item.classList.toggle('is-active', item.dataset.filter === 'all')); renderStaff(appointments); });
  $('#close-detail').addEventListener('click', () => $('#detail-modal').hidden = true);
  $('#cancel-detail').addEventListener('click', () => $('#detail-modal').hidden = true);
  $('#detail-modal').addEventListener('click', event => { if (event.target.id === 'detail-modal') $('#detail-modal').hidden = true; });
  $('#export-csv').addEventListener('click', () => { const headers = ['预约编号', '学号', '姓名', '学院', '校区', '联系方式', '设备类型', '品牌', '型号', '故障类型', '预约日期', '时段', '状态', '维修人员', '维修记录']; const rows = appointments.map(item => [item.id, item.studentId, item.name, item.college, item.campus, item.phone, item.deviceType, item.brand, item.deviceModel, item.faultType, item.date, item.timeSlot, statusLabels[item.status], item.assignedTo, item.repairNote]); const csv = '\ufeff' + [headers, ...rows].map(row => row.map(value => `"${String(value || '').replaceAll('"', '""')}"`).join(',')).join('\n'); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); link.download = '先锋硬件部免费维修预约记录.csv'; link.click(); URL.revokeObjectURL(link.href); showToast('CSV 已导出'); });
  renderStaff(appointments);
}
