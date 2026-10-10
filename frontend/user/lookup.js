import { attachmentSize,attachmentUrl } from '/shared/attachments.js';
import { $,$$,showToast,escapeHtml } from '/shared/utils.js';
import { apiJson,apiFetch } from '/shared/api.js';
import { formatDate } from '/shared/time.js';
import { statusLabels,statusClass } from '/shared/constants.js';
import { startVisiblePolling } from '/shared/polling.js';
import { savedAppointments,saveAppointment,privateLink,parsePrivateLink,credentialHeaders } from './credentials.js';

export function initLookup(appointments) {
  let stopPolling,generation=0;
  const root=$('#lookup-results');
  async function read(entry) {
    return {...await apiJson(`/api/appointments/${encodeURIComponent(entry.id)}`,{headers:credentialHeaders(entry)}),accessToken:entry.accessToken};
  }
  function render(list,failed=[]) {
    stopPolling?.();
    root.innerHTML=list.map(item=>`<article class="appointment-card"><div><h3>${escapeHtml(item.deviceType)} · ${escapeHtml(item.brand)} ${escapeHtml(item.deviceModel)}</h3><span class="code">预约编号 <strong>${escapeHtml(item.id)}</strong></span><div class="appointment-meta"><span>${escapeHtml(item.campus)}</span><span>${formatDate(item.date)}</span><span>${escapeHtml(item.timeSlot)}</span></div><div class="queue-info" data-queue-id="${escapeHtml(item.id)}">正在读取排队位置…</div>${item.repairNote ? `<p class="record-note"><b>维修结果：</b>${escapeHtml(item.repairNote)}</p>` : ''}<div class="appointment-attachments">${(item.attachments || []).map(file=>`<button type="button" class="attachment-link" data-file="${escapeHtml(file.id)}" data-appointment="${escapeHtml(item.id)}">${escapeHtml(file.filename)} <small>${attachmentSize(file.size)}</small></button>`).join('')}</div><button class="text-btn" data-copy-link="${escapeHtml(item.id)}">复制私人查询链接</button></div><div class="appointment-status"><span class="status-pill ${statusClass[item.status]}">${statusLabels[item.status]}</span><time>提交于 ${formatDate(item.createdAt)}</time>${['pending','awaiting_claim'].includes(item.status) ? `<button class="cancel-link" data-cancel="${escapeHtml(item.id)}">取消预约</button>` : ''}</div></article>`).join('');
    if (!list.length && !failed.length) root.innerHTML='<div class="empty-state"><span class="empty-icon">⌕</span><h2>此浏览器暂无预约</h2><p>预约成功后会自动出现在这里。其他设备可打开私人查询链接。</p></div>';
    if (failed.length) root.innerHTML+=failed.map(({entry,message})=>`<div class="empty-state"><h2>${escapeHtml(entry.id)} 暂时无法读取</h2><p>${escapeHtml(message)}。如凭证遗失或失效，请联系工作人员人工核验后重新签发。</p></div>`).join('');
    $$('[data-copy-link]').forEach(button=>button.addEventListener('click',async()=>{
      const item=list.find(entry=>entry.id===button.dataset.copyLink);
      try { await navigator.clipboard.writeText(privateLink(item));showToast('私人链接已复制，请勿转发给他人'); }
      catch { $('#lookup-link').value=privateLink(item);showToast('请复制查询框中的私人链接'); }
    }));
    $$('[data-file]').forEach(button=>button.addEventListener('click',async()=>{
      const item=list.find(entry=>entry.id===button.dataset.appointment);
      try {
        const response=await apiFetch(attachmentUrl(item.id,button.dataset.file),{headers:credentialHeaders(item)});
        if (!response.ok) throw new Error('附件暂时无法读取');
        const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');
        link.href=url;link.download=button.textContent.trim();link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
      } catch(error) {showToast(error.message);}
    }));
    $$('[data-cancel]').forEach(button=>button.addEventListener('click',async()=>{
      const item=list.find(entry=>entry.id===button.dataset.cancel);
      if (!window.confirm('确认取消这条预约吗？')) return;
      button.disabled=true;
      try {
        await apiJson(`/api/appointments/${encodeURIComponent(item.id)}/status`,{method:'PATCH',headers:credentialHeaders(item),json:{status:'cancelled'}});
        await refresh();showToast('预约已取消');
      } catch(error) {showToast(error.message);}
      finally {button.disabled=false;}
    }));
    stopPolling=startVisiblePolling(async()=>{
      await Promise.all(list.map(async item=>{
        const target=$(`[data-queue-id="${CSS.escape(item.id)}"]`);if (!target) return;
        if (['completed','cancelled','no_show','no_repair'].includes(item.status)) {target.textContent='该预约已结束';return;}
        try {
          const summary=await apiJson(`/api/live/summary?appointmentId=${encodeURIComponent(item.id)}`,{headers:credentialHeaders(item)});
          target.textContent=summary.position===null ? '等待排队计算' : `前面 ${summary.ahead} 人 · 当前第 ${summary.position} 位 · 本时段共 ${summary.queueTotal} 人`;
        } catch {target.textContent='排队信息暂不可用，请稍后刷新';}
      }));
    });
  }
  async function refresh() {
    const current=++generation;
    const entries=savedAppointments();
    const results=await Promise.allSettled(entries.map(read));
    if(current!==generation) return;
    const list=[],failed=[];
    results.forEach((result,index)=>{if(result.status==='fulfilled')list.push(result.value);else failed.push({entry:entries[index],message:result.reason.message});});
    appointments.splice(0,appointments.length,...list);render(list,failed);
  }
  async function importLink(value) {
    const entry=parsePrivateLink(value);
    if(!entry) throw new Error('请使用本系统的完整私人查询链接');
    const item=await read(entry);
    if(!saveAppointment(entry)) showToast('浏览器无法保存凭证，请保留私人链接');
    appointments.splice(0,appointments.length,item);render([item]);
  }
  $('#lookup-form').addEventListener('submit',async event=>{
    event.preventDefault();
    try {await importLink($('#lookup-link').value.trim());$('#lookup-link').value='';}
    catch(error){showToast(error.message);}
  });
  $('#refresh-my-appointments').addEventListener('click',refresh);
  const initial=location.hash;
  if(initial) {
    history.replaceState(null,'',location.pathname+location.search);
    importLink(location.origin+'/'+initial).catch(error=>showToast(error.message));
  } else render([]);
  return {refresh,hasPrivateLink:!!initial};
}
