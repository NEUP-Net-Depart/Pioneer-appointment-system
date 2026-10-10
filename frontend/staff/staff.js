import {attachmentSize,attachmentUrl} from '/shared/attachments.js';
import {$,$$,showToast,escapeHtml} from '/shared/utils.js';
import {apiFetch,apiJson} from '/shared/api.js';
import {formatDate} from '/shared/time.js';
import {statusLabels,statusClass,appointmentTransitions,roleLevel} from '/shared/constants.js';
export function initStaff(){
  let activeFilter='all',generation=0,searchTimer,detailItem;
  let appointments=[],counts={};
  const admin=()=>roleLevel[sessionStorage.getItem('pioneerRole')]>=2;
  const owns=item=>item.assignedTo===sessionStorage.getItem('pioneerAccount');
  const choices=item=>admin() ? Object.keys(statusLabels) : [...new Set([item.status,...(appointmentTransitions[item.status] || [])])];
  const options=item=>choices(item).map(status=>`<option value="${status}" ${status===item.status ? 'selected' : ''}>${statusLabels[status]}</option>`).join('');
  async function refresh(){
    const current=++generation;
    const query=new URLSearchParams({status:activeFilter,q:$('#staff-search').value.trim(),campus:$('#staff-campus-filter').value,date:$('#staff-date-filter').value});
    try{
      const result=await apiJson(`/api/appointments?${query}`);
      if(current!==generation)return;
      appointments=result.items;counts=result.counts;render();
    }catch(error){if(current===generation)showToast(error.message);}
  }
  async function patch(item,input){
    await apiJson(`/api/appointments/${encodeURIComponent(item.id)}/status`,{method:'PATCH',json:{...input,revision:item.revision}});
    await refresh();
  }
  async function openAttachment(item,id){
    const response=await apiFetch(attachmentUrl(item.id,id));
    if(!response.ok)throw new Error('附件读取失败');
    const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');
    link.href=url;link.download='维修附件';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  function close(){
    detailItem=undefined;$('#detail-modal').hidden=true;$('#recovered-link').value='';$('#recovery-result').hidden=true;
    $('#recovery-verified').checked=false;$('#recovery-reason').value='';
  }
  async function openDetail(item){
    detailItem=item;
    let files;
    try{files=(await apiJson(`/api/appointments/${encodeURIComponent(item.id)}/attachments`)).items;}
    catch(error){showToast(error.message);return;}
    if(detailItem!==item)return;
    $('#detail-summary').innerHTML=`<strong>${escapeHtml(item.name)} · ${escapeHtml(item.id)}</strong><span>${escapeHtml(item.studentId)} · ${escapeHtml(item.campus)} · ${formatDate(item.date)} ${escapeHtml(item.timeSlot)}</span><span>${escapeHtml(item.deviceType)} · ${escapeHtml(item.brand)} ${escapeHtml(item.deviceModel)} · 保修 ${escapeHtml(item.warranty)}</span><span>QQ / 微信：${escapeHtml(item.social)} · 手机：${escapeHtml(item.phone || '未填写')}</span><p>${escapeHtml(item.issue || '未填写故障描述')}</p>${item.note ? `<p>备注：${escapeHtml(item.note)}</p>` : ''}<div class="detail-attachments">${files.map(file=>`<button class="attachment-link" data-attachment-id="${file.id}" type="button">${escapeHtml(file.filename)} <small>${attachmentSize(file.size)}</small></button>`).join('')}</div>`;
    $$('[data-attachment-id]',$('#detail-summary')).forEach(button=>button.addEventListener('click',()=>openAttachment(item,button.dataset.attachmentId).catch(error=>showToast(error.message))));
    $('#detail-status').innerHTML=options(item);$('#detail-assigned').value=item.assignedTo;
    $('#detail-assigned').readOnly=!admin();$('#detail-repair-note').value=item.repairNote;
    $('#recovery-panel').hidden=!admin();$('#recovery-result').hidden=true;$('#recovered-link').value='';
    $('#recovery-verified').checked=false;$('#recovery-reason').value='';
    $('#detail-modal').hidden=false;$('#detail-status').focus();
  }
  function render(){
    for(const [suffix,key] of [['total','all'],['pending','pending'],['progress','in_progress'],['done','completed']])$('#metric-'+suffix).textContent=counts[key] || 0;
    for(const [suffix,key] of [['all','all'],['pending','pending'],['progress','in_progress'],['done','completed']])$('#count-'+suffix).textContent=counts[key] || 0;
    $('#appointments-table').innerHTML=appointments.map(item=>{
      const canDetail=admin() || owns(item),claimable=!item.assignedTo && ['pending','awaiting_claim'].includes(item.status);
      const status=canDetail ? `<select class="status-select" data-id="${item.id}" aria-label="修改 ${item.id} 状态">${options(item)}</select>` : `<span class="status-pill ${statusClass[item.status]}">${statusLabels[item.status]}</span>`;
      return `<tr><td><span class="person-name">${escapeHtml(item.name || '待接单预约')}</span><span class="person-code">${escapeHtml(item.studentId || '')} · ${item.id}</span></td><td>${escapeHtml(item.deviceType)}<span class="person-code">${escapeHtml(item.campus)} · ${escapeHtml(item.brand)} ${escapeHtml(item.deviceModel)}</span></td><td>${formatDate(item.date)}<span class="person-code">${escapeHtml(item.timeSlot)}</span></td><td>${status}</td><td>${escapeHtml(item.repairNote || item.faultType || '暂无记录')}</td><td>${claimable ? `<button class="record-btn" data-claim="${item.id}">接单</button>` : ''}${canDetail ? `<button class="record-btn" data-detail="${item.id}">详情</button>` : ''}</td></tr>`;
    }).join('');
    $('#staff-empty').hidden=appointments.length>0;
    $$('[data-claim]').forEach(button=>button.addEventListener('click',async()=>{
      const item=appointments.find(entry=>entry.id===button.dataset.claim);button.disabled=true;
      try{await patch(item,{status:'claimed',assignedTo:sessionStorage.getItem('pioneerAccount')});showToast('已成功接单');}
      catch(error){showToast(error.message);}
      finally{button.disabled=false;}
    }));
    $$('[data-detail]').forEach(button=>button.addEventListener('click',()=>openDetail(appointments.find(entry=>entry.id===button.dataset.detail))));
    $$('.status-select').forEach(select=>select.addEventListener('change',async()=>{
      const item=appointments.find(entry=>entry.id===select.dataset.id),previous=item.status;
      select.disabled=true;
      try{await patch(item,{status:select.value});showToast('状态已更新');}
      catch(error){select.value=previous;showToast(error.message);}
      finally{select.disabled=false;}
    }));
  }
  $('#save-detail').addEventListener('click',async()=>{
    if(!detailItem)return;
    const button=$('#save-detail');button.disabled=true;
    try{await patch(detailItem,{status:$('#detail-status').value,assignedTo:$('#detail-assigned').value.trim(),repairNote:$('#detail-repair-note').value.trim()});close();showToast('维修记录已保存');}
    catch(error){showToast(error.message);}
    finally{button.disabled=false;}
  });
  $('#recover-access').addEventListener('click',async()=>{
    if(!detailItem)return;
    const button=$('#recover-access');button.disabled=true;
    try{
      const result=await apiJson(`/api/appointments/${encodeURIComponent(detailItem.id)}/credential`,{method:'POST',json:{identityVerified:$('#recovery-verified').checked,reason:$('#recovery-reason').value.trim()}});
      const url=new URL('/',location.origin);url.hash=new URLSearchParams({appointment:result.id,access:result.accessToken}).toString();
      $('#recovered-link').value=url.href;$('#recovery-result').hidden=false;
      await refresh();detailItem=appointments.find(item=>item.id===result.id);showToast('新凭证已签发，旧凭证立即失效');
    }catch(error){showToast(error.message);}
    finally{button.disabled=false;}
  });
  $('#copy-recovered-link').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText($('#recovered-link').value);showToast('新私人链接已复制，请交给核验通过的本人');}
    catch{$('#recovered-link').select();showToast('请复制选中的私人链接');}
  });
  $$('.filter-tab').forEach(button=>button.addEventListener('click',()=>{
    activeFilter=button.dataset.filter;$$('.filter-tab').forEach(item=>item.classList.toggle('is-active',item===button));refresh();
  }));
  $('#staff-search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(refresh,200);});
  $('#staff-campus-filter').addEventListener('change',refresh);$('#staff-date-filter').addEventListener('change',refresh);
  $('#staff-clear-filters').addEventListener('click',()=>{
    $('#staff-campus-filter').value='all';$('#staff-date-filter').value='';$('#staff-search').value='';activeFilter='all';
    $$('.filter-tab').forEach(item=>item.classList.toggle('is-active',item.dataset.filter==='all'));refresh();
  });
  $('#close-detail').addEventListener('click',close);$('#cancel-detail').addEventListener('click',close);
  $('#detail-modal').addEventListener('click',event=>{if(event.target.id==='detail-modal')close();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
  $('#export-csv').addEventListener('click',async()=>{
    try{
      const response=await apiFetch('/api/export/appointments.csv');if(!response.ok)throw new Error((await response.json()).error);
      const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download='先锋硬件部维修预约.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
    }catch(error){showToast(error.message);}
  });
  render();
  return{refresh,clear(){generation++;clearTimeout(searchTimer);appointments=[];counts={};close();render();}};
}
