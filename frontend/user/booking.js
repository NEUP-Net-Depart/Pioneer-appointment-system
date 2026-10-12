import { $, showToast } from '/shared/utils.js';
import { initSignature } from './signature.js';
import { initBookingHints } from './booking-hints.js';
import { apiJson } from '/shared/api.js';
import { saveAppointment,privateLink } from './credentials.js';
import { uploadAttachments } from '/shared/attachments.js';
import { initSlotPicker } from './slot-picker.js';
import { normalizeTimeSlot } from '/shared/constants.js';
import { nowIso } from '/shared/time.js';

export function initBooking({ appointments, onCreated }) {
  const form = $('#booking-form');
  const picker = initSlotPicker();
  initBookingHints();
  const signature = initSignature();
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
    if (!picker.validate()) return;
    if (!signature.value()) { signature.open(); return; }
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = Object.fromEntries(new FormData(form).entries());
    data.timeSlot = normalizeTimeSlot(data.timeSlot);
    const files = [...$('#appointment-attachments').files];
    if (files.some(file => file.size > 5 * 1024 * 1024)) { showToast('单个附件不能超过 5 MB'); return; }
    const submit = form.querySelector('[type=submit]');
    if (submit.disabled) return;
    submit.disabled = true;
    const payload = { ...data, agreementAt: nowIso(), agreementVersion: 'v1.1', signature: signature.value() };
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
      picker.dispose();
      form.hidden = true; $('.section-heading').hidden = true; $('#success-panel').hidden = false;
      if (!files.length) showToast('免费维修预约已提交');
      onCreated?.(appointment);
    } catch (error) {
      showToast(error.message || '无法连接服务器，预约未提交');
      if (/已满|暂停预约|时段已经结束/.test(error.message)) await picker.recover(error.message);
    }
    finally { submit.disabled = false; }
  });
}
