import { $, showToast } from '/shared/utils.js';
import { initSignature } from './signature.js';
import { apiJson } from '/shared/api.js';
import { saveAppointment,privateLink } from './credentials.js';
import { uploadAttachments } from '/shared/attachments.js';
import { startVisiblePolling } from '/shared/polling.js';
import { normalizeTimeSlot } from '/shared/constants.js';
import { addDays, serviceDay, dateKey, nowIso, timeLabel, slotDeadline } from '/shared/time.js';

function configureDateRange() {
  const input = $('input[name="date"]'); const today = dateKey();
  input.min = today; input.max = addDays(today, 3);
  input.value = [0, 1, 2, 3].map(offset => addDays(today, offset)).find(serviceDay) || '';
}
let summaryGeneration = 0, loadedSelection = '';
function updateCapacity() {
  const campus = $('[name="campus"]').value, date = $('[name="date"]').value;
  $('#slot-capacity').textContent = campus && date ? '正在读取剩余名额…' : '请选择校区和日期查看剩余名额';
}
async function updateLiveSummary() {
  const generation = ++summaryGeneration;
  const campus = $('[name="campus"]').value, date = $('[name="date"]').value;
  const select = $('[name="timeSlot"]'); const timeSlot = select.value;
  const selection = `${campus}/${date}`;
  if (loadedSelection !== selection) {
    for (const option of select.options) {
      if (option.value) { option.textContent = `${option.value} · 正在读取名额…`; option.disabled = true; }
    }
  }
  if (!campus || !date) {
    loadedSelection = ''; select.value = '';
    ['#live-day-count', '#live-campus-count', '#live-slot-count'].forEach(id => $(id).textContent = '—');
    $('#live-day-label').textContent = '请选择校区和日期'; $('#live-campus-label').textContent = '请选择时段';
    $('#live-capacity-label').textContent = '请选择校区和时段';
    $('#live-updated').textContent = '等待选择校区和日期'; return;
  }
  try {
    const summary = await apiJson(`/api/live/summary?${new URLSearchParams({ campus, date, timeSlot })}`);
    if (generation !== summaryGeneration) return;
    let unavailable = '';
    for (const option of select.options) {
      if (!option.value) continue;
      const capacity = summary.slotCapacities[option.value];
      const remaining = Math.max(0, capacity - (summary.slots[option.value] || 0));
      const ended = Date.parse(slotDeadline(date, option.value)) <= Date.now();
      const label = ended ? '时段已结束' : capacity === 0 ? '暂停预约' : !remaining ? '预约已满' : `剩余 ${remaining} 名`;
      option.disabled = ended || !remaining;
      option.textContent = `${option.value} · ${label}`;
      if (option.value === select.value && option.disabled) unavailable = label;
    }
    if (unavailable) select.value = '';
    loadedSelection = selection;
    const selected = select.value;
    const remaining = selected ? Math.max(0, summary.slotCapacities[selected] - (summary.slots[selected] || 0)) : null;
    const allPaused = Object.values(summary.slotCapacities).every(capacity => capacity === 0);
    $('#slot-capacity').textContent = selected ? `该校区该时段还可预约 ${remaining} 人` : allPaused ? '该校区所有时段暂停预约，请选择其他校区' : unavailable ? `${unavailable}，请选择其他可预约时段` : '请选择可预约的服务时段';
    $('#live-day-count').textContent = summary.campusDayTotal;
    $('#live-campus-count').textContent = selected ? summary.slots[selected] || 0 : '—';
    $('#live-slot-count').textContent = selected ? remaining : '—';
    $('#live-day-label').textContent = `${campus} · ${date}`;
    $('#live-campus-label').textContent = selected || '请选择时段';
    $('#live-capacity-label').textContent = selected ? `本时段最多 ${summary.slotCapacities[selected]} 人` : allPaused ? '暂停预约' : '请选择可预约时段';
    $('#live-updated').textContent = `刚刚更新 · ${timeLabel()}`;
  } catch {
    if (generation !== summaryGeneration) return;
    loadedSelection = '';
    for (const option of select.options) {
      if (option.value) { option.disabled = true; option.textContent = `${option.value} · 名额暂不可用`; }
    }
    ['#live-day-count', '#live-campus-count', '#live-slot-count'].forEach(id => $(id).textContent = '—');
    $('#slot-capacity').textContent = '名额读取失败，请稍后重试';
    $('#live-capacity-label').textContent = '名额暂不可用';
    $('#live-updated').textContent = '网络异常，名额暂不可用';
  }
}

