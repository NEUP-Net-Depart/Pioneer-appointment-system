import { $,showToast,escapeHtml } from '/shared/utils.js';
import { apiJson } from '/shared/api.js';
import { COLLEGES,BRANDS,STUDENT_DEVICE_TYPES,FAULT_TYPES,ANSWERS,FAULT_HINTS,AGREEMENT_VERSION,characterCount,studentFieldErrors } from '/shared/student-booking.js';
import { initSlotPicker } from './slot-picker.js';
import { initSignature } from './signature.js';
import { createPhotoCollection } from './photos.js';
import { dialogController } from './dialogs.js';
import { timeSummary,informationGroups } from './presentation.js';
import { saveAppointment,privateLink,copyPrivateLink } from './credentials.js';
import { renderRepairQr } from './repair-qr.js';
import { readDraft,writeDraft,clearDraft,requestKey,readAttempt,writeAttempt,clearAttempt } from './draft.js';

export function initBooking({onCreated=()=>{},onViewCreated=()=>{}}={}) {
  const form=$('#booking-form');
  let step=1,busy=false,created=null,payload=null,attempt=readAttempt(),savedDraft=readDraft(),restoring=false,active=true;
  const signature=initSignature(),agreement=dialogController($('#agreement-modal'));
  const field=name=>form.elements.namedItem(name);
  const options=(element,items,placeholder)=>{element.innerHTML=`<option value="">${placeholder}</option>`+items.map(item=>`<option value="${escapeHtml(item.value || item)}">${escapeHtml(item.label || item)}</option>`).join('');};
  options(field('deviceType'),STUDENT_DEVICE_TYPES,'请选择设备类型');
  options(field('brand'),[...BRANDS,{value:'other',label:'其他品牌（手动填写）'}],'请选择品牌');
  options(field('college'),[...COLLEGES,{value:'other',label:'其他学院（手动填写）'}],'请选择学院');
  for(const root of form.querySelectorAll('[data-answer]'))root.innerHTML=ANSWERS.map(answer=>`<label><input type="radio" name="${root.dataset.answer}" value="${answer}" /><span>${answer}</span></label>`).join('');
  $('#fault-options').innerHTML=FAULT_TYPES.map(value=>`<label><input type="radio" name="faultType" value="${value}" /><span>${value}</span></label>`).join('');
  const photos=createPhotoCollection($('#booking-photos'),{inputId:'appointment-attachments',onChange:()=>{if(step===3)review();},onUploadChange:renderUploads});
  const picker=initSlotPicker({onChange:()=>{saveDraft();if(step>1 && !created){renderTime();if(picker.issue())error(picker.issue()+'其他已填信息已保留。');}}});
  function rawFields(){const values={};for(const control of form.querySelectorAll('input[name],select[name],textarea[name]')){if(control.name==='agreement' || control.type==='checkbox')continue;if(control.type==='radio'){if(control.checked)values[control.name]=control.value;}else values[control.name]=control.value;}return values;}
  function data(){const values=rawFields(),effectiveBrand=values.brand==='other' ? values.brandOther.trim() : values.brand;return {...values,brand:effectiveBrand,college:values.college==='other' ? values.collegeOther.trim() : values.college,
    contactValue:values.contactType==='qq' ? values.qqAccount.trim() : values.contactType==='wechat' ? values.wechatAccount.trim() : '',
    liquidMetal:['笔记本','台式机'].includes(values.deviceType) ? values.liquidMetal : undefined,dellG15:values.deviceType==='笔记本' && effectiveBrand==='Dell' ? values.dellG15 : undefined};}
  function saveDraft(){if(restoring || created || savedDraft || busy)return;const values=rawFields();if(Object.values(values).some(Boolean) && !writeDraft(values,step))notice('此浏览器无法保存草稿，请避免刷新页面。');}
  function notice(message){$('#draft-notice').hidden=!message;$('#draft-notice').textContent=message;}
  function condition(id,show,{clear=false}={}){const root=$(id);root.hidden=!show;for(const control of root.querySelectorAll('input')){control.disabled=!show;if(!show && clear){if(control.type==='radio')control.checked=false;else control.value='';}}}
  function syncConditions(){const values=rawFields(),effectiveBrand=values.brand==='other' ? values.brandOther.trim() : values.brand;condition('#brand-other-field',values.brand==='other',{clear:true});condition('#college-other-field',values.college==='other',{clear:true});condition('#dell-g15-field',values.deviceType==='笔记本' && effectiveBrand==='Dell',{clear:true});condition('#liquid-metal-field',['笔记本','台式机'].includes(values.deviceType),{clear:true});condition('#contact-qq-field',values.contactType==='qq');condition('#contact-wechat-field',values.contactType==='wechat');
    $('#warranty-advice').hidden=values.warranty!=='是';$('#fault-advice').hidden=!FAULT_HINTS[values.faultType];$('#fault-advice').textContent=FAULT_HINTS[values.faultType] || '';
    $('#issue-required').textContent=values.faultType==='其他' ? '必填' : '选填';$('#issue-count').textContent=`${characterCount(values.issue)} / 1000 字`;
  }
  function renderTime(){const summary=timeSummary(picker.value());$('#step-two-time').innerHTML=summary;$('#step-three-time').innerHTML=summary;}
  function review(){renderTime();$('#booking-review').innerHTML=informationGroups({...data(),photoCount:photos.entries().length});}
  function go(next,{focus=true}={}){step=next;for(const panel of form.querySelectorAll('[data-step]'))panel.hidden=Number(panel.dataset.step)!==next;
    [...$('#booking-steps').children].forEach((item,index)=>{if(index+1===next)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');});
    if(next===3)review();else if(next===2)renderTime();
    saveDraft();if(focus){const heading=form.querySelector(`[data-step="${next}"] h2`);heading.focus({preventScroll:true});heading.scrollIntoView({block:'start',behavior:'auto'});}}
  function error(message){$('#booking-error').hidden=!message;$('#booking-error').textContent=message;}
  function showErrors(errors,{focus=true}={}){for(const target of form.querySelectorAll('[data-error-for]'))target.textContent='';for(const control of form.querySelectorAll('[aria-invalid]')){control.removeAttribute('aria-invalid');if(control.dataset.baseDescription)control.setAttribute('aria-describedby',control.dataset.baseDescription);else control.removeAttribute('aria-describedby');}
    for(const [key,message] of Object.entries(errors)){const name=key==='brand' && field('brand').value==='other' ? 'brandOther' : key==='college' && field('college').value==='other' ? 'collegeOther' : key==='contactValue' ? field('contactType').value==='qq' ? 'qqAccount' : 'wechatAccount' : key;
      const target=form.querySelector(`[data-error-for="${name}"]`);if(target){target.textContent=message;target.setAttribute('role','alert');if(!target.id)target.id='error-'+name;const controls=[...form.querySelectorAll(`[name="${name}"]`),...(name==='signature' ? [$('#open-signature')] : [])];controls.forEach(control=>{control.dataset.baseDescription ??=control.getAttribute('aria-describedby') || '';control.setAttribute('aria-invalid','true');control.setAttribute('aria-describedby',[control.dataset.baseDescription,target.id].filter(Boolean).join(' '));});}}
    const first=[...form.querySelectorAll('[data-error-for]')].find(target=>target.textContent && !target.closest('[hidden]'));
    if(first && focus){first.closest('.field,.form-block')?.scrollIntoView({block:'center',behavior:'auto'});const name=first.dataset.errorFor;const control=name==='signature' ? $('#open-signature') : form.querySelector(`[name="${name}"]:not(:disabled)`);control?.focus({preventScroll:true});}
  }
  function changed(){syncConditions();saveDraft();
    if(step===2){const errors=studentFieldErrors(data());for(const target of form.querySelectorAll('[data-error-for]')){if(!target.textContent)continue;const name=target.dataset.errorFor,key=name==='brandOther' ? 'brand' : name==='collegeOther' ? 'college' : ['qqAccount','wechatAccount'].includes(name) ? 'contactValue' : name;if(!errors[key]){target.textContent='';for(const control of form.querySelectorAll(`[name="${name}"]`)){control.removeAttribute('aria-invalid');if(control.dataset.baseDescription)control.setAttribute('aria-describedby',control.dataset.baseDescription);else control.removeAttribute('aria-describedby');}}}}
    if(step===3 && field('agreement').checked){form.querySelector('[data-error-for=agreement]').textContent='';field('agreement').removeAttribute('aria-invalid');}
  }
  form.addEventListener('input',changed);form.addEventListener('change',changed);
  form.querySelectorAll('[data-edit-step]').forEach(button=>button.addEventListener('click',()=>{if(!busy){error('');go(Number(button.dataset.editStep));}}));
  $('#step-one-next').addEventListener('click',async()=>{if(busy)return;const button=$('#step-one-next');button.disabled=true;try{if(await picker.refresh() && picker.validate()){error('');go(2);}}finally{button.disabled=false;}});
  $('#step-two-next').addEventListener('click',()=>{const errors=studentFieldErrors(data());showErrors(errors);if(Object.keys(errors).length || !photos.validity())return;if(!picker.validate()){go(1);error('原到场时段当前不可预约，请重新选择。其他已填信息已保留。');return;}error('');go(3);void picker.refresh();});
  $('#agreement-link').addEventListener('click',event=>{event.preventDefault();agreement.open();});$('#close-agreement').addEventListener('click',()=>agreement.close());
  $('#draft-prompt').hidden=!savedDraft;
  $('#draft-discard').addEventListener('click',()=>{savedDraft=null;clearDraft();$('#draft-prompt').hidden=true;});
  $('#draft-restore').addEventListener('click',async()=>{if(!savedDraft)return;restoring=true;const draft=savedDraft;savedDraft=null;form.reset();
    for(const control of form.querySelectorAll('[name]')){if(control.name==='agreement')continue;const value=draft.fields[control.name];if(control.type==='radio')control.checked=control.value===value;else if(value!==undefined)control.value=value;}
    syncConditions();signature.reset();photos.reset();await picker.restore(draft.fields);restoring=false;$('#draft-prompt').hidden=true;notice('已恢复文本和选择。请重新选择照片、勾选协议并完成手写签名。');go(picker.validate() ? Math.min(3,Math.max(1,draft.step || 1)) : 1);saveDraft();});
  async function resolve(){if(!attempt)return null;const result=await apiJson('/api/booking-attempts/resolve',{method:'POST',json:{requestKey:attempt.key},timeoutMs:15000});return result.found ? result.appointment : null;}
  function renderUploads(entries){if(!created)return;$('#success-photos').hidden=!entries.length;$('#success-photo-progress').innerHTML=entries.map(entry=>`<div class="photo-upload-row"><strong>${escapeHtml(entry.name)}</strong><p class="${entry.state==='upload-error' ? 'is-error' : ''}">${escapeHtml(entry.message)}</p>${entry.state==='uploading' ? '<progress aria-label="照片上传进度"></progress>' : ''}</div>`).join('');
    const failures=entries.some(entry=>entry.state==='upload-error'),pending=entries.some(entry=>!entry.attachment);
    $('#success-photo-message').textContent=failures ? '预约已成功，部分照片未上传。你可以重试或稍后在预约详情补充。' : pending ? '照片上传不影响已成功创建的预约。' : '照片已全部上传。';
    $('#success-photo-retry').hidden=!failures;$('#success-photo-retry').disabled=entries.some(entry=>entry.state==='uploading');$('#success-photo-later').hidden=!pending;
  }
  function showSuccess(appointment){created=appointment;const saved=saveAppointment(appointment);clearDraft();clearAttempt();savedDraft=null;attempt=null;payload=null;
    form.hidden=true;$('#booking-heading').hidden=true;$('#booking-steps').hidden=true;$('#draft-prompt').hidden=true;notice('');error('');$('#success-panel').hidden=false;
    $('#success-code').textContent=appointment.id;$('#success-summary').innerHTML=timeSummary(appointment);$('#success-link-fallback').value=privateLink(appointment);$('#success-link-fallback').hidden=saved;
    $('#credential-save-message').hidden=saved;$('#credential-save-message').textContent='此浏览器无法保存私人凭证。当前页面仍可访问预约，请复制并保留下面的完整私人查询链接。';
    void renderRepairQr($('#success-repair-qr'),appointment);renderUploads(photos.entries());picker.setActive(false);onCreated(appointment);$('#success-title').focus({preventScroll:true});window.scrollTo({top:0,behavior:'auto'});void photos.uploadAll(appointment);
  }
  async function submit(){if(busy)return;busy=true;$('#booking-submit').disabled=true;$('#booking-submit').textContent='正在核实并提交…';form.querySelectorAll('[data-edit-step]').forEach(button=>button.disabled=true);error('');
    try {
      if(attempt?.pending){const found=await resolve();if(found){showSuccess(found);return;}}
      const values=data(),errors=studentFieldErrors(values);
      if(!field('agreement').checked)errors.agreement='请阅读并同意维修协议';if(!signature.value())errors.signature='请点击“手写本人姓名”完成签名';
      if(Object.keys(errors).some(key=>!['agreement','signature'].includes(key))){go(2);showErrors(errors);return;}
      showErrors(errors);if(Object.keys(errors).length || !photos.validity())return;
      if(!await picker.refresh()){error('暂时无法核实时段和地点，请重试。已填信息已保留。');return;}if(!picker.validate()){go(1);error('到场时段当前不可预约，请重新选择。其他信息已保留。');return;}
      {const previousAt=payload?.agreementAt;const {brandOther,collegeOther,qqAccount,wechatAccount,...business}=values;
        // Draft-only alternative inputs never reach the server.
        void brandOther;void collegeOther;void qqAccount;void wechatAccount;
        payload={...business,...picker.value(),agreementAccepted:true,agreementAt:previousAt || new Date().toISOString(),agreementVersion:AGREEMENT_VERSION,signature:signature.value()};delete payload.location;}
      attempt=attempt || {key:requestKey()};attempt.pending=true;
      if(!writeAttempt(attempt))notice('此浏览器无法保存提交标识。如网络中断，请保持页面打开并重试。');
      saveDraft();
      try {showSuccess(await apiJson('/api/appointments',{method:'POST',headers:{'Idempotency-Key':attempt.key},json:payload,timeoutMs:15000}));}
      catch(failure){
        if(failure.code==='CREDENTIAL_ROTATED'){attempt.pending=false;writeAttempt(attempt);error(failure.message);return;}
        let found;
        try{found=await resolve();}catch{error('暂时无法确认预约是否创建。请保持页面和原提交标识，点击提交重试核实；不要另开新预约。');return;}
        if(found){showSuccess(found);if(failure.code==='IDEMPOTENCY_MISMATCH')notice('原请求已经创建成功，当前展示的是原预约。后续修改没有另行提交。');return;}
        if(['SLOT_FULL','SLOT_PAUSED','SLOT_ENDED','SLOT_CHANGED','DATE_UNAVAILABLE','LOCATION_MISSING'].includes(failure.code)){attempt=null;payload=null;clearAttempt();go(1);await picker.recover(failure.message);error(failure.message+'。其他信息和有效签名已保留。');}
        else if(failure.code==='FIELD_INVALID'){attempt=null;payload=null;clearAttempt();go(Object.keys(failure.fields || {}).some(key=>!['agreement','signature'].includes(key)) ? 2 : 3);showErrors(failure.fields || {});error(failure.message);}
        else if(failure.status && failure.status<500){attempt=null;payload=null;clearAttempt();error(failure.message);}
        else error('尚未确认创建结果。可使用原提交标识安全重试核实，已填内容已保留。');
      }
    }catch(failure){error(failure.message || '暂时无法核实预约结果，请保持页面并重试。');}
    finally{busy=false;$('#booking-submit').disabled=false;$('#booking-submit').textContent='确认并提交预约';form.querySelectorAll('[data-edit-step]').forEach(button=>button.disabled=false);}
  }
  form.addEventListener('submit',event=>{event.preventDefault();void submit();});
  $('#copy-code').addEventListener('click',()=>void copyPrivateLink(created,$('#success-link-fallback'),showToast));
  $('#view-created-appointment').addEventListener('click',()=>{photos.pauseUpload();onViewCreated(created);});
  $('#success-photo-retry').addEventListener('click',()=>void photos.uploadAll(created));$('#success-photo-later').addEventListener('click',()=>{photos.pauseUpload();$('#success-photo-message').textContent='你可以稍后在预约详情重新选择并补传照片。';});
  syncConditions();
  if(attempt?.pending){error('上次提交结果待核实，正在安全查询…');void resolve().then(found=>{if(found)showSuccess(found);else error('暂未查到创建结果，请恢复草稿并重新勾选协议、签名后，用原提交标识重试。');}).catch(failure=>{if(failure.code==='CREDENTIAL_ROTATED'){attempt.pending=false;writeAttempt(attempt);error(failure.message);notice('请通过工作人员补发的私人查询链接导入已有预约。');}else error('暂时无法确认上次提交结果，请保持原提交标识并重试核实。');});}
  return {
    hasDraft:()=>Boolean(!created && (savedDraft || readDraft() || Object.values(rawFields()).some(Boolean))),
    hasPending:()=>Boolean(attempt?.pending),
    reset(){if(busy || attempt?.pending)return false;photos.reset();signature.reset();picker.reset();form.reset();syncConditions();clearDraft();clearAttempt();savedDraft=null;attempt=null;payload=null;created=null;form.hidden=false;$('#booking-heading').hidden=false;$('#booking-steps').hidden=false;$('#success-panel').hidden=true;$('#draft-prompt').hidden=true;notice('');error('');picker.setActive(active);go(1);return true;},
    setActive(value){active=value;picker.setActive(value && !created);if(!value && created)photos.pauseUpload();},
    created:()=>created
  };
}
