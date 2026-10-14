import {uploadAttachments} from '/shared/attachments.js';
import { attachmentSize,attachmentUrl } from '/shared/attachments.js';
import { $,$$,showToast,escapeHtml } from '/shared/utils.js';
import { apiJson,apiFetch } from '/shared/api.js';
import { formatDate,formatInstant } from '/shared/time.js';
import { statusLabels,statusClass,outcomeLabels,terminalStatuses,expirationMessage,endTimeLabels } from '/shared/constants.js';
import { startVisiblePolling } from '/shared/polling.js';
import { savedAppointments,saveAppointment,privateLink,parsePrivateLink,credentialHeaders } from './credentials.js';
import { renderRepairQr } from './repair-qr.js';

export function initLookup(appointments,{locations,onPrivateLink=()=>{}}={}) {
  let stopPolling,generation=0;
  const root=$('#lookup-results');
  async function read(entry) {
    return {...await apiJson(`/api/appointments/${encodeURIComponent(entry.id)}`,{headers:credentialHeaders(entry)}),accessToken:entry.accessToken};
  }
  function render(list,failed=[]) {
    stopPolling?.();
    root.innerHTML=list.map(item=>`<article class="appointment-card result-card"><div class="appointment-card-main"><header class="appointment-card-header"><div class="appointment-card-title"><p class="result-kicker">预约详情</p><h3>${escapeHtml(item.deviceType)} · ${escapeHtml(item.brand)} ${escapeHtml(item.deviceModel)}</h3><span class="code">预约编号 <strong>${escapeHtml(item.id)}</strong></span>${item.repairNumber ? `<span class="code">历史维修编号 <strong>${escapeHtml(item.repairNumber)}</strong></span>` : ''}</div><div class="appointment-status"><span class="status-pill ${statusClass[item.status]}">${statusLabels[item.status]}</span><time>提交于 ${formatDate(item.createdAt)}</time>${item.status==='booked' ? `<button class="cancel-link" data-cancel="${escapeHtml(item.id)}">取消预约</button>` : ''}</div></header><div class="appointment-overview"><div class="appointment-overview-main"><div class="appointment-meta"><div><span>校区</span><strong>${escapeHtml(item.campus)}</strong></div><div><span>预约日期</span><strong>${formatDate(item.date)}</strong></div><div><span>预约时段</span><strong>${escapeHtml(item.timeSlot)}</strong></div></div><div class="appointment-location-slot"></div><div class="queue-info" data-queue-id="${escapeHtml(item.id)}">${item.status==='expired' ? expirationMessage : terminalStatuses.includes(item.status) ? `该预约${statusLabels[item.status]}` : item.status==='in_progress' ? '正在维修' : '正在读取排队位置…'}</div></div><div class="appointment-qr-slot"></div></div><details class="appointment-extra"${(item.attachments || []).length ? ' open' : ''}><summary>查看维修记录与补充材料</summary><div class="appointment-extra-body">${item.outcome ? `<p class="record-note"><b>维修结果：</b>${outcomeLabels[item.outcome]}</p>` : ''}${item.startedAt || item.completedAt ? `<p class="record-note">开始：${formatInstant(item.startedAt)} · ${endTimeLabels[item.status] || '结束时间'}：${formatInstant(item.completedAt)}</p>` : ''}${item.repairNote ? `<p class="record-note"><b>维修说明：</b>${escapeHtml(item.repairNote)}</p>` : ''}<div class="appointment-attachments">${(item.attachments || []).map(file=>`<button type="button" class="attachment-link" data-file="${escapeHtml(file.id)}" data-appointment="${escapeHtml(item.id)}">${escapeHtml(file.filename)} <small>${attachmentSize(file.size)}</small></button>`).join('')}</div><div class="attachment-upload"><label>补充附件（单个不超过 5 MB）<input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,text/plain" data-upload-input="${escapeHtml(item.id)}" aria-label="为 ${escapeHtml(item.id)} 选择附件" /></label><button class="secondary-btn" type="button" data-upload="${escapeHtml(item.id)}">上传附件</button></div></div></details><div class="appointment-actions"><button class="secondary-btn" type="button" data-copy-link="${escapeHtml(item.id)}">复制查询链接</button></div></div></article>`).join('');
    if (!list.length && !failed.length) root.innerHTML='<div class="empty-state"><span class="empty-icon">⌕</span><h2>此浏览器暂无预约</h2><p>预约成功后会自动出现在这里。其他设备可直接访问私人查询链接。</p></div>';
    root.querySelectorAll('.appointment-card').forEach((card, index) => {
      const arrival = document.createElement('div'); arrival.className = 'repair-arrival lookup-arrival';
      const label = document.createElement('span'); label.className = 'repair-arrival-label'; label.textContent = '维修地点';
      const address = document.createElement('strong'); address.dataset.repairCampus = list[index].campus;
      const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'text-btn'; copy.dataset.copyRepairLocation = list[index].campus; copy.textContent = '复制地点';
      const state = document.createElement('span'); state.className = 'repair-location-update'; state.dataset.locationState = ''; state.hidden = true;
      const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'text-btn'; retry.dataset.repairRetry = ''; retry.textContent = '重试地点'; retry.hidden = true;
      arrival.append(label,address,copy,state,retry); card.querySelector('.appointment-location-slot').append(arrival);
      if (terminalStatuses.includes(list[index].status)) return;
      const qr = document.createElement('div'); qr.className = 'repair-qr';
      const slot = card.querySelector('.appointment-qr-slot') || card.firstElementChild;
      slot.append(qr);
      void renderRepairQr(qr, list[index]);
    });
    if (failed.length) root.innerHTML+=failed.map(({entry,message})=>`<div class="empty-state"><h2>${escapeHtml(entry.id)} 暂时无法读取</h2><p>${escapeHtml(message)}。如凭证遗失或失效，请联系工作人员人工核验后重新签发。</p></div>`).join('');
    locations.paint();
    $$('[data-upload]').forEach(button=>button.addEventListener('click',async()=>{
      const item=list.find(entry=>entry.id===button.dataset.upload);
      const files=[...$(`[data-upload-input="${CSS.escape(item.id)}"]`).files];
      if(!files.length){showToast('请先选择附件');return;}
      if(files.some(file=>file.size>5*1024*1024)){showToast('单个附件不能超过 5 MB');return;}
      button.disabled=true;
      try{await uploadAttachments(item,files);Object.assign(item,await read(item));render(list,failed);showToast('附件已上传');}
      catch(error){showToast(error.message);}
      finally{button.disabled=false;}
    }));
    $$('[data-copy-link]').forEach(button=>button.addEventListener('click',async()=>{
      const item=list.find(entry=>entry.id===button.dataset.copyLink);
      try { await navigator.clipboard.writeText(privateLink(item));showToast('私人链接已复制，请勿转发给他人'); }
      catch {
        let input=button.parentElement.querySelector('.private-link-fallback');
        if(!input){
          input=document.createElement('input');input.type='text';input.className='private-link-fallback';input.readOnly=true;
          input.setAttribute('aria-label','私人查询链接');button.insertAdjacentElement('afterend',input);
        }
        input.value=privateLink(item);input.focus();input.select();showToast('请复制选中的私人查询链接');
      }
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
        await apiJson(`/api/appointments/${encodeURIComponent(item.id)}/status`,{method:'PATCH',headers:credentialHeaders(item),json:{status:'cancelled',revision:item.revision}});
        Object.assign(item,await read(item));render(list,failed);showToast('预约已取消');
      } catch(error) {showToast(error.message);}
      finally {button.disabled=false;}
    }));
    stopPolling=startVisiblePolling(async()=>{
      if (list.length && $('#lookup-view').classList.contains('is-active')) void locations.refresh();
      const current=generation;
      const fresh=await Promise.allSettled(list.map(read));
      if(current!==generation)return;
      let changed=false;
      fresh.forEach((result,index)=>{
        if(result.status!=='fulfilled' || result.value.revision<list[index].revision)return;
        const updated=result.value,item=list[index];
        if(['status','outcome','repairNote','startedAt','completedAt','repairNumber','expiresAt'].some(key=>updated[key]!==item[key]))changed=true;
        Object.assign(item,updated);
      });
      if(changed){render(list,failed);return;}
      await Promise.all(list.map(async item=>{
        const target=$(`[data-queue-id="${CSS.escape(item.id)}"]`);if (!target) return;
        if (terminalStatuses.includes(item.status)) {target.textContent=item.status==='expired' ? expirationMessage : `该预约${statusLabels[item.status]}`;return;}
        if (item.status==='in_progress') {target.textContent='正在维修';return;}
        try {
          const summary=await apiJson(`/api/live/summary?appointmentId=${encodeURIComponent(item.id)}`,{headers:credentialHeaders(item)});
          target.textContent=summary.position===null ? '等待排队计算' : `前面 ${summary.ahead} 人 · 当前第 ${summary.position} 位 · 本时段共 ${summary.queueTotal} 人`;
        } catch {target.textContent='排队信息暂不可用，请稍后刷新';}
      }));
    });
  }
  async function refresh() {
    void locations.refresh();
    const current=++generation;
    const entries=savedAppointments();
    const results=await Promise.allSettled(entries.map(read));
    if(current!==generation) return;
    const list=[],failed=[];
    results.forEach((result,index)=>{if(result.status==='fulfilled')list.push(result.value);else failed.push({entry:entries[index],message:result.reason.message});});
    appointments.splice(0,appointments.length,...list);render(list,failed);
  }
  async function importLink(value) {
    void locations.refresh();
    const entry=parsePrivateLink(value);
    if(!entry) throw new Error('请使用本系统的完整私人查询链接');
    const item=await read(entry);
    if(!saveAppointment(item)) showToast('浏览器无法保存凭证，请保留私人链接');
    appointments.splice(0,appointments.length,item);render([item]);
  }
  $('#refresh-my-appointments').addEventListener('click',refresh);
  const initial=location.hash;
  function consumePrivateLink(){
    const fragment=location.hash;if(!fragment)return;
    history.replaceState(null,'',location.pathname+location.search);
    importLink(location.origin+'/'+fragment).then(onPrivateLink).catch(error=>showToast(error.message));
  }
  window.addEventListener('hashchange',consumePrivateLink);
  if(initial) consumePrivateLink();else render([]);
  return {refresh,hasPrivateLink:!!initial};
}