export function initBooking({ appointments, onCreated }) {
  const form = $('#booking-form'); configureDateRange();
  const signature = initSignature();
  ['campus', 'timeSlot'].forEach(name => $(`[name="${name}"]`).addEventListener('change', () => { updateCapacity(); updateLiveSummary(); }));
  $('[name="date"]').addEventListener('change', event => { const value = event.currentTarget.value; if (value && !serviceDay(value)) { event.currentTarget.value = ''; showToast('可预约日期仅限周一至周四'); } updateCapacity(); updateLiveSummary(); });
  startVisiblePolling(() => { updateCapacity(); return updateLiveSummary(); });
  $('#agreement-link').addEventListener('click', event => { event.preventDefault(); $('#agreement-modal').hidden = false; });
  $('#close-agreement').addEventListener('click', () => $('#agreement-modal').hidden = true);
  $('#agree-modal').addEventListener('click', () => { $('#agreement-modal').hidden = true; signature.open(); });
  $('#agreement-modal').addEventListener('click', event => { if (event.target.id === 'agreement-modal') $('#agreement-modal').hidden = true; });
  $('#copy-code').addEventListener('click', async () => {
    const link = $('#success-link-fallback');
    try { await navigator.clipboard.writeText(link.value); showToast('私人链接已复制，请勿转发给他人'); }
    catch { link.hidden = false; link.focus(); link.select(); showToast('请复制选中的私人查询链接'); }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!signature.value()) { signature.open(); return; }
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = Object.fromEntries(new FormData(form).entries());
    data.timeSlot = normalizeTimeSlot(data.timeSlot);
    const files = [...$('#appointment-attachments').files];
    if (files.some(file => file.size > 5 * 1024 * 1024)) { showToast('单个附件不能超过 5 MB'); return; }
    if (!serviceDay(data.date)) { showToast('服务时间为周一至周四'); return; }
    if (!data.timeSlot) { showToast('请选择 19:00–20:00 或 20:00–21:00'); return; }
    if (loadedSelection !== `${data.campus}/${data.date}`) { showToast('请等待名额读取成功后重试'); return; }
    const submit = form.querySelector('[type=submit]');
    if (submit.disabled) return;
    submit.disabled = true;
    const payload = { ...data, agreementAt: nowIso(), agreementVersion: 'v1.0', signature: signature.value() };
    delete payload.agreement;
    try {
      const appointment = await apiJson('/api/appointments', { method: 'POST', json: payload });
      const saved=saveAppointment(appointment);
      $('#success-link-fallback').value=privateLink(appointment);
      $('#success-link-fallback').hidden=saved;
      $('#credential-save-message').textContent=saved ? '' : '此浏览器无法保存凭证，请复制并保留私人查询链接。';
      $('#credential-save-message').hidden=saved;
      if (files.length) {
        try { await uploadAttachments(appointment, files); }
        catch (error) { showToast(`预约已提交，但${error.message}`); }
      }
      appointments.unshift(appointment);
      $('#success-code').textContent = appointment.id;
      $('#success-summary').textContent = `${appointment.campus} · ${appointment.date} · ${appointment.timeSlot}`;
      form.hidden = true; $('.section-heading').hidden = true; $('#success-panel').hidden = false;
      if (!files.length) showToast('免费维修预约已提交');
      onCreated?.(appointment);
    } catch (error) { showToast(error.message || '无法连接服务器，预约未提交'); }
    finally { submit.disabled = false; }
  });
}
