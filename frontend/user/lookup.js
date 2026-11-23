import { $,showToast,escapeHtml } from '/shared/utils.js';
import { apiJson,apiBlob } from '/shared/api.js';
import { startVisiblePolling } from '/shared/polling.js';
import { attachmentUrl,attachmentSize } from '/shared/attachments.js';
import { formatDate } from '/shared/time.js';
import { terminalStatuses } from '/shared/constants.js';
import { savedAppointments,saveAppointment,credentialHeaders,credentialStorageError } from './credentials.js';
import { observeDataMotion } from '/shared/data-motion.js';
import { renderRepairQr } from './repair-qr.js';
import { appointmentTicketImage } from './appointment-ticket.js';
import { isAwaitingArrival,lookupSchedule,timeLabel,informationGroups,statusText,studentStatusClass,statusExplanation,repairRecord } from './presentation.js';
import { createPhotoCollection,previewPhoto } from './photos.js';
import { createRepairHistoryPanel } from './repair-history.js';

const listFreshness = 60_000;
const detailFreshness = 30_000;

export function initLookup({onNavigate=()=>{},onRebook=()=>{},hasDraft=()=>false,hasPending=()=>false}={}) {
  const root=$('#lookup-results'),detail=$('#appointment-detail');
  observeDataMotion(root);observeDataMotion(detail);
  const records=new Map();let active=false,detailId=null,generation=0,refreshing=false,cancelling=false,detailPhotos=null,deadlineTimer;
  const urls=new Set(),qrImages=new Map();
  const inFlight=new Map();
  function request(entry,options={}) {
    const key=`${entry.id}/${entry.accessToken}`;
    if(!inFlight.has(key)) {
      const task=apiJson(`/api/appointments/${encodeURIComponent(entry.id)}`,{...options,headers:credentialHeaders(entry),timeoutMs:15000})
        .then(item=>({...item,accessToken:entry.accessToken})).finally(()=>inFlight.delete(key));
      inFlight.set(key,task);
    }
    return inFlight.get(key);
  }
  function readEntries() {
    for(const entry of savedAppointments()) {
      const previous=records.get(entry.id);
      if(previous?.entry.accessToken!==entry.accessToken)records.set(entry.id,{entry});
    }
  }
  function commit(item) {
    const previous=records.get(item.id);
    if(previous?.item && previous.entry.accessToken===item.accessToken) {
      const revision=previous.item.revision-item.revision;
      const locationRevision=(previous.item.currentLocationRevision ?? -1)-(item.currentLocationRevision ?? -1);
      if(revision>0 || (revision===0 && locationRevision>0))return;
    }
    const now=Date.now();
    records.set(item.id,{entry:{id:item.id,accessToken:item.accessToken},item,message:'',receivedAt:now,checkedAt:now});
  }
  function updateFailure(row,failure) {
    row.checkedAt=Date.now();
    row.message=failure.status===404 ? '此浏览器无法访问该预约，请联系工作人员查询。' : failure.status ? failure.message : '网络异常或请求超时，请重试。';
  }
  function needsUpdate(row,maxAge) {
    return !row.checkedAt || Date.now()-row.checkedAt>=maxAge;
  }
  function setNotice(target,message){target.hidden=!message;target.textContent=message;}
  function card(item){
    const awaitingArrival=isAwaitingArrival(item);
    const location=item.location || item.locationSnapshot || '维修地点待确认';
    return `<button data-track=student.lookup.button.1 type="button" class="student-record" data-motion-item="record" data-detail-id="${escapeHtml(item.id)}">
      <span class="record-top"><strong>${escapeHtml(item.deviceType)} · ${escapeHtml(item.brand)}</strong><span class="status-pill ${studentStatusClass(item)}">${statusText(item)}</span></span>
      <span class="record-schedule">${awaitingArrival ? (item.servicePaused ? '原预约时间 · ' : '到场时间 · ') : ''}${formatDate(item.date)} · ${escapeHtml(timeLabel(item))}</span>
      <span class="record-location">${escapeHtml(item.campus)}校区${terminalStatuses.includes(item.status) ? '' : ` · ${escapeHtml(location)}`}</span>
      ${awaitingArrival && item.servicePaused ? '<span class="record-schedule is-error">当天暂停维修</span>' : ''}
    </button>`;
  }
  function renderList(){
    const entries=[...records.values()],items=entries.filter(row=>row.item).map(row=>row.item),failed=entries.filter(row=>row.message),unknown=entries.filter(row=>!row.item && !row.message);
    const storageError=credentialStorageError();
    const empty=!entries.length && !storageError;
    $('#refresh-my-appointments').hidden=empty;
    const current=items.filter(item=>!terminalStatuses.includes(item.status)).sort((a,b)=>(a.date+a.timeSlot).localeCompare(b.date+b.timeSlot));
    const history=items.filter(item=>terminalStatuses.includes(item.status)).sort((a,b)=>(b.date+b.timeSlot).localeCompare(a.date+a.timeSlot));
    let html;
    if(empty)html='<div class="empty-state"><h2>此浏览器暂无预约记录</h2><button data-track=student.lookup.button.2 type="button" class="primary-btn" data-book-new>去预约</button></div>';
    else {
      html=`<section class="record-group"><h2>当前预约${current.length ? ` · ${current.length}` : ''}</h2>${current.map(card).join('') || '<p class="field-hint">暂无当前预约。</p>'}</section><section class="record-group"><h2>历史预约${history.length ? ` · ${history.length}` : ''}</h2>${history.map(card).join('') || '<p class="field-hint">暂无历史预约。</p>'}</section>`;
      html+=unknown.map(row=>`<article class="notice" aria-busy="true">${escapeHtml(row.entry.id)} · 正在读取预约…</article>`).join('');
      html+=failed.map(row=>`<article class="notice is-error"><strong>${escapeHtml(row.entry.id)} · 暂时无法${row.item ? '更新' : '读取'}</strong><p>${escapeHtml(row.message)}</p><button data-track=student.lookup.button.4 class="secondary-btn" type="button" data-retry-id="${escapeHtml(row.entry.id)}">重试此预约</button></article>`).join('');
    }
    if(root.dataset.renderMarkup!==html){
      // Retain each record button when another appointment changes. Restoring a
      // focused button is necessary on browsers without state-preserving moves.
      const focused=root.contains(document.activeElement) ? document.activeElement : null;
      const existing=new Map([...root.querySelectorAll('[data-detail-id]')].map(node=>[node.dataset.detailId,node]));
      const template=document.createElement('template');template.innerHTML=html;
      for(const target of template.content.querySelectorAll('[data-detail-id]')){
        const retained=existing.get(target.dataset.detailId);
        if(!retained)continue;
        if(retained.innerHTML!==target.innerHTML)retained.innerHTML=target.innerHTML;
        target.replaceWith(retained);
      }
      root.replaceChildren(template.content);root.dataset.renderMarkup=html;
      if(focused?.isConnected)focused.focus({preventScroll:true});
    }
    setNotice($('#lookup-notice'),storageError ? '此浏览器保存的预约记录暂时无法读取，请重试。' : failed.length ? '部分预约暂时无法更新，已保留最近确认的信息。' : '');
  }
  function existingPhotos(){return records.get(detailId)?.item?.attachments?.filter(file=>['general','student_photo'].includes(file.purpose) && file.mimeType.startsWith('image/')) || [];}
  function releaseUrls(){urls.forEach(url=>URL.revokeObjectURL(url));urls.clear();}
  function mountDetail(item){detailPhotos?.dispose();releaseUrls();clearTimeout(deadlineTimer);
    detail.innerHTML=`<div class="detail-ticket">
        <div class="detail-overview">
          <div id="detail-summary" aria-live="polite" aria-atomic="true"></div>
          <p class="detail-arrival-note" id="detail-arrival-note" hidden></p>
          <p class="detail-credential-number">预约编号 <strong>${escapeHtml(item.id)}</strong></p>
          ${item.repairNumber ? `<p class="detail-credential-number">历史维修编号 <strong>${escapeHtml(item.repairNumber)}</strong></p>` : ''}
        </div>
        <div class="detail-ticket-credential">
          <figure class="detail-ticket-code">
            <div class="repair-qr detail-qr-content" id="detail-current-qr"></div>
            <figcaption>
              <p class="detail-qr-caption" id="detail-qr-caption"></p>
              <p class="detail-qr-caption" id="detail-save-hint" hidden>建议<button data-track=student.lookup.button.save-qr class="text-btn" id="detail-save-qr" type="button" disabled>保存</button></p>
            </figcaption>
          </figure>
        </div>
      </div>
      <div id="detail-repair-record"></div>
      <div id="detail-information"></div>
      <div id="detail-contacts"></div>
      <section class="appointment-detail-section" id="detail-photo-upload">
        <h2>故障照片与附件</h2>
        <div id="detail-attachments"></div>
        <div class="detail-upload-actions"><div id="detail-photos"></div><button data-track=student.lookup.button.9 class="primary-btn" id="detail-upload" type="button" hidden>上传所选照片</button></div>
        <p id="detail-upload-message" role="status"></p>
      </section>
      <div id="detail-operations"></div>`;
    const upload=$('#detail-upload');
    function syncUploadButton(entries) {
      const busy=entries.some(entry=>entry.state==='uploading');
      upload.hidden=!entries.length;
      upload.disabled=busy;
      upload.textContent=busy ? '正在上传…' : '上传所选照片';
    }
    detailPhotos=createPhotoCollection($('#detail-photos'),{existingCount:()=>existingPhotos().length,onChange:()=>syncUploadButton(detailPhotos.entries()),onUploadChange:entries=>{
      syncUploadButton(entries);
      $('#detail-upload-message').textContent=entries.some(entry=>entry.state==='upload-error') ? '部分照片未上传，可再次点击上传重试。已成功的照片不会重复上传。' : '';
    }});
    const saveQr=$('#detail-save-qr');
    saveQr.addEventListener('click',()=>{
      const appointment=records.get(detailId)?.item;
      if(!appointment)return;
      const link=document.createElement('a');
      link.setAttribute('data-track','student.lookup.dynamic.download');
      try {
        link.href=appointmentTicketImage(appointment,$('#detail-current-qr img'));
      } catch {
        showToast('预约单暂时无法保存，请稍后重试。');
        return;
      }
      link.download=`预约单-${appointment.id}.png`;
      link.click();
    });
    upload.addEventListener('click',async()=>{
      const id=detailId,item=records.get(id)?.item;if(!item || !detailPhotos.entries().length){$('#detail-upload-message').textContent='请先选择照片。';return;}
      if(!detailPhotos.validity())return;
      const collection=detailPhotos;await collection.uploadAll(item);if(id!==detailId || collection!==detailPhotos)return;
      generation++;refreshing=false;await refresh({force:true});if(id!==detailId || collection!==detailPhotos)return;
      if(collection.entries().every(entry=>entry.attachment)){collection.reset();syncUploadButton([]);$('#detail-upload-message').textContent='照片已上传。';}
    });
    void renderRepairQr($('#detail-current-qr'),item,{cache:qrImages,onReady:()=>{saveQr.disabled=false;}});
    updateDetail();
  }
  function setMarkup(element,html){if(element.dataset.renderMarkup===html)return;const expanded=new Set([...element.querySelectorAll('details[open]')].map(details=>details.querySelector('summary')?.textContent));element.innerHTML=html;for(const details of element.querySelectorAll('details'))if(expanded.has(details.querySelector('summary')?.textContent))details.open=true;element.dataset.renderMarkup=html;}
  function updateDetail(){const record=records.get(detailId),item=record?.item;if(!item)return;
    clearTimeout(deadlineTimer);
    const serverOffset=item.serverNow && record.receivedAt ? Date.parse(item.serverNow)-record.receivedAt : 0;
    const deadline=Date.parse(item.expiresAt)-(Date.now()+serverOffset);
    if(item.status==='booked' && !item.receivedAt && deadline>0 && deadline<2147480000)deadlineTimer=setTimeout(()=>{if(active && !document.hidden)void refresh({force:true});},deadline+1000);
    setNotice($('#detail-notice'),record.message ? '暂时无法更新。'+record.message : '');
    setMarkup($('#detail-summary'),lookupSchedule(item));
    setNotice($('#detail-arrival-note'),statusExplanation(item));
    setMarkup($('#detail-repair-record'),repairRecord(item));
    setMarkup($('#detail-information'),informationGroups(item,{photos:false,contacts:false,detail:true}));setMarkup($('#detail-contacts'),informationGroups(item,{device:false,detail:true}));
    const files=item.attachments || [];
    setMarkup($('#detail-attachments'),files.map(file=>`<button data-track=student.lookup.button.10 class="text-btn" type="button" data-attachment-id="${escapeHtml(file.id)}">${escapeHtml(file.filename)} · ${attachmentSize(file.size)}${file.purpose==='intake_front' ? ' · 接待正面照片' : file.purpose==='intake_back' ? ' · 接待背面照片' : ''}</button>`).join(''));
    const historic=terminalStatuses.includes(item.status);
    const canCheckIn=isAwaitingArrival(item) && !item.servicePaused;
    $('#detail-qr-caption').textContent=canCheckIn ? '到场需核销二维码' : historic ? '历史二维码，仅供查询' : '预约二维码';
    $('#detail-save-hint').hidden=!canCheckIn;
    const historyPanel=detail.querySelector('[data-repair-history]');
    const historySignature=JSON.stringify(item.repairHistory);
    if((item.repairHistory?.items?.length || 0)<2)historyPanel?.remove();
    else if(historyPanel?.dataset.signature!==historySignature){
      const next=createRepairHistoryPanel(item);next.dataset.repairHistory='true';next.dataset.signature=historySignature;
      if(historyPanel)historyPanel.replaceWith(next);else detail.insertBefore(next,detail.querySelector('#detail-operations'));
    }
    detailPhotos.refresh();
    const operations=$('#detail-operations');
    if(item.status==='booked' && !item.receivedAt) {
      if(!operations.querySelector('[data-cancel-open]'))operations.innerHTML=`<button data-track=student.lookup.button.11 type="button" class="secondary-btn danger-btn" data-cancel-open aria-expanded="false" aria-controls="cancel-confirmation">取消预约</button><div class="notice cancel-confirm" id="cancel-confirmation" role="region" aria-label="取消预约二次确认" hidden><p>${escapeHtml(item.campus)} · ${formatDate(item.date)} · ${escapeHtml(timeLabel(item))}</p><p id="cancel-explanation">取消后本次预约将失效。如仍需维修，请重新预约。</p><div class="actions"><button data-track=student.lookup.button.12 class="secondary-btn" type="button" data-cancel-keep>保留预约</button><button data-track=student.lookup.button.13 class="secondary-btn danger-btn" type="button" data-cancel-confirm aria-describedby="cancel-explanation">确认取消</button></div><p class="field-error" id="cancel-message" role="alert"></p></div>`;
    } else if(historic) {
      if(!operations.querySelector('[data-rebook]'))operations.innerHTML='<button data-track=student.lookup.button.14 class="primary-btn" type="button" data-rebook>重新预约</button><div class="notice" id="rebook-confirm" hidden><p>重新预约将舍弃当前未提交草稿，开始空白预约。是否继续？</p><div class="actions"><button data-track=student.lookup.button.15 class="secondary-btn" type="button" data-rebook-keep>保留草稿</button><button data-track=student.lookup.button.16 class="primary-btn" type="button" data-rebook-confirm>舍弃草稿并重新预约</button></div></div>';
    } else operations.replaceChildren();
  }
  async function refresh({force=false,onlyId, ...options}={}) {
    if(refreshing || cancelling || !active)return;
    readEntries();
    const targetId=onlyId || detailId;
    const maxAge=detailId ? detailFreshness : listFreshness;
    const entries=[...records.values()].filter(row=>(!targetId || row.entry.id===targetId) && (force || needsUpdate(row,maxAge))).map(row=>row.entry);
    if(!entries.length)return;
    refreshing=true;
    if(!detailId)renderList();
    const current=++generation;
    const results=await Promise.allSettled(entries.map(entry=>request(entry,options)));
    if(current!==generation)return;
    results.forEach((result,index)=>{
      const entry=entries[index];
      const row=records.get(entry.id);
      if(row?.entry.accessToken!==entry.accessToken)return;
      if(result.status==='rejected'){updateFailure(row,result.reason);return;}
      const item=result.value;
      if(item.id!==entry.id){
        records.delete(entry.id);
        const known=records.get(item.id)?.item;
        if(!known || known.revision<=item.revision)saveAppointment(item,entry.id);
        if(detailId===entry.id){detailId=item.id;onNavigate('detail',item.id);detailPhotos?.dispose();detailPhotos=null;}
      }
      commit(item);
    });
    refreshing=false;
    if(!detailId)renderList();
    else if(detailPhotos)updateDetail();
    else if(records.get(detailId)?.item)mountDetail(records.get(detailId).item);
  }
  async function showList(){generation++;refreshing=false;detailId=null;detailPhotos?.dispose();detailPhotos=null;clearTimeout(deadlineTimer);releaseUrls();$('#lookup-list').hidden=false;$('#lookup-detail').hidden=true;readEntries();renderList();$('#lookup-list h1').focus({preventScroll:true});await refresh();}
  async function showDetail(id,{force=false}={}){const sameDetail=detailId===id;generation++;refreshing=false;detailId=id;$('#lookup-list').hidden=true;$('#lookup-detail').hidden=false;readEntries();
    const record=records.get(id);
    if(record?.item){if(!sameDetail || !detailPhotos)mountDetail(record.item);else updateDetail();}
    else {detailPhotos?.dispose();detailPhotos=null;detail.innerHTML='<section class="detail-section" aria-busy="true"><h2>预约详情</h2><p>正在读取最新预约信息…</p></section>';}
    $('#appointment-detail-title').focus({preventScroll:true});const current=generation;
    if(!force && record?.item && !needsUpdate(record,detailFreshness))return;
    refreshing=true;
    try{
      if(!record)throw new Error('此浏览器没有保存该预约记录。');
      const item=await request(record.entry);
      if(current!==generation || detailId!==id)return;
      if(item.id!==id){saveAppointment(item,id);records.delete(id);detailId=item.id;onNavigate('detail',item.id);}
      commit(item);if(!detailPhotos || item.id!==id)mountDetail(item);else updateDetail();
    }catch(failure){if(current!==generation)return;if(record)updateFailure(record,failure);if(record?.item){updateDetail();}else{detail.innerHTML=`<section class="detail-section"><h2>预约暂时无法读取</h2><p>${escapeHtml(failure.status===404 ? '此浏览器无法访问该预约，请联系工作人员查询。' : failure.message)}</p><button data-track=student.lookup.button.17 class="secondary-btn" type="button" data-detail-retry>重试</button></section>`;}}
    finally{if(current===generation)refreshing=false;}
  }
  async function cancel(){if(cancelling)return;const id=detailId,item=records.get(id)?.item;if(!item)return;cancelling=true;generation++;refreshing=false;const button=detail.querySelector('[data-cancel-confirm]');button.disabled=true;
    try{const result=await apiJson(`/api/appointments/${encodeURIComponent(id)}/status`,{method:'PATCH',headers:credentialHeaders(item),json:{status:'cancelled',revision:item.revision},timeoutMs:15000});commit({...item,...result});}
    catch{try{const actual=await request(item);commit(actual);if(actual.status==='booked' && id===detailId)$('#cancel-message').textContent='当前仍为已预约，可安全重试取消。';}
      catch{if(id===detailId)$('#cancel-message').textContent='暂时无法确认取消结果。已保留最近状态，请重试查询后再操作。';}}
    finally{cancelling=false;if(id===detailId){updateDetail();if(records.get(id)?.item?.status==='cancelled')showToast('预约已取消');const control=detail.querySelector('[data-cancel-confirm]');if(control)control.disabled=false;}renderList();}
  }
  detail.addEventListener('click',async event=>{
    const target=event.target.closest('button');if(!target)return;
    if(target.hasAttribute('data-detail-retry')){void showDetail(detailId,{force:true});return;}
    if(target.hasAttribute('data-cancel-open')){detail.querySelector('.cancel-confirm').hidden=false;target.setAttribute('aria-expanded','true');detail.querySelector('[data-cancel-confirm]').focus();}
    if(target.hasAttribute('data-cancel-keep')){detail.querySelector('.cancel-confirm').hidden=true;const control=detail.querySelector('[data-cancel-open]');control.setAttribute('aria-expanded','false');control.focus();}
    if(target.hasAttribute('data-cancel-confirm'))void cancel();
    if(target.hasAttribute('data-rebook')){if(hasPending()){setNotice($('#detail-notice'),'另一次提交结果尚未核实，请先返回预约维修核实原请求。');return;}if(hasDraft())$('#rebook-confirm').hidden=false;else onRebook();}
    if(target.hasAttribute('data-rebook-keep'))$('#rebook-confirm').hidden=true;
    if(target.hasAttribute('data-rebook-confirm'))onRebook();
    if(target.dataset.relatedScan){const item=records.get(detailId)?.item;if(item)void renderRepairQr(target.nextElementSibling,{...item,id:target.dataset.relatedScan,scanParentId:item.id});}
    if(target.dataset.attachmentId){const id=detailId,item=records.get(id)?.item,file=item?.attachments?.find(file=>file.id===target.dataset.attachmentId);if(!file)return;target.disabled=true;
      try{const blob=await apiBlob(attachmentUrl(id,file.id),{headers:credentialHeaders(item),timeoutMs:30000});const url=URL.createObjectURL(blob);urls.add(url);if(id!==detailId){URL.revokeObjectURL(url);urls.delete(url);return;}
        if(file.mimeType.startsWith('image/'))previewPhoto(url);else{const link=document.createElement('a');link.setAttribute('data-track','student.lookup.dynamic.download');link.href=url;link.download=file.filename;link.click();setTimeout(()=>{URL.revokeObjectURL(url);urls.delete(url);},60000);}}
      catch(failure){showToast(failure.message);}finally{target.disabled=false;}}
  });
  root.addEventListener('click',event=>{const target=event.target.closest('button');if(!target)return;if(target.dataset.detailId){onNavigate('detail',target.dataset.detailId);void showDetail(target.dataset.detailId);}if(target.hasAttribute('data-book-new'))onNavigate('booking');if(target.dataset.retryId)void refresh({force:true,onlyId:target.dataset.retryId});});
  $('#refresh-my-appointments').addEventListener('click',()=>void refresh({force:true}));$('#back-to-appointments').addEventListener('click',()=>{onNavigate('lookup');void showList();});
  startVisiblePolling(options=>active ? refresh(options) : undefined);
  return {refresh,showList,showDetail,setActive(value){active=value;if(!value){generation++;refreshing=false;detailPhotos?.pauseUpload();clearTimeout(deadlineTimer);}},add(item){commit(item);if(active && !detailId)renderList();}};
}
