import { openDeviceEditor } from './device-edit.js';
import { $,showToast,escapeHtml } from '/shared/utils.js';
import { apiJson,apiBlob } from '/shared/api.js';
import { startVisiblePolling } from '/shared/polling.js';
import { attachmentUrl,attachmentSize } from '/shared/attachments.js';
import { formatDate } from '/shared/time.js';
import { statusClass,outcomeLabels,terminalStatuses } from '/shared/constants.js';
import { savedAppointments,saveAppointment,privateLink,parsePrivateLink,credentialHeaders,credentialStorageError,copyPrivateLink } from './credentials.js';
import { queueTicketLabel } from '/shared/reception.js';
import { renderRepairQr } from './repair-qr.js';
import { timeSummary,timeLabel,informationGroups,statusText,statusExplanation,repairRecord } from './presentation.js';
import { createPhotoCollection,previewPhoto } from './photos.js';
import { createFollowupPanel,currentFollowup } from './followups.js';

export function initLookup({onNavigate=()=>{},onAddDevice=()=>{},onRebook=()=>{},hasDraft=()=>false,hasPending=()=>false}={}) {
  const root=$('#lookup-results'),detail=$('#appointment-detail');
  const records=new Map(),followupCommands=new Map(),followupMessages=new Map(),followupBusy=new Set();let active=false,detailId=null,generation=0,refreshing=false,importing=false,cancelling=false,detailPhotos=null,deadlineTimer,viewVersion=0;
  const urls=new Set();
  const request=entry=>apiJson(`/api/appointments/${encodeURIComponent(entry.id)}`,{headers:credentialHeaders(entry),timeoutMs:15000}).then(item=>({...item,accessToken:entry.accessToken}));
  function readEntries(){for(const entry of savedAppointments()){const previous=records.get(entry.id);if(!previous || previous.entry.accessToken!==entry.accessToken)records.set(entry.id,{entry,item:previous?.item,message:'',receivedAt:Date.now()});}}
  function commit(item){const old=records.get(item.id);if(old?.item && (old.item.revision>item.revision || (old.item.revision===item.revision && (old.item.currentLocationRevision ?? -1)>(item.currentLocationRevision ?? -1))))return;
    records.set(item.id,{entry:{id:item.id,accessToken:item.accessToken},item,message:'',receivedAt:Date.now()});}
  function setNotice(target,message){target.hidden=!message;target.textContent=message;}
  function openImport(){const form=$('#import-form');form.hidden=false;$('#import-appointment').setAttribute('aria-expanded','true');$('#private-link-input').focus();}
  function currentView(item){
    const followup=currentFollowup(item);
    return {followup, view:followup?.appointment ? {...item,...followup.appointment} : item};
  }
  function card(item){
    const {followup,view}=currentView(item),pending=followup?.request.status==='pending';
    return `<button type="button" class="student-record" data-detail-id="${escapeHtml(item.id)}"><span class="record-top"><strong>${escapeHtml(item.deviceType)} · ${escapeHtml(item.brand)}</strong><span class="status-pill ${statusClass[pending ? 'booked' : view.status]}">${pending ? '待安排返修' : statusText(view)}</span></span><p>${followup ? `返修${followup.round ? ' · 第 '+followup.round+' 轮' : ''} · ` : ''}${escapeHtml(view.campus)}校区${pending ? '' : ` · ${formatDate(view.date)} · ${escapeHtml(timeLabel(view))}`}</p><p>${escapeHtml(followup?.request.reason || item.faultType)}${!followup && item.status==='completed' ? ' · '+escapeHtml(outcomeLabels[item.outcome] || '历史未分类') : ''}</p>${!followup && item.status==='completed' && item.repairNote ? `<p>${escapeHtml(item.repairNote.slice(0,90))}${item.repairNote.length>90 ? '…' : ''}</p>` : ''}</button>`;
  }
  function renderList(){
    const entries=[...records.values()],items=entries.filter(row=>row.item).map(row=>row.item),failed=entries.filter(row=>row.message),unknown=entries.filter(row=>!row.item && !row.message);
    $('#import-appointment').hidden=!entries.length && !credentialStorageError();
    const currentById=new Map();
    for(const item of items){
      const {followup,view}=currentView(item);
      if(terminalStatuses.includes(item.status) && !followup)continue;
      const key=followup?.request.id || view.id;
      if(!currentById.has(key) || view.id===item.id)currentById.set(key,item);
    }
    const current=[...currentById.values()].sort((a,b)=>{
      const left=currentView(a).view,right=currentView(b).view;
      return Number(right.status==='in_progress')-Number(left.status==='in_progress') || (left.date+left.timeSlot).localeCompare(right.date+right.timeSlot);
    });
    const history=items.filter(item=>terminalStatuses.includes(item.status) && !currentFollowup(item)).sort((a,b)=>(b.date+b.timeSlot).localeCompare(a.date+a.timeSlot));
    let html;
    if(!entries.length && !credentialStorageError())html='<div class="empty-state"><h2>这里空空如也哦，快去预约一个吧</h2><button type="button" class="primary-btn" data-book-new>去预约</button><p><button type="button" class="text-btn" data-open-import>已有预约？通过私人查询链接查看</button></p></div>';
    else {
      html=`<section class="record-group"><h2>当前预约${current.length ? ` · ${current.length}` : ''}</h2>${current.map(card).join('') || '<p class="field-hint">暂无当前预约。</p>'}</section><section class="record-group"><h2>历史预约${history.length ? ` · ${history.length}` : ''}</h2>${history.map(card).join('') || '<p class="field-hint">暂无历史预约。</p>'}</section>`;
      html+=unknown.map(row=>`<article class="notice" aria-busy="true">${escapeHtml(row.entry.id)} · 正在读取预约…</article>`).join('');
      html+=failed.map(row=>`<article class="notice is-error"><strong>${escapeHtml(row.entry.id)} · 暂时无法${row.item ? '更新' : '读取'}</strong><p>${escapeHtml(row.message)}</p><button class="secondary-btn" type="button" data-retry-id="${escapeHtml(row.entry.id)}">重试此预约</button></article>`).join('');
    }
    if(root.innerHTML!==html)root.innerHTML=html;
    setNotice($('#lookup-notice'),credentialStorageError() ? '本机保存的预约记录暂时无法读取。请重试，或通过完整私人查询链接查看。' : failed.length ? '部分预约暂时无法更新，已保留最近确认的信息。' : '');
  }
  function existingPhotos(){return records.get(detailId)?.item?.attachments?.filter(file=>['general','student_photo'].includes(file.purpose) && file.mimeType.startsWith('image/')) || [];}
  function releaseUrls(){urls.forEach(url=>URL.revokeObjectURL(url));urls.clear();}
  function mountDetail(item){detailPhotos?.dispose();releaseUrls();clearTimeout(deadlineTimer);
    detail.innerHTML=`<section class="detail-section" id="detail-summary" aria-live="polite" aria-atomic="true"></section><section id="detail-queue" class="detail-section" aria-label="现场排队" hidden></section><section id="detail-current-qr" class="detail-section" hidden></section><div id="detail-repair-record"></div><details id="detail-source-data" open><summary hidden>原工单资料</summary><section class="detail-section"><h2>预约凭证</h2><dl>${item ? `<div><dt>预约编号</dt><dd>${escapeHtml(item.id)}</dd></div>${item.repairNumber ? `<div><dt>历史维修编号</dt><dd>${escapeHtml(item.repairNumber)}</dd></div>` : ''}` : ''}</dl><div id="detail-qr"></div><button class="secondary-btn" id="detail-copy-link" type="button">复制私人查询链接</button><input class="private-link-fallback" id="detail-private-link" type="text" readonly hidden aria-label="私人查询链接" /></section><section class="detail-section"><div id="detail-information"></div><h3>已上传的照片与历史附件</h3><div id="detail-attachments"></div></section><section class="detail-section" id="detail-contacts"></section><section class="detail-section" id="detail-photo-upload"><h2>补充故障照片</h2><div id="detail-photos"></div><button class="primary-btn" id="detail-upload" type="button">上传所选照片</button><p id="detail-upload-message" role="status"></p></section></details><section class="detail-section" id="detail-devices" hidden></section><section class="detail-section" id="detail-operations"></section>`;
    detailPhotos=createPhotoCollection($('#detail-photos'),{existingCount:()=>existingPhotos().length,onUploadChange:entries=>{
      const busy=entries.some(entry=>entry.state==='uploading');$('#detail-upload').disabled=busy;$('#detail-upload').textContent=busy ? '正在上传…' : '上传所选照片';
      $('#detail-upload-message').textContent=entries.some(entry=>entry.state==='upload-error') ? '部分照片未上传，可再次点击上传重试。已成功的照片不会重复上传。' : '';
    }});
    $('#detail-copy-link').addEventListener('click',()=>void copyPrivateLink(records.get(detailId).item,$('#detail-private-link'),showToast));
    $('#detail-upload').addEventListener('click',async()=>{
      const id=detailId,item=records.get(id)?.item;if(!item || !detailPhotos.entries().length){$('#detail-upload-message').textContent='请先选择照片。';return;}
      if(!detailPhotos.validity())return;
      const collection=detailPhotos;await collection.uploadAll(item);if(id!==detailId)return;
      generation++;refreshing=false;await refresh();if(id!==detailId)return;
      if(collection.entries().every(entry=>entry.attachment)){collection.reset();$('#detail-upload-message').textContent='照片已上传。';}
    });
    if(item){const historic=terminalStatuses.includes(item.status),qr=$('#detail-qr'),details=document.createElement('details');
      const summary=document.createElement('summary');summary.textContent=historic ? '查看历史维修二维码' : '出示维修二维码';const content=document.createElement('div');details.append(summary,content);qr.append(details);
      if(historic){const hint=document.createElement('p');hint.dataset.historyQr='true';hint.className='field-hint';hint.textContent='仅供工作人员查询历史记录，不代表预约仍然有效';content.append(hint);}
      let loaded=false;details.addEventListener('toggle',()=>{if(details.open && !loaded){loaded=true;const target=document.createElement('div');content.prepend(target);void renderRepairQr(target,item);}});
      details.dataset.status=item.status;details.open=!historic;
    }
    $('#detail-summary').after($('#detail-devices'));
    updateDetail();
  }
  function setMarkup(element,html){if(element.dataset.renderMarkup===html)return;const expanded=new Set([...element.querySelectorAll('details[open]')].map(details=>details.querySelector('summary')?.textContent));element.innerHTML=html;for(const details of element.querySelectorAll('details'))if(expanded.has(details.querySelector('summary')?.textContent))details.open=true;element.dataset.renderMarkup=html;}
  function queuedAppointment(item) {
    if(item.status==='booked')return item;
    return item.repairHistory?.items.find(child=>child.status==='booked' && child.registrationFlow==='repair_followup' &&
      (['queued','assigned'].includes(child.reception?.state) || child.reception?.leftAt)) || item;
  }
  function updateDetail(){const record=records.get(detailId),item=record?.item;if(!item)return;
    const devices=$('#detail-devices');devices.hidden=!item.canEditDevice && !item.canAddDevice && !item.relatedDevices?.length;
    if(!devices.querySelector('[data-device-links]'))devices.innerHTML='<div data-device-links></div><details class="appointment-edit"><summary>修改预约</summary><div class="actions"><button type="button" class="secondary-btn" data-edit-device>修改设备信息</button><button type="button" class="secondary-btn" data-add-device aria-expanded="false">添加一台设备</button></div><div data-add-device-prompt hidden><p>添加设备会替换尚未提交的预约填写内容，是否继续？</p><div class="actions"><button type="button" class="secondary-btn" data-add-device-keep>保留原填写</button><button type="button" class="primary-btn" data-add-device-confirm>放弃原填写，开始补约</button></div></div><div data-device-editor hidden></div></details>';
    setMarkup(devices.querySelector('[data-device-links]'),item.relatedDevices?.length ? `<h2>同次到场的设备</h2>${item.relatedDevices.map(device=>`<p>${escapeHtml(device.brand)} ${escapeHtml(device.deviceModel || device.deviceType)} · ${escapeHtml(statusText(device))}<br><small>${escapeHtml(device.id)}</small></p>`).join('')}` : '');
    devices.querySelector('[data-edit-device]').hidden=!item.canEditDevice;
    devices.querySelector('[data-add-device]').hidden=!item.canAddDevice;
    devices.querySelector('.appointment-edit').hidden=!item.canEditDevice && !item.canAddDevice && !devices.querySelector('[data-device-editor] form');
    clearTimeout(deadlineTimer);
    const serverOffset=item.serverNow && record.receivedAt ? Date.parse(item.serverNow)-record.receivedAt : 0;
    const deadline=Date.parse(item.expiresAt)-(Date.now()+serverOffset);
    if(item.status==='booked' && deadline>0 && deadline<2147480000)deadlineTimer=setTimeout(()=>{if(active && !document.hidden)void refresh();},deadline+1000);
    setNotice($('#detail-notice'),record.message ? '暂时无法更新。'+record.message : '');
    const {followup,view}=currentView(item),pendingFollowup=followup?.request.status==='pending';
    setMarkup($('#detail-summary'),`${followup ? `<h2>当前返修${followup.round ? ' · 第 '+followup.round+' 轮' : ''}</h2><p class="field-hint">${escapeHtml(view.id)}</p>` : ''}<span class="status-pill ${statusClass[pendingFollowup ? 'booked' : view.status]}">${pendingFollowup ? '待安排' : statusText(view)}</span>${pendingFollowup ? `<p>${escapeHtml(followup.request.reason)}</p>` : `<div class="selection-summary">${timeSummary(view)}</div><p class="field-hint">${escapeHtml(statusExplanation(view))}</p>`}${record.message ? '<button type="button" class="secondary-btn" data-detail-retry>重试</button>' : ''}`);
    const currentQr=$('#detail-current-qr');
    const qrChild=followup?.appointment;
    currentQr.hidden=!(qrChild && qrChild.id!==item.id && qrChild.status==='booked');
    if(!currentQr.hidden && currentQr.dataset.followupId!==followup.request.id){
      currentQr.innerHTML=`<button type="button" class="secondary-btn" data-followup-qr="${escapeHtml(followup.request.id)}" data-followup-appointment="${escapeHtml(qrChild.id)}">显示返修维修码</button><div class="followup-qr-container"></div>`;
      currentQr.dataset.followupId=followup.request.id;
    } else if(currentQr.hidden){currentQr.replaceChildren();delete currentQr.dataset.followupId;}
    const sourceData=$('#detail-source-data'),isPrevious=!!followup && (!followup.appointment || view.id!==item.id);
    sourceData.querySelector('summary').hidden=!isPrevious;
    if(sourceData.dataset.previous!==String(isPrevious))sourceData.open=!isPrevious;
    sourceData.dataset.previous=String(isPrevious);
    $('#detail-photo-upload').hidden=isPrevious;
    const previousRecord=$('#detail-repair-record');
    setMarkup(previousRecord,followup && (!followup.appointment || view.id!==item.id) ? `<details class="detail-section"><summary>上轮维修 · ${escapeHtml(statusText(item))}</summary>${repairRecord(item)}</details>` : repairRecord(item));
    const queued=queuedAppointment(item),queue=$('#detail-queue'),waiting=queued.status==='booked' && ['queued','assigned'].includes(queued.reception?.state);
    if(queue.dataset.appointmentId!==queued.id){queue.replaceChildren();delete queue.dataset.renderMarkup;queue.dataset.appointmentId=queued.id;}
    queue.hidden=!waiting && !(queued.status==='booked' && queued.reception?.leftAt);
    if(waiting){
      const position=queued.queuePosition;
      if(!queue.querySelector('[data-queue-stats]')){delete queue.dataset.renderMarkup;queue.innerHTML='<div data-queue-stats aria-live="polite" aria-atomic="true"></div><p><button type="button" class="text-btn" data-queue-refresh>刷新排位</button></p><button type="button" class="secondary-btn" data-queue-leave>临时离开，退出排队</button><div data-queue-confirm hidden><p>退出后保留预约，并释放已安排的维修人员。再到场需重新核验，排在队尾；不会保留原排号。</p><div class="actions"><button type="button" class="secondary-btn" data-queue-keep>继续排队</button><button type="button" class="secondary-btn danger-btn" data-queue-exit>确认退出排队</button></div></div><p data-queue-message role="status"></p>';}
      setMarkup(queue.querySelector('[data-queue-stats]'),`<h2>${queued.id===item.id ? '现场排队' : '返修现场排队'}</h2>${queued.id!==item.id ? `<p>返修单 ${escapeHtml(queued.id)}</p>` : ''}<div class="customer-queue"><div><span>你的现场排号</span><strong>${escapeHtml(queueTicketLabel(queued.reception.ticket) || '排号读取中')}</strong><small>${escapeHtml(queued.campus)}校区 · ${escapeHtml(queued.reception.ticket?.date || queued.date)}</small></div><div><span>当前排第</span><strong>${position?.position ?? '—'}<small> 位</small></strong><small>前面 ${position ? position.position-1 : '—'} 位 · 共 ${position?.total ?? '—'} 位等待</small></div></div><p class="field-hint">${queued.reception.state==='assigned' ? '已分派 · 待现场核对' : '待分派'}</p>`);
    } else if(queued.status==='booked' && queued.reception?.leftAt) setMarkup(queue,'<h2>已退出现场排队</h2><p>预约已保留</p>');
    setMarkup($('#detail-information'),informationGroups(item,{photos:false,contacts:false}));setMarkup($('#detail-contacts'),informationGroups(item,{device:false}));
    const files=item.attachments || [];
    setMarkup($('#detail-attachments'),files.length ? files.map(file=>`<button class="text-btn" type="button" data-attachment-id="${escapeHtml(file.id)}">${escapeHtml(file.filename)} · ${attachmentSize(file.size)}${file.purpose==='intake_front' ? ' · 接待正面照片' : file.purpose==='intake_back' ? ' · 接待背面照片' : ''}</button>`).join('') : '<p class="field-hint">暂无照片或附件。</p>');
    const qrDetails=$('#detail-qr details');
    if(qrDetails && qrDetails.dataset.status!==item.status){
      if(terminalStatuses.includes(item.status)){
        qrDetails.open=false;qrDetails.querySelector('summary').textContent='查看历史维修二维码';
        if(!qrDetails.querySelector('[data-history-qr]')){const hint=document.createElement('p');hint.dataset.historyQr='true';hint.className='field-hint';hint.textContent='仅供工作人员查询历史记录，不代表预约仍然有效';qrDetails.append(hint);}
      } else if(terminalStatuses.includes(qrDetails.dataset.status)){
        qrDetails.querySelector('[data-history-qr]')?.remove();qrDetails.querySelector('summary').textContent='出示维修二维码';qrDetails.open=true;
      }
      qrDetails.dataset.status=item.status;
    }
    const followupSignature=JSON.stringify({status:item.status,history:item.repairHistory,message:followupMessages.get(item.id)||''},(key,value)=>['queuePosition','revision','reception'].includes(key) ? undefined : value);
    let followupPanel=detail.querySelector('[data-followup-panel]');
    if(followupPanel?.dataset.signature!==followupSignature){
      const previousInput=followupPanel?.querySelector('[name=reason]');
      const previousReason=previousInput?.value || '';
      const focusedReason=previousInput && document.activeElement===previousInput;
      const selection=focusedReason ? [previousInput.selectionStart,previousInput.selectionEnd] : null;
      const archiveOpen=followupPanel?.querySelector('.repair-history-details')?.open;
      const nextPanel=createFollowupPanel(item,followupMessages.get(item.id)||'');
      nextPanel.dataset.followupPanel='true';nextPanel.dataset.signature=followupSignature;
      const nextReason=nextPanel.querySelector('[name=reason]');
      if(nextReason && previousReason)nextReason.value=previousReason;
      if(archiveOpen!==undefined)nextPanel.querySelector('.repair-history-details').open=archiveOpen;
      if(followupPanel)followupPanel.replaceWith(nextPanel);
      else detail.insertBefore(nextPanel,detail.querySelector('#detail-operations'));
      if(nextReason && focusedReason){nextReason.focus({preventScroll:true});nextReason.setSelectionRange(...selection);}
    }
    for(const round of detail.querySelectorAll('[data-round-id]')){
      const entry=item.repairHistory?.items.find(row=>row.id===round.dataset.roundId);
      if(entry)round.querySelector('.repair-round-time').textContent=formatDate(entry.date)+' · '+timeLabel(entry)+' · '+statusText(entry);
    }
    detailPhotos.refresh();
    const operations=$('#detail-operations');
    if(item.status==='booked') {
      if(!operations.querySelector('[data-cancel-open]'))operations.innerHTML=`<button type="button" class="secondary-btn danger-btn" data-cancel-open aria-expanded="false" aria-controls="cancel-confirmation">取消预约</button><div class="notice cancel-confirm" id="cancel-confirmation" role="region" aria-label="取消预约二次确认" hidden><p>${escapeHtml(item.campus)} · ${formatDate(item.date)} · ${escapeHtml(timeLabel(item))}</p><p id="cancel-explanation">取消后本次预约将失效。如仍需维修，请重新预约。</p><div class="actions"><button class="secondary-btn" type="button" data-cancel-keep>保留预约</button><button class="secondary-btn danger-btn" type="button" data-cancel-confirm aria-describedby="cancel-explanation">确认取消</button></div><p class="field-error" id="cancel-message" role="alert"></p></div>`;
    } else if(followup) {
      operations.replaceChildren();
    } else if(terminalStatuses.includes(item.status)) {
      if(!operations.querySelector('[data-rebook]'))operations.innerHTML='<button class="primary-btn" type="button" data-rebook>重新预约</button><div class="notice" id="rebook-confirm" hidden><p>重新预约将舍弃当前未提交草稿，开始空白预约。是否继续？</p><div class="actions"><button class="secondary-btn" type="button" data-rebook-keep>保留草稿</button><button class="primary-btn" type="button" data-rebook-confirm>舍弃草稿并重新预约</button></div></div>';
    } else operations.innerHTML='<p class="field-hint">维修进行中，不能取消预约。</p>';
  }
  async function refresh(){if(refreshing || cancelling || !active)return;refreshing=true;readEntries();renderList();const current=++generation;
    const entries=[...records.values()].map(row=>row.entry),results=await Promise.allSettled(entries.map(request));
    if(current!==generation)return;
    results.forEach((result,index)=>{const entry=entries[index];if(result.status==='fulfilled'){const item=result.value;if(item.id!==entry.id){if(records.get(entry.id)?.entry.accessToken===entry.accessToken)records.delete(entry.id);const known=records.get(item.id)?.item;if(!known || known.revision<=item.revision)saveAppointment(item,entry.id);}commit(item);}else{const row=records.get(entry.id);if(row)row.message=result.reason.status===404 ? '私人凭证失效或无权限，请联系工作人员核验后重新签发。' : result.reason.status ? result.reason.message : '网络异常或请求超时，请重试。';}});
    refreshing=false;renderList();updateDetail();
  }
  async function showList(){viewVersion++;generation++;refreshing=false;detailId=null;detailPhotos?.dispose();detailPhotos=null;clearTimeout(deadlineTimer);releaseUrls();$('#lookup-list').hidden=false;$('#lookup-detail').hidden=true;readEntries();renderList();$('#lookup-list h1').focus({preventScroll:true});await refresh();}
  async function showDetail(id){const sameDetail=detailId===id;viewVersion++;generation++;refreshing=false;detailId=id;$('#lookup-list').hidden=true;$('#lookup-detail').hidden=false;readEntries();
    const record=records.get(id);
    if(record?.item){if(!sameDetail || !detailPhotos)mountDetail(record.item);else updateDetail();}
    else {detailPhotos?.dispose();detailPhotos=null;detail.innerHTML='<section class="detail-section" aria-busy="true"><h2>预约详情</h2><p>正在读取最新预约信息…</p></section>';}
    $('#appointment-detail-title').focus({preventScroll:true});const current=generation;
    try{if(!record)throw new Error('本机未保存此预约的有效凭证，请通过完整私人查询链接查看。');const item=await request(record.entry);if(current!==generation || detailId!==id)return;commit(item);if(!detailPhotos)mountDetail(item);else updateDetail();}
    catch(failure){if(current!==generation)return;if(record?.item){record.message=failure.status===404 ? '私人凭证失效或无权限，请联系工作人员核验后重新签发。' : failure.status ? failure.message : '网络异常或请求超时，请重试。';updateDetail();}else{detail.innerHTML=`<section class="detail-section"><h2>预约暂时无法读取</h2><p>${escapeHtml(failure.status===404 ? '链接失效或无权限，请联系工作人员核验后重新签发。' : failure.message)}</p><button class="secondary-btn" type="button" data-detail-retry>重试</button></section>`;}}
  }
  async function importLink(value){if(importing)return;const entry=parsePrivateLink(value);if(!entry)throw new Error('请使用本系统完整、同源的私人查询链接，不能仅填写编号或学号。');importing=true;const targetVersion=viewVersion;
    const button=$('#import-form [type=submit]');button.disabled=true;
    try{const item=await request(entry);commit(item);const saved=saveAppointment(item,entry.id);if(!active || targetVersion!==viewVersion){renderList();return;}$('#import-error').textContent='';onNavigate('detail',item.id);await showDetail(item.id);
      if(!saved){setNotice($('#detail-notice'),'浏览器无法保存凭证。当前会话仍可访问，请保留完整私人查询链接。');$('#detail-private-link').value=privateLink(item);$('#detail-private-link').hidden=false;}}
    catch(failure){if(failure.status===404)throw new Error('链接失效或无权限。请联系工作人员核验身份后重新签发。',{cause:failure});if(!failure.status)throw new Error('网络异常或请求超时，请重试，输入内容已保留。',{cause:failure});throw failure;}
    finally{importing=false;button.disabled=false;}
  }
  async function leaveQueue(){
    if(cancelling)return;
    const id=detailId,item=records.get(id)?.item;if(!item)return;
    cancelling=true;generation++;refreshing=false;
    const queued=queuedAppointment(item);
    const followup=item.repairHistory?.followups.find(row=>row.scheduledAppointmentId===queued.id);
    const endpoint=queued.id===item.id ? `/api/appointments/${encodeURIComponent(id)}/queue-exit` :
      `/api/appointments/${encodeURIComponent(id)}/repair-followups/${encodeURIComponent(followup?.id || '')}/queue-exit`;
    const body={revision:queued.revision,requestId:crypto.randomUUID()};
    const send=()=>apiJson(endpoint,{method:'POST',headers:credentialHeaders(item),json:body,timeoutMs:15000});
    detail.querySelector('[data-queue-exit]').disabled=true;
    try{
      try{await send();}catch(failure){if(failure.status && failure.status<500)throw failure;await send();}
      commit(await request(item));
      showToast('已退出排队，预约保留');
    }catch(failure){
      try{commit(await request(item));}catch{ /* Preserve the last confirmed state. */ }
      showToast(failure.message || '暂时无法确认退出结果，请重新查询');
      if(id===detailId && detail.querySelector('[data-queue-message]'))detail.querySelector('[data-queue-message]').textContent=failure.message || '暂时无法确认结果，请刷新后核对';
    }finally{cancelling=false;if(id===detailId){updateDetail();const button=detail.querySelector('[data-queue-exit]');if(button)button.disabled=false;}renderList();}
  }
  async function cancel(){if(cancelling)return;const id=detailId,item=records.get(id)?.item;if(!item)return;cancelling=true;generation++;refreshing=false;const button=detail.querySelector('[data-cancel-confirm]');button.disabled=true;
    try{const result=await apiJson(`/api/appointments/${encodeURIComponent(id)}/status`,{method:'PATCH',headers:credentialHeaders(item),json:{status:'cancelled',revision:item.revision},timeoutMs:15000});commit({...item,...result});}
    catch{try{const actual=await request(item);commit(actual);if(actual.status==='booked' && id===detailId)$('#cancel-message').textContent='当前仍为已预约，可安全重试取消。';}
      catch{if(id===detailId)$('#cancel-message').textContent='暂时无法确认取消结果。已保留最近状态，请重试查询后再操作。';}}
    finally{cancelling=false;if(id===detailId){updateDetail();if(records.get(id)?.item?.status==='cancelled')showToast('预约已取消');const control=detail.querySelector('[data-cancel-confirm]');if(control)control.disabled=false;}renderList();}
  }
  detail.addEventListener('submit',async event=>{
    const form=event.target.closest('[data-followup-form]');
    if(!form)return;
    event.preventDefault();
    const id=detailId,item=records.get(id)?.item,reason=form.querySelector('[name=reason]')?.value.trim() || '';
    if(!item || reason.length<2){followupMessages.set(id,'请填写至少 2 个字的返修情况。');updateDetail();return;}
    if(followupBusy.has(id))return;
    let command=followupCommands.get(id);
    if(!command || command.reason!==reason){command={reason,requestId:crypto.randomUUID()};followupCommands.set(id,command);}
    followupBusy.add(id);
    const button=form.querySelector('[type=submit]');if(button)button.disabled=true;
    followupMessages.set(id,'正在提交返修申请…');
    try{
      await apiJson('/api/appointments/'+encodeURIComponent(id)+'/repair-followups',{
        method:'POST',headers:credentialHeaders(item),json:{reason,requestId:command.requestId},timeoutMs:15000
      });
      followupCommands.delete(id);
      followupMessages.set(id,'返修申请已提交');
      await refresh();
    }catch(failure){
      followupMessages.set(id,failure.message || '网络异常，请重试。相同内容会使用原请求编号核实结果。');
      updateDetail();
    }finally{
      followupBusy.delete(id);
      const submit=detail.querySelector('[data-followup-form] [type=submit]');if(submit)submit.disabled=false;
    }
  });
  detail.addEventListener('click',async event=>{
    const target=event.target.closest('button');if(!target)return;
    if(target.hasAttribute('data-edit-device')){openDeviceEditor(detail.querySelector('[data-device-editor]'),records.get(detailId).item,item=>{commit(item);updateDetail();renderList();showToast('设备信息已更新');});return;}
    if(target.hasAttribute('data-add-device') || target.hasAttribute('data-add-device-confirm')){
      if(hasPending()){setNotice($('#detail-notice'),'另一次提交结果尚未核实，请先返回预约维修核实原请求。');return;}
      if(hasDraft() && !target.hasAttribute('data-add-device-confirm')){detail.querySelector('[data-add-device-prompt]').hidden=false;target.setAttribute('aria-expanded','true');detail.querySelector('[data-add-device-confirm]').focus();return;}
      target.disabled=true;try{await onAddDevice(records.get(detailId).item);}finally{target.disabled=false;}return;
    }
    if(target.hasAttribute('data-add-device-keep')){detail.querySelector('[data-add-device-prompt]').hidden=true;const control=detail.querySelector('[data-add-device]');control.setAttribute('aria-expanded','false');control.focus();return;}
    if(target.hasAttribute('data-queue-refresh')){void refresh();return;}
    if(target.hasAttribute('data-queue-leave')){detail.querySelector('[data-queue-confirm]').hidden=false;detail.querySelector('[data-queue-exit]').focus();return;}
    if(target.hasAttribute('data-queue-keep')){detail.querySelector('[data-queue-confirm]').hidden=true;detail.querySelector('[data-queue-leave]').focus();return;}
    if(target.hasAttribute('data-queue-exit')){void leaveQueue();return;}
    if(target.hasAttribute('data-detail-retry')){void showDetail(detailId);return;}
    if(target.hasAttribute('data-cancel-open')){detail.querySelector('.cancel-confirm').hidden=false;target.setAttribute('aria-expanded','true');detail.querySelector('[data-cancel-confirm]').focus();}
    if(target.hasAttribute('data-cancel-keep')){detail.querySelector('.cancel-confirm').hidden=true;const control=detail.querySelector('[data-cancel-open]');control.setAttribute('aria-expanded','false');control.focus();}
    if(target.hasAttribute('data-cancel-confirm'))void cancel();
    if(target.hasAttribute('data-rebook')){if(hasPending()){setNotice($('#detail-notice'),'另一次提交结果尚未核实，请先返回预约维修核实原请求。');return;}if(hasDraft())$('#rebook-confirm').hidden=false;else onRebook();}
    if(target.hasAttribute('data-rebook-keep'))$('#rebook-confirm').hidden=true;
    if(target.hasAttribute('data-rebook-confirm'))onRebook();
    if(target.hasAttribute('data-followup-qr')){const parentId=detailId,item=records.get(parentId)?.item;if(item)void renderRepairQr(target.nextElementSibling,{...item,id:target.dataset.followupAppointment,scanParentId:parentId,followupId:target.dataset.followupQr});}
    if(target.dataset.attachmentId){const id=detailId,item=records.get(id)?.item,file=item?.attachments?.find(file=>file.id===target.dataset.attachmentId);if(!file)return;target.disabled=true;
      try{const blob=await apiBlob(attachmentUrl(id,file.id),{headers:credentialHeaders(item),timeoutMs:30000});const url=URL.createObjectURL(blob);urls.add(url);if(id!==detailId){URL.revokeObjectURL(url);urls.delete(url);return;}
        if(file.mimeType.startsWith('image/'))previewPhoto(url);else{const link=document.createElement('a');link.href=url;link.download=file.filename;link.click();setTimeout(()=>{URL.revokeObjectURL(url);urls.delete(url);},60000);}}
      catch(failure){showToast(failure.message);}finally{target.disabled=false;}}
  });
  root.addEventListener('click',event=>{const target=event.target.closest('button');if(!target)return;if(target.dataset.detailId){onNavigate('detail',target.dataset.detailId);void showDetail(target.dataset.detailId);}if(target.hasAttribute('data-open-import'))openImport();if(target.hasAttribute('data-book-new'))onNavigate('booking');if(target.dataset.retryId)void refresh();});
  $('#import-appointment').addEventListener('click',()=>{const expanded=!$('#import-form').hidden;$('#import-form').hidden=expanded;$('#import-appointment').setAttribute('aria-expanded',String(!expanded));if(!expanded)$('#private-link-input').focus();});
  $('#import-form').addEventListener('submit',event=>{event.preventDefault();$('#import-error').textContent='';void importLink($('#private-link-input').value.trim()).catch(failure=>$('#import-error').textContent=failure.message || '网络异常，请重试。');});
  $('#refresh-my-appointments').addEventListener('click',()=>void refresh());$('#back-to-appointments').addEventListener('click',()=>{onNavigate('lookup');void showList();});
  startVisiblePolling(()=>active ? refresh() : undefined);
  return {refresh,showList,showDetail,importLink,setActive(value){active=value;if(!value){viewVersion++;generation++;refreshing=false;detailPhotos?.pauseUpload();clearTimeout(deadlineTimer);}},add(item){commit(item);if(active && !detailId)renderList();},openImport};
}
