import { $,showToast,escapeHtml } from '/shared/utils.js';
import { apiJson } from '/shared/api.js';
import { COLLEGES,BRANDS,STUDENT_DEVICE_TYPES,FAULT_TYPES,ANSWERS,FAULT_HINTS,AGREEMENT_VERSION,STUDENT_FIELD_LIMITS,characterCount,studentFieldErrors } from '/shared/student-booking.js';
import { animateLayout,reveal,setVisible,setMessage } from './motion.js';
import { deviceFields } from '/shared/booking-devices.js';
import { initSecondDevice } from './second-device.js';
import { initSlotPicker } from './slot-picker.js';
import { initSignature } from './signature.js';
import { createPhotoCollection } from './photos.js';
import { dialogController } from './dialogs.js';
import { timeSummary,informationGroups } from './presentation.js';
import { saveAppointment,savedAppointments,privateLink,copyPrivateLink } from './credentials.js';
import { renderRepairQr } from './repair-qr.js';
import { readDraft,writeDraft,clearDraft,requestKey,readAttempt,writeAttempt,clearAttempt } from './draft.js';

export function initBooking({onCreated=()=>{},onViewCreated=()=>{}}={}) {
  const form=$('#booking-form');
  let step=1,busy=false,created=null,payload=null,attempt=readAttempt(),savedDraft=readDraft(),restoring=false,active=true,deferredPhotos=false;
  let supplemental=null,createdDevices=[],selectedDevice=0;
  const deviceCount=()=>supplemental ? 1 : Number($('#booking-device-count').value);
  const signature=initSignature(),agreement=dialogController($('#agreement-modal'));
  const field=name=>form.elements.namedItem(name);
  const textLimits=new Map();
  for(const [name,limit] of Object.entries(STUDENT_FIELD_LIMITS)){
    const control=field(name==='brand' ? 'brandOther' : name==='college' ? 'collegeOther' : name);
    if(control){control.dataset.maxLength=limit;textLimits.set(control,limit);}
  }
  const errorKey=name=>name.startsWith('second_') ? 'second_'+errorKey(name.slice(7)) : name==='brandOther' ? 'brand' : name==='collegeOther' ? 'college' : ['qqAccount','wechatAccount'].includes(name) ? 'contactValue' : name;
  function fieldErrors(){const errors={...studentFieldErrors(data()),...(deviceCount()===2 ? second.errors(data()) : {})};
    for(const [control,limit] of textLimits)if(!control.disabled && characterCount(control.value)>limit)errors[errorKey(control.name)]=`必须在 ${limit} 字以内`;
    return errors;
  }
  const options=(element,items,placeholder)=>{element.innerHTML=`<option value="">${placeholder}</option>`+items.map(item=>`<option value="${escapeHtml(item.value || item)}">${escapeHtml(item.label || item)}</option>`).join('');};
  options(field('deviceType'),STUDENT_DEVICE_TYPES,'请选择设备类型');
  options(field('brand'),[...BRANDS,{value:'other',label:'其它'}],'请选择品牌');
  options(field('college'),[...COLLEGES,{value:'other',label:'其他学院（手动填写）'}],'请选择学院');
  for(const root of form.querySelectorAll('[data-answer]'))root.innerHTML=ANSWERS.map(answer=>`<label><input type="radio" name="${root.dataset.answer}" value="${answer}" /><span>${answer}</span></label>`).join('');
  $('#fault-options').innerHTML=FAULT_TYPES.map(value=>`<label><input type="radio" name="faultType" value="${value}" /><span>${value}</span></label>`).join('');
  const second=initSecondDevice(form,{onChange:()=>{if(step===3)review();},onUploadChange:entries=>{if(selectedDevice===1)renderUploads(entries);}});
  const photos=createPhotoCollection($('#booking-photos'),{inputId:'appointment-attachments',onChange:()=>{if(step===3)review();},onUploadChange:entries=>{if(selectedDevice===0)renderUploads(entries);}});
  const picker=initSlotPicker({getDeviceCount:deviceCount,getLockedScope:()=>supplemental,onChange:()=>{saveDraft();if(step>1 && !created){renderTime();if(picker.issue())error(picker.issue()+'其他已填信息已保留。');}}});
  function rawFields(){const values={};for(const control of form.querySelectorAll('input[name],select[name],textarea[name]')){if(control.name==='agreement' || control.type==='checkbox')continue;if(control.type==='radio'){if(control.checked)values[control.name]=control.value;}else values[control.name]=control.value;}if(values.bookingDeviceCount==='1')delete values.bookingDeviceCount;return values;}
  function data(){const values=Object.fromEntries(Object.entries(rawFields()).filter(([key])=>!key.startsWith('second_') && !['bookingDeviceCount','additionalFor'].includes(key))),effectiveBrand=values.brand==='other' ? values.brandOther.trim() : values.brand;return {...values,brand:effectiveBrand,college:values.college==='other' ? values.collegeOther.trim() : values.college,
    contactValue:values.contactType==='qq' ? values.qqAccount.trim() : values.contactType==='wechat' ? values.wechatAccount.trim() : '',
    liquidMetal:values.deviceType==='笔记本' ? values.liquidMetal : undefined,dellG15:values.deviceType==='笔记本' && effectiveBrand==='Dell' ? values.dellG15 : undefined};}
  function saveDraft(){if(restoring || created || savedDraft || busy)return;const values=rawFields();if(Object.values(values).some(Boolean) && !writeDraft(values,step))notice('此浏览器无法保存草稿，请避免刷新页面。');}
  function notice(message){setMessage($('#draft-notice'),message);}
  function condition(id,show,{clear=false}={}){const root=$(id);root.hidden=!show;for(const control of root.querySelectorAll('input')){control.disabled=!show;if(!show && clear){if(control.type==='radio')control.checked=false;else control.value='';}}}
  function syncConditions(){second.sync(deviceCount()===2);const values=rawFields(),effectiveBrand=values.brand==='other' ? values.brandOther.trim() : values.brand;
    const conditions=[['#brand-other-field',values.brand==='other',true],['#college-other-field',values.college==='other',true],['#dell-g15-field',values.deviceType==='笔记本' && effectiveBrand==='Dell',true],['#liquid-metal-field',values.deviceType==='笔记本',true],['#contact-qq-field',values.contactType==='qq'],['#contact-wechat-field',values.contactType==='wechat']];
    const hint=FAULT_HINTS[values.faultType] || '',advice=$('#fault-advice'),hintChanged=$('#fault-advice-message').textContent!==hint;
    const update=()=>{
      for(const [id,show,clear] of conditions)condition(id,show,{clear});
      field('issue').required=values.faultType==='其他';$('#issue-required').hidden=!field('issue').required;
      advice.hidden=!hint;$('#fault-advice-title').textContent=hint ? values.faultType+'须知' : '';$('#fault-advice-message').textContent=hint;
    };
    if(conditions.some(([id,show])=>$(id).hidden===show) || hintChanged)animateLayout(form,update,{resize:true});else update();
    if(hintChanged && hint)reveal(advice,{distance:4});
  }
  function renderTime(){const summary=timeSummary(picker.value());$('#step-two-time').innerHTML=summary;$('#step-three-time').innerHTML=summary;}
  function review(){renderTime();$('#booking-review').innerHTML=(deviceCount()===2 ? '<h3>第一台设备</h3>' : '')+informationGroups({...data(),photoCount:photos.entries().length},{contacts:deviceCount()!==2})+(deviceCount()===2 ? '<h3>第二台设备</h3>'+informationGroups({...second.data(),photoCount:second.photos.entries().length},{contacts:false})+informationGroups(data(),{device:false})+'<p class="notice">两台共占 2 个名额，一起提交成功后分别领取维修码。</p>' : '');}
  function go(next,{focus=true}={}){step=next;animateLayout(form,()=>{for(const panel of form.querySelectorAll('[data-step]'))panel.hidden=Number(panel.dataset.step)!==next;
    [...$('#booking-steps').children].forEach((item,index)=>{if(index+1===next)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');});
    if(next===3)review();else if(next===2)renderTime();},{stagger:true});
    saveDraft();if(focus){const heading=form.querySelector(`[data-step="${next}"] h2`);heading.focus({preventScroll:true});heading.scrollIntoView({block:'start',behavior:'auto'});}picker.setHome(next===1);}
  function error(message){setMessage($('#booking-error'),message);}
  function showErrors(errors,{focus=true}={}){const previous=new Map([...form.querySelectorAll('[data-error-for]')].map(target=>[target,target.textContent]));animateLayout(form,()=>{for(const target of form.querySelectorAll('[data-error-for]'))target.textContent='';for(const control of form.querySelectorAll('[aria-invalid]')){control.removeAttribute('aria-invalid');if(control.dataset.baseDescription)control.setAttribute('aria-describedby',control.dataset.baseDescription);else control.removeAttribute('aria-describedby');}
    for(const [key,message] of Object.entries(errors)){const name=key==='second_brand' && field('second_brand').value==='other' ? 'second_brandOther' : key==='brand' && field('brand').value==='other' ? 'brandOther' : key==='college' && field('college').value==='other' ? 'collegeOther' : key==='contactValue' ? field('contactType').value==='qq' ? 'qqAccount' : 'wechatAccount' : key;
      const target=form.querySelector(`[data-error-for="${name}"]`);if(target){target.textContent=message;target.setAttribute('role','alert');if(!target.id)target.id='error-'+name;const controls=[...form.querySelectorAll(`[name="${name}"]`),...(name==='signature' ? [$('#open-signature')] : [])];controls.forEach(control=>{control.dataset.baseDescription ??=control.getAttribute('aria-describedby') || '';control.setAttribute('aria-invalid','true');control.setAttribute('aria-describedby',[control.dataset.baseDescription,target.id].filter(Boolean).join(' '));});}}
    });for(const [target,message] of previous)if(target.textContent && target.textContent!==message)reveal(target,{distance:4});
    const first=[...form.querySelectorAll('[data-error-for]')].find(target=>target.textContent && !target.closest('[hidden]'));
    if(first && focus){first.closest('.field,.form-block')?.scrollIntoView({block:'center',behavior:'auto'});const name=first.dataset.errorFor;const control=name==='signature' ? $('#open-signature') : form.querySelector(`[name="${name}"]:not(:disabled)`);control?.focus({preventScroll:true});}
  }
  function changed(event){if(event?.isComposing)return;if(event?.target.id==='booking-device-count')void picker.refresh();syncConditions();saveDraft();
    if(step===2){const errors=fieldErrors(),visibleErrors={};
      for(const target of form.querySelectorAll('[data-step="2"] [data-error-for]')){const name=target.dataset.errorFor,key=errorKey(name),control=field(name),limit=textLimits.get(control);
        if(errors[key] && !control?.disabled && (target.textContent || (limit && characterCount(control.value)>limit)))visibleErrors[key]=errors[key];
      }
      showErrors(visibleErrors,{focus:false});
    }
    if(step===3 && field('agreement').checked){form.querySelector('[data-error-for=agreement]').textContent='';field('agreement').removeAttribute('aria-invalid');}
  }
  form.addEventListener('input',changed);form.addEventListener('change',changed);form.addEventListener('compositionend',changed);
  form.querySelectorAll('[data-edit-step]').forEach(button=>button.addEventListener('click',()=>{if(!busy){error('');go(Number(button.dataset.editStep));}}));
  $('#step-one-next').addEventListener('click',async()=>{if(busy)return;const button=$('#step-one-next');button.disabled=true;try{if(await picker.refresh() && picker.validate() && picker.confirmNotices()){error('');go(2);}}finally{button.disabled=button.dataset.paused==='true';}});
  $('#step-two-next').addEventListener('click',()=>{const errors=fieldErrors();showErrors(errors);if(Object.keys(errors).length || !photos.validity() || (deviceCount()===2 && !second.photos.validity()))return;if(!picker.validate()){go(1);error('原到场时段当前不可预约，请重新选择。其他已填信息已保留。');return;}error('');go(3);void picker.refresh();});
  $('#agreement-link').addEventListener('click',event=>{event.preventDefault();agreement.open();});$('#close-agreement').addEventListener('click',()=>agreement.close());
  $('#draft-prompt').hidden=!savedDraft;
  $('#draft-discard').addEventListener('click',()=>{savedDraft=null;clearDraft();$('#draft-prompt').hidden=true;});
  $('#draft-restore').addEventListener('click',async()=>{if(!savedDraft)return;restoring=true;const draft=savedDraft;savedDraft=null;form.reset();
    for(const control of form.querySelectorAll('[name]')){if(control.name==='agreement')continue;const value=draft.fields[control.name];if(control.type==='radio')control.checked=control.value===value;else if(value!==undefined)control.value=value;}
    supplemental=draft.fields.additionalFor ? savedAppointments().find(entry=>entry.id===draft.fields.additionalFor) : null;
    if(draft.fields.additionalFor && !supplemental){restoring=false;savedDraft=draft;error('补约原单凭证不可用，请先通过私人链接导入原预约。');return;}
    setSupplemental(supplemental);syncConditions();signature.reset();photos.reset();second.photos.reset();await picker.restore(draft.fields);restoring=false;$('#draft-prompt').hidden=true;notice('已恢复文本和选择。请重新选择照片、勾选协议并完成手写签名。');go(picker.validate() && !picker.hasUnacceptedNotices() ? Math.min(Object.keys(fieldErrors()).length ? 2 : 3,Math.max(1,draft.step || 1)) : 1);changed();saveDraft();});
  async function resolve(){if(!attempt)return null;const result=await apiJson('/api/booking-attempts/resolve',{method:'POST',json:{requestKey:attempt.key},timeoutMs:15000});return result.found ? result.appointment : null;}
  function renderUploads(entries){if(!created)return;$('#success-photos').hidden=!entries.length;
    const uploaded=entries.filter(entry=>entry.attachment).length,failures=entries.some(entry=>entry.state==='upload-error'),pending=uploaded<entries.length,uploading=entries.some(entry=>entry.state==='uploading');
    $('#success-photo-count').textContent=`${uploaded} / ${entries.length} 张`;$('#success-photo-total').max=entries.length || 1;$('#success-photo-total').value=uploaded;
    $('#success-photo-status').textContent=pending && deferredPhotos ? uploading ? '预约已创建，当前照片上传后暂停。' : '预约已创建，剩余照片可稍后补传。' : uploading ? '预约已创建，正在上传故障照片。' : pending ? '预约已创建，仍有照片未上传。' : '预约已创建。';
    $('#success-photo-progress').innerHTML=entries.map((entry,index)=>{const state=entry.attachment ? 'uploaded' : entry.state==='uploading' ? 'uploading' : entry.state==='upload-error' ? 'failed' : 'waiting',label={uploaded:'已上传',uploading:'上传中',failed:'上传失败',waiting:'等待上传'}[state];return `<div class="photo-upload-row" data-upload-state="${state}"><strong title="${escapeHtml(entry.name)}">照片 ${index+1} · ${escapeHtml(entry.name)}</strong><span class="photo-upload-state"><span class="upload-state-icon" aria-hidden="true">${{uploaded:'✓',uploading:'',failed:'!',waiting:'◷'}[state]}</span>${label}</span>${state==='failed' ? `<p class="is-error">${escapeHtml(entry.message)}</p>` : ''}</div>`;}).join('');
    $('#success-photo-message').textContent=failures ? '预约已成功，部分照片未上传。你可以重试或稍后在预约详情补充。' : pending && deferredPhotos ? '你可以稍后在预约详情重新选择并补传照片。' : pending ? '照片上传不影响已成功创建的预约。' : '照片已全部上传。';
    $('#success-photo-message').hidden=pending && !failures && !deferredPhotos;$('#success-photo-advice').hidden=!pending || failures || deferredPhotos;$('#success-photo-retry').hidden=!failures;$('#success-photo-retry').disabled=uploading;$('#success-photo-later').hidden=!pending || deferredPhotos;
  }
  const selectedPhotos=()=>selectedDevice===1 ? second.photos : photos;
  function selectCreated(index){
    selectedDevice=index;created=createdDevices[index];
    const saved=saveAppointment(created);
    for(const button of $('#success-devices').children)button.setAttribute('aria-pressed',String(Number(button.dataset.device)===index));
    $('#success-device-label').textContent=createdDevices.length>1 ? `第 ${index+1} 台 · ${created.brand} ${created.deviceModel || created.deviceType} · ${created.faultType}` : '';
    $('#success-code').textContent=created.id;$('#success-summary').innerHTML=timeSummary(created);$('#success-link-fallback').value=privateLink(created);$('#success-link-fallback').hidden=saved;
    $('#credential-save-message').hidden=saved;$('#credential-save-message').textContent='此浏览器无法保存私人凭证。请逐台复制并保留完整私人查询链接。';
    void renderRepairQr($('#success-repair-qr'),created);renderUploads(selectedPhotos().entries());
  }
  $('#success-devices').addEventListener('click',event=>{const button=event.target.closest('[data-device]');if(button)selectCreated(Number(button.dataset.device));});
  function showSuccess(appointment,{upload=true}={}){
    if(!upload){photos.reset();second.photos.reset();}
    createdDevices=appointment.appointments || [appointment];deferredPhotos=false;
    for(const item of createdDevices){saveAppointment(item);onCreated(item);}
    clearDraft();clearAttempt();savedDraft=null;attempt=null;payload=null;
    form.hidden=true;$('#booking-heading').hidden=true;$('#booking-steps').hidden=true;$('#draft-prompt').hidden=true;notice('');error('');setVisible($('#success-panel'),true);
    $('#success-title').textContent=createdDevices.length>1 ? '两台设备预约成功' : '预约成功';
    $('#success-devices').hidden=createdDevices.length<2;
    $('#success-devices').innerHTML=createdDevices.map((item,index)=>`<button type="button" class="secondary-btn" data-device="${index}">第 ${index+1} 台 · ${escapeHtml(item.brand)}</button>`).join('');
    selectCreated(0);picker.setActive(false);$('#success-title').focus({preventScroll:true});window.scrollTo({top:0,behavior:'auto'});
    if(upload){void photos.uploadAll(createdDevices[0]);if(createdDevices[1])void second.photos.uploadAll(createdDevices[1]);}else notice('已恢复原预约结果。请分别进入设备详情核对信息，需要时重新选择并补充照片。');
  }
  function setSupplemental(item){
    supplemental=item;field('additionalFor').value=item?.id || '';field('studentId').readOnly=!!item;
    $('#booking-device-count').disabled=!!item;if(item)$('#booking-device-count').value='1';
    $('#additional-device-context').hidden=!item;$('#additional-device-context').textContent=item ? '为原预约 '+item.id+' 补约一台。学号和到场时段沿用原单；请填写新设备的信息。' : '';
    for(const button of form.querySelectorAll('[data-edit-step="1"]'))button.hidden=!!item;
  }
  async function submit(){if(busy)return;busy=true;$('#booking-submit').disabled=true;$('#booking-submit').textContent='正在核实并提交…';form.querySelectorAll('[data-edit-step]').forEach(button=>button.disabled=true);error('');
    try {
      if(attempt?.pending){const found=await resolve();if(found){showSuccess(found,{upload:false});return;}}
      const values=data(),errors=fieldErrors();
      if(!field('agreement').checked)errors.agreement='请阅读并同意维修协议';if(!signature.value())errors.signature='请点击“手写本人姓名”完成签名';
      if(Object.keys(errors).some(key=>!['agreement','signature'].includes(key))){go(2);showErrors(errors);return;}
      showErrors(errors);if(Object.keys(errors).length || !photos.validity() || (deviceCount()===2 && !second.photos.validity()))return;
      if(!await picker.refresh()){error('暂时无法核实时段和地点，请重试。已填信息已保留。');return;}if(!picker.validate()){go(1);error('到场时段当前不可预约，请重新选择。其他信息已保留。');return;}
      if(picker.hasUnacceptedNotices()){go(1);error('所选校区有尚未确认的必读公告，请阅读确认后继续。已填信息和签名已保留。');picker.confirmNotices();return;}
      {const previousAt=payload?.agreementAt;const {brandOther,collegeOther,qqAccount,wechatAccount,...business}=values;
        // Draft-only alternative inputs never reach the server.
        void brandOther;void collegeOther;void qqAccount;void wechatAccount;
        payload={...business,...picker.value(),acceptedNotices:picker.acceptedNotices(),agreementAccepted:true,agreementAt:previousAt || new Date().toISOString(),agreementVersion:AGREEMENT_VERSION,signature:signature.value()};delete payload.location;if(deviceCount()===2)payload.devices=[deviceFields(values),second.data()];if(supplemental)payload.additionalFor=supplemental.id;}
      attempt=attempt || {key:requestKey()};attempt.pending=true;
      if(!writeAttempt(attempt))notice('此浏览器无法保存提交标识。如网络中断，请保持页面打开并重试。');
      saveDraft();
      try {showSuccess(await apiJson('/api/appointments',{method:'POST',headers:{'Idempotency-Key':attempt.key,...(supplemental ? {'X-Appointment-Token':supplemental.accessToken} : {})},json:payload,timeoutMs:15000}));}
      catch(failure){
        if(failure.code==='CREDENTIAL_ROTATED'){attempt.pending=false;writeAttempt(attempt);error(failure.message);return;}
        let found;
        try{found=await resolve();}catch{error('暂时无法确认预约是否创建。请保持页面和原提交标识，点击提交重试核实；不要另开新预约。');return;}
        if(found){showSuccess(found,{upload:failure.code!=='IDEMPOTENCY_MISMATCH'});if(failure.code==='IDEMPOTENCY_MISMATCH')notice('原请求已经创建成功，当前展示的是原预约。后续修改没有另行提交。');return;}
        if(['BOOKING_NOTICE_CHANGED','SERVICE_DAY_PAUSED','SLOT_FULL','SLOT_PAUSED','SLOT_ENDED','SLOT_CHANGED','DATE_UNAVAILABLE','LOCATION_MISSING'].includes(failure.code)){attempt=null;payload=null;clearAttempt();if(failure.code==='BOOKING_NOTICE_CHANGED'){await picker.refresh();go(1);picker.confirmNotices();}else{go(1);await picker.recover(failure.message);}error(failure.message+'。其他信息和有效签名已保留。');}
        else if(failure.code==='FIELD_INVALID'){attempt=null;payload=null;clearAttempt();go(Object.keys(failure.fields || {}).some(key=>!['agreement','signature'].includes(key)) ? 2 : 3);showErrors(failure.fields || {});error(failure.message);}
        else if(failure.status && failure.status<500){attempt=null;payload=null;clearAttempt();error(failure.message);}
        else error('尚未确认创建结果。可使用原提交标识安全重试核实，已填内容已保留。');
      }
    }catch(failure){error(failure.message || '暂时无法核实预约结果，请保持页面并重试。');}
    finally{busy=false;$('#booking-submit').disabled=false;$('#booking-submit').textContent='确认并提交预约';form.querySelectorAll('[data-edit-step]').forEach(button=>button.disabled=false);}
  }
  form.addEventListener('submit',event=>{event.preventDefault();void submit();});
  $('#copy-code').addEventListener('click',()=>void copyPrivateLink(created,$('#success-link-fallback'),showToast));
  $('#view-created-appointment').addEventListener('click',()=>{photos.pauseUpload();second.photos.pauseUpload();onViewCreated(created);});
  $('#success-photo-retry').addEventListener('click',()=>{deferredPhotos=false;void selectedPhotos().uploadAll(created);});$('#success-photo-later').addEventListener('click',()=>{deferredPhotos=true;photos.pauseUpload();second.photos.pauseUpload();renderUploads(selectedPhotos().entries());});
  syncConditions();
  if(attempt?.pending){error('上次提交结果待核实，正在安全查询…');void resolve().then(found=>{if(found)showSuccess(found,{upload:false});else error('暂未查到创建结果，请恢复草稿并重新勾选协议、签名后，用原提交标识重试。');}).catch(failure=>{if(failure.code==='CREDENTIAL_ROTATED'){attempt.pending=false;writeAttempt(attempt);error(failure.message);notice('请通过工作人员补发的私人查询链接导入已有预约。');}else error('暂时无法确认上次提交结果，请保持原提交标识并重试核实。');});}
  return {
    hasDraft:()=>Boolean(!created && (savedDraft || readDraft() || Object.values(rawFields()).some(Boolean))),
    hasPending:()=>Boolean(attempt?.pending),
    reset(){if(busy || attempt?.pending)return false;photos.reset();second.photos.reset();signature.reset();setSupplemental(null);picker.reset();form.reset();createdDevices=[];selectedDevice=0;syncConditions();clearDraft();clearAttempt();savedDraft=null;attempt=null;payload=null;created=null;form.hidden=false;$('#booking-heading').hidden=false;$('#booking-steps').hidden=false;$('#success-panel').hidden=true;$('#draft-prompt').hidden=true;notice('');error('');picker.setActive(active);go(1);return true;},
    setActive(value){active=value;picker.setActive(value && !created);if(!value && created){photos.pauseUpload();second.photos.pauseUpload();}},
    async addDevice(item){
      if(busy || attempt?.pending)return false;
      this.reset();setSupplemental(item);
      for(const key of ['name','studentId','email'])field(key).value=item[key] || '';
      const knownCollege=[...field('college').options].some(option=>option.value===item.college);
      field('college').value=knownCollege ? item.college : 'other';field('collegeOther').value=knownCollege ? '' : item.college || '';
      const contact= form.querySelector(`[name="contactType"][value="${item.contactType==='qq' ? 'qq' : 'wechat'}"]`);contact.checked=true;
      field(item.contactType==='qq' ? 'qqAccount' : 'wechatAccount').value=item.contactValue || '';
      syncConditions();await picker.restore(item);saveDraft();go(1);return true;
    },
    created:()=>created
  };
}
