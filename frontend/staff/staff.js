import {initIntake} from './intake.js';
import {initOverview} from './overview.js';
import {initColumnMenus} from './column-menus.js';
import {initAssigneePicker} from './assignee-picker.js';
import {drawSignature} from '/shared/signature.js';
import {attachmentSize,attachmentUrl} from '/shared/attachments.js';
import {$,$$,showToast,escapeHtml,assigneeLabel} from '/shared/utils.js';
import {apiFetch,apiJson} from '/shared/api.js';
import {formatDate,formatInstant,dateKey,timeLabel} from '/shared/time.js';
import {statusLabels,statusClass,outcomeLabels,repairOutcomes,roleLevel,endTimeLabels,expirationMessage} from '/shared/constants.js';
export function initStaff(){
  let activeFilter='all',generation=0,searchTimer,detailItem;
  let appointments=[],counts={},filteredCounts={};
  const menus=initColumnMenus(()=>refreshList());
  const assigneePicker=initAssigneePicker();
  const overview=initOverview(selection=>{
    $('#staff-campus-filter').value=selection.campus;$('#staff-date-filter').value=selection.date;$('#staff-slot-filter').value=selection.timeSlot;
    $('#staff-date-filter').dataset.from=selection.dateFrom || '';$('#staff-date-filter').dataset.to=selection.dateTo || '';
    clearTimeout(searchTimer);$('#staff-search').value='';activeFilter=selection.status || 'all';updateFilterButtons();refreshList();
    if(selection.navigate!==false)$('#staff-list-title').scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
  });
  const intake=initIntake(async(item,photos)=>{ await openDetail(await patch(item,{status:'in_progress',...photos})); });
  const admin=()=>roleLevel[sessionStorage.getItem('pioneerRole')]>=2;
  const owns=item=>item.assignedTo===sessionStorage.getItem('pioneerAccount') || !!item.assignedMemberId && item.assignedMemberId===sessionStorage.getItem('pioneerMemberId');
  async function refresh(){
    configureCampuses();
    await Promise.allSettled([refreshList(),overview.refresh()]);
  }
  function configureCampuses(){
    const allowed=JSON.parse(sessionStorage.getItem('pioneerCampuses') || '[]');
    $('.staff-metrics-caption').textContent=admin() ? '授权校区内的全部记录' : '授权校区内待签到及本人维修记录';
    for(const option of $('#staff-campus-filter').options) if(option.value!=='all') option.hidden=option.disabled=!allowed.includes(option.value);
    if($('#staff-campus-filter').value!=='all' && !allowed.includes($('#staff-campus-filter').value)) $('#staff-campus-filter').value='all';
  }
  async function refreshList(){
    menus.update(activeFilter);
    const current=++generation;
    const query=new URLSearchParams({status:activeFilter,q:$('#staff-search').value.trim(),campus:$('#staff-campus-filter').value,date:$('#staff-date-filter').value,timeSlot:$('#staff-slot-filter').value,sorts:menus.query()});
    if($('#staff-date-filter').dataset.from){query.set('dateFrom',$('#staff-date-filter').dataset.from);query.set('dateTo',$('#staff-date-filter').dataset.to);}
    try{
      const result=await apiJson(`/api/appointments?${query}`);
      if(current!==generation)return;
      appointments=result.items;counts=result.counts;filteredCounts=result.filteredCounts || result.counts;render();
    }catch(error){if(current===generation){$('#staff-list-summary').textContent='读取失败，显示上次结果；请刷新重试。';showToast(error.message);}}
  }
  async function patch(item,input){
    const updated=await apiJson(`/api/appointments/${encodeURIComponent(item.id)}/status`,{method:'PATCH',json:{...input,revision:item.revision}});
    await refresh();
    return updated;
  }
  async function openAttachment(item,id){
    const response=await apiFetch(attachmentUrl(item.id,id));
    if(!response.ok)throw new Error('附件读取失败');
    const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');
    link.href=url;link.download='维修附件';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  function close(){
    assigneePicker.reset();
    detailItem=undefined;$('#detail-modal').hidden=true;$('#recovered-link').value='';$('#recovery-result').hidden=true;
    $('#recovery-verified').checked=false;$('#recovery-reason').value='';
  }
  async function openDetail(item){
    detailItem=item;
    let files;
    try{files=(await apiJson(`/api/appointments/${encodeURIComponent(item.id)}/attachments`)).items;}
    catch(error){showToast(error.message);return;}
    if(detailItem!==item)return;
    $('#detail-summary').innerHTML=`<strong>${escapeHtml(item.name)} · 预约编号 ${escapeHtml(item.id)}</strong>${item.repairNumber ? `<span>历史维修编号：${escapeHtml(item.repairNumber)}</span>` : ''}<span>${escapeHtml(item.studentId)} · ${escapeHtml(item.campus)} · ${formatDate(item.date)} ${escapeHtml(item.timeSlot)}</span><span>${escapeHtml(item.deviceType)} · ${escapeHtml(item.brand)} ${escapeHtml(item.deviceModel)} · 保修 ${escapeHtml(item.warranty)}</span>${item.liquidMetal ? `<span>液金散热：${escapeHtml(item.liquidMetal)}${item.dellG15 ? ' · Dell G15：'+escapeHtml(item.dellG15) : ''}</span>` : ''}<span>QQ / 微信：${escapeHtml(item.social)} · 手机：${escapeHtml(item.phone || '未填写')}</span>${item.email ? `<span>联系邮箱：${escapeHtml(item.email)}</span>` : ''}<p>${escapeHtml(item.issue || '未填写故障描述')}</p>${item.note ? `<p>备注：${escapeHtml(item.note)}</p>` : ''}<div class="detail-attachments">${files.map(file=>`<button class="attachment-link" data-attachment-id="${file.id}" type="button">${escapeHtml(file.filename)} <small>${attachmentSize(file.size)}</small></button>`).join('')}</div>`;
    $$('[data-attachment-id]',$('#detail-summary')).forEach(button=>button.addEventListener('click',()=>openAttachment(item,button.dataset.attachmentId).catch(error=>showToast(error.message))));
    $('#detail-signature').hidden=!item.signature;
    if(item.signature)drawSignature($('#detail-signature'),JSON.parse(item.signature));
    $('#detail-state').textContent=statusLabels[item.status]+(item.outcome ? ` · ${outcomeLabels[item.outcome]}` : '');
    $('#detail-assigned').value=assigneeLabel(item.assignedTo,item.assignedToName);$('#detail-repair-note').value=item.repairNote;
    $('#detail-repair-note').readOnly=item.status!=='in_progress' && !admin();
    $('#detail-times').textContent=`开始：${formatInstant(item.startedAt)} · ${endTimeLabels[item.status] || '结束时间'}：${formatInstant(item.completedAt)} · 有效截止：${formatInstant(item.expiresAt)}`;
    $('#detail-expiration-message').hidden=item.status!=='expired';$('#detail-expiration-message').textContent=expirationMessage;
    $('#detail-outcome').innerHTML='<option value="">请选择维修结果</option>'+repairOutcomes.map(value=>`<option value="${value}" ${item.outcome===value ? 'selected' : ''}>${outcomeLabels[value]}</option>`).join('');
    $('#repair-result-field').hidden=item.status!=='in_progress';
    $('#save-detail').hidden=item.status!=='in_progress';$('#complete-detail').hidden=item.status!=='in_progress';
    $('#start-detail').hidden=item.status!=='booked';
    $('#correction-panel').hidden=!admin();$('#correction-panel').open=false;
    $('#correction-status').innerHTML=Object.entries(statusLabels).map(([value,label])=>`<option value="${value}" ${value===item.status ? 'selected' : ''}>${label}</option>`).join('');
    assigneePicker.reset(admin() ? item : undefined);
    $('#correction-outcome').innerHTML='<option value="">保留现有结果</option>'+repairOutcomes.map(value=>`<option value="${value}" ${value===item.outcome ? 'selected' : ''}>${outcomeLabels[value]}</option>`).join('');
    $('#correction-reason').value='';
    $('#correction-expires').value=item.expiresAt ? `${dateKey(new Date(item.expiresAt))}T${timeLabel(new Date(item.expiresAt))}` : '';
    updateCorrectionFields();
    $('#recovery-panel').hidden=!admin();$('#recovery-result').hidden=true;$('#recovered-link').value='';
    $('#recovery-verified').checked=false;$('#recovery-reason').value='';
    $('#detail-modal').hidden=false;$('#close-detail').focus();
  }
  function render(){
    for(const [suffix,key] of [['total','all'],['booked','booked'],['progress','in_progress'],['done','completed'],['cancelled','cancelled'],['expired','expired']])$('#metric-'+suffix).textContent=counts[key] || 0;
    for(const [suffix,key] of [['all','all'],['booked','booked'],['progress','in_progress'],['done','completed'],['cancelled','cancelled'],['expired','expired']])$('#count-'+suffix).textContent=filteredCounts[key] || 0;
    $('#count-pending').textContent=(filteredCounts.booked || 0)+(filteredCounts.in_progress || 0);
    $('#staff-list-summary').textContent=`当前 ${appointments.length} 条 · 状态数量按当前筛选统计`;
    $('#appointments-table').innerHTML=appointments.map(item=>{
      const canDetail=admin() || (item.status!=='booked' && owns(item));
      const status=`<span class="status-pill ${statusClass[item.status]}">${statusLabels[item.status]}</span>${item.outcome ? `<span class="person-code">${outcomeLabels[item.outcome]}</span>` : ''}`;
      return `<tr><td><span class="person-name">${escapeHtml(item.name || '等待到场')}</span><span class="person-code">${escapeHtml(item.studentId || '')} · ${item.id}</span>${item.repairNumber ? `<span class="person-code">历史维修编号：${escapeHtml(item.repairNumber)}</span>` : ''}</td><td>${formatDate(item.date)}<span class="person-code">${escapeHtml(item.timeSlot)}</span></td><td>${status}</td><td class="staff-record-campus">${escapeHtml(item.campus)}</td><td>${escapeHtml(item.deviceType)}<span class="person-code">${escapeHtml(item.brand)} ${escapeHtml(item.deviceModel)}</span></td><td><span class="staff-record-note">${escapeHtml(item.repairNote || item.faultType || '暂无记录')}</span></td><td><div class="record-actions">${item.status==='booked' ? `<button class="record-btn" data-start="${item.id}">签到并开始维修</button>` : ''}${canDetail && item.status==='in_progress' ? `<button class="record-btn" data-finish="${item.id}">填写结果并结束</button>` : ''}${canDetail ? `<button class="record-btn" data-detail="${item.id}">详情</button>` : ''}</div></td></tr>`;
    }).join('');
    $('#staff-empty').hidden=appointments.length>0;
    $$('[data-start]').forEach(button=>button.addEventListener('click',()=>intake.open(appointments.find(entry=>entry.id===button.dataset.start))));
    $$('[data-detail]').forEach(button=>button.addEventListener('click',()=>openDetail(appointments.find(entry=>entry.id===button.dataset.detail))));
    $$('[data-finish]').forEach(button=>button.addEventListener('click',()=>openDetail(appointments.find(entry=>entry.id===button.dataset.finish))));
  }
  $('#save-detail').addEventListener('click',async()=>{
    if(!detailItem)return;
    const button=$('#save-detail');button.disabled=true;
    try{await patch(detailItem,{repairNote:$('#detail-repair-note').value.trim()});close();showToast('维修说明已保存');}
    catch(error){showToast(error.message);}
    finally{button.disabled=false;}
  });
  $('#complete-detail').addEventListener('click',async()=>{
    if(!detailItem)return;
    const outcome=$('#detail-outcome').value,repairNote=$('#detail-repair-note').value.trim();
    if(!outcome || !repairNote){showToast('请选择维修结果并填写维修说明');return;}
    const button=$('#complete-detail');button.disabled=true;
    try{const updated=await patch(detailItem,{status:'completed',outcome,repairNote});close();showToast(`维修已结束，预约编号：${updated.id}`);}
    catch(error){showToast(error.message);}
    finally{button.disabled=false;}
  });
  $('#start-detail').addEventListener('click',()=>{ if(detailItem)intake.open(detailItem); });
  function updateCorrectionFields(){
    $('#correction-result-field').hidden=$('#correction-status').value!=='completed';
    $('#correction-expiry-field').hidden=$('#correction-status').value!=='booked';
  }
  $('#correction-status').addEventListener('change',updateCorrectionFields);
  $('#apply-correction').addEventListener('click',async()=>{
    if(!detailItem)return;
    const status=$('#correction-status').value,correctionReason=$('#correction-reason').value.trim();
    if(correctionReason.length<8){showToast('请填写至少 8 字的纠错原因');return;}
    const deadline=$('#correction-expires').value;
    if(status==='booked' && (!deadline || !Number.isFinite(Date.parse(`${deadline}:00+08:00`)))){showToast('请填写新的有效截止时间');return;}
    if(!window.confirm('确认修正此记录？恢复为已预约会清空原签到信息，并要求重新签到。'))return;
    const button=$('#apply-correction');button.disabled=true;
    const outcome=$('#correction-outcome').value;
    try{await patch(detailItem,{action:'correct',status,correctionReason,assignedTo:assigneePicker.value(),repairNote:$('#detail-repair-note').value.trim(),...(status==='completed' && outcome ? {outcome} : {}),...(status==='booked' ? {expiresAt:`${deadline}:00+08:00`} : {})});close();showToast('记录已修正');}
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
    activeFilter=button.dataset.filter;updateFilterButtons();refreshList();
  }));
  function updateFilterButtons(){
    menus.update(activeFilter);
    $$('.filter-tab').forEach(item=>{const selected=item.dataset.filter===activeFilter;item.classList.toggle('is-active',selected);item.setAttribute('aria-pressed',String(selected));});
  }
  $('#staff-search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(refreshList,200);});
  for(const id of ['staff-campus-filter','staff-date-filter','staff-slot-filter']) $('#'+id).addEventListener('change',refreshList);
  $('#staff-refresh').addEventListener('click',refresh);
  $('#staff-clear-filters').addEventListener('click',()=>{
    clearTimeout(searchTimer);$('#staff-campus-filter').value='all';$('#staff-date-filter').value='';$('#staff-search').value='';$('#staff-slot-filter').value='';activeFilter='all';
    $('#staff-date-filter').dataset.from='';$('#staff-date-filter').dataset.to='';
    menus.reset();updateFilterButtons();refreshList();
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
  return{refresh,clear(){generation++;clearTimeout(searchTimer);appointments=[];counts={};filteredCounts={};activeFilter='all';
    $('#staff-campus-filter').value='all';$('#staff-date-filter').value='';$('#staff-slot-filter').value='';$('#staff-search').value='';
    $('#staff-date-filter').dataset.from='';$('#staff-date-filter').dataset.to='';
    menus.reset();updateFilterButtons();overview.clear();intake.close();close();render();}};
}
