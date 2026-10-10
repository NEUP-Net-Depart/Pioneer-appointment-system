import { $, showToast } from '/shared/utils.js';
import { apiJson } from '/shared/api.js';
import { saveAppointment,privateLink } from './credentials.js';
import { uploadAttachments } from '/shared/attachments.js';
import { startVisiblePolling } from '/shared/polling.js';
import { normalizeTimeSlot } from '/shared/constants.js';
import { addDays, serviceDay, dateKey, nowIso, timeLabel } from '/shared/time.js';

function configureDateRange() {
  const input = $('input[name="date"]'); const today = dateKey();
  input.min = today; input.max = addDays(today, 3);
  input.value = [0, 1, 2, 3].map(offset => addDays(today, offset)).find(serviceDay) || '';
}
let summaryGeneration = 0;
function updateCapacity() {
  const campus = $('[name="campus"]').value, date = $('[name="date"]').value;
  $('#slot-capacity').textContent = campus && date ? '正在读取服务端名额…' : '请选择校区和日期查看剩余名额';
}
async function updateLiveSummary() {
  const generation = ++summaryGeneration;
  const campus = $('[name="campus"]').value, date = $('[name="date"]').value;
  const select = $('[name="timeSlot"]'); const timeSlot = select.value;
  for (const option of select.options) { if (option.value) { option.textContent = option.value; option.disabled = false; } }
  if (!campus || !date) {
    ['#live-day-count', '#live-campus-count', '#live-slot-count'].forEach(id => $(id).textContent = '—');
    $('#live-day-label').textContent = '请选择校区和日期'; $('#live-campus-label').textContent = '请选择时段';
    $('#live-updated').textContent = '等待选择校区和日期'; return;
  }
  try {
    const summary = await apiJson(`/api/live/summary?${new URLSearchParams({ campus, date, timeSlot })}`);
    if (generation !== summaryGeneration) return;
    for (const option of select.options) {
      if (!option.value) continue;
      const remaining = Math.max(0, summary.capacity - (summary.slots[option.value] || 0));
      option.disabled = !remaining; option.textContent = `${option.value} · 剩余 ${remaining} 名`;
    }
    $('#slot-capacity').textContent = timeSlot ? `该校区该时段还可预约 ${Math.max(0, summary.capacity - summary.slotTotal)} 人` : `每个校区每个时段最多 ${summary.capacity} 人`;
    $('#live-day-count').textContent = summary.campusDayTotal;
    $('#live-campus-count').textContent = timeSlot ? summary.slotTotal : '—';
    $('#live-slot-count').textContent = timeSlot ? Math.max(0, summary.capacity - summary.slotTotal) : '—';
    $('#live-day-label').textContent = `${campus} · ${date}`;
    $('#live-campus-label').textContent = timeSlot || '请选择时段';
    $('#live-updated').textContent = `刚刚更新 · ${timeLabel()}`;
  } catch {
    if (generation !== summaryGeneration) return;
    ['#live-day-count', '#live-campus-count', '#live-slot-count'].forEach(id => $(id).textContent = '—');
    $('#slot-capacity').textContent = '名额读取失败，请稍后重试';
    $('#live-updated').textContent = '网络异常，名额暂不可用';
  }
}

export function initBooking({ appointments, onCreated }) {
  const form = $('#booking-form'); configureDateRange();
  ['campus', 'timeSlot'].forEach(name => $(`[name="${name}"]`).addEventListener('change', () => { updateCapacity(); updateLiveSummary(); }));
  $('[name="date"]').addEventListener('change', event => { const value = event.currentTarget.value; if (value && !serviceDay(value)) { event.currentTarget.value = ''; showToast('可预约日期仅限周一至周四'); } updateCapacity(); updateLiveSummary(); });
  startVisiblePolling(() => { updateCapacity(); return updateLiveSummary(); });
  $('#agreement-link').addEventListener('click', event => { event.preventDefault(); $('#agreement-modal').hidden = false; });
  $('#close-agreement').addEventListener('click', () => $('#agreement-modal').hidden = true);
  $('#agree-modal').addEventListener('click', () => { $('#agreement-modal').hidden = true; $('[name="agreement"]').checked = true; });
  $('#agreement-modal').addEventListener('click', event => { if (event.target.id === 'agreement-modal') $('#agreement-modal').hidden = true; });
  $('#new-booking').addEventListener('click', () => { form.reset(); configureDateRange(); updateCapacity(); updateLiveSummary(); form.hidden = false; $('.section-heading').hidden = false; $('#success-panel').hidden = true; });
  $('#copy-code').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#success-private-link').href); showToast('私人链接已复制，请勿转发给他人'); } catch { showToast('请保留成功页中的私人链接'); } });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = Object.fromEntries(new FormData(form).entries());
    data.timeSlot = normalizeTimeSlot(data.timeSlot);
    const files = [...$('#appointment-attachments').files];
    if (files.some(file => file.size > 5 * 1024 * 1024)) { showToast('单个附件不能超过 5 MB'); return; }
    if (!serviceDay(data.date)) { showToast('服务时间为周一至周四'); return; }
    if (!data.timeSlot) { showToast('请选择 19:00–20:00 或 20:00–21:00'); return; }
    const submit = form.querySelector('[type=submit]');
    if (submit.disabled) return;
    submit.disabled = true;
    const payload = { ...data, agreementAt: nowIso(), agreementVersion: 'v1.0' };
    delete payload.agreement;
    try {
      const appointment = await apiJson('/api/appointments', { method: 'POST', json: payload });
      const saved=saveAppointment(appointment);
      $('#success-private-link').href=privateLink(appointment);
      $('#credential-save-message').textContent=saved ? '凭证已自动保存在此浏览器，可直接打开“我的预约”。' : '此浏览器无法保存凭证，请保留私人查询链接。';
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
