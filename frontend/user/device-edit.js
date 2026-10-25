import { escapeHtml } from '/shared/utils.js';
import { apiJson } from '/shared/api.js';
import { STUDENT_DEVICE_TYPES,BRANDS,FAULT_TYPES,ANSWERS,studentFieldErrors,STUDENT_FIELD_LIMITS } from '/shared/student-booking.js';
import { DEVICE_FIELDS } from '/shared/booking-devices.js';
import { credentialHeaders } from './credentials.js';

export function openDeviceEditor(root,item,onSaved){
  if(root.querySelector('form')){root.hidden=false;root.querySelector('select').focus();return;}
  const select=(key,label,options)=>`<label class="field">${label}<select name="${key}">${options.map(option=>{const value=option.value || option;return `<option value="${escapeHtml(value)}" ${item[key]===value?'selected':''}>${escapeHtml(option.label || option)}</option>`;}).join('')}</select></label>`;
  root.hidden=false;
  root.innerHTML=`<form class="device-edit-form" novalidate><h3>修改设备信息</h3><p class="field-hint">保留原预约编号、到场时间和维修码。已进入现场接待的预约请联系工作人员修改。</p><div class="device-edit-grid">${select('deviceType','设备类型',STUDENT_DEVICE_TYPES)}<label class="field">品牌<input name="brand" list="edit-device-brands" value="${escapeHtml(item.brand || '')}" maxlength="30" /><datalist id="edit-device-brands">${BRANDS.map(brand=>`<option value="${escapeHtml(brand.value)}">${escapeHtml(brand.label)}</option>`).join('')}</datalist></label><label class="field">设备型号<input name="deviceModel" maxlength="${STUDENT_FIELD_LIMITS.deviceModel}" value="${escapeHtml(item.deviceModel || '')}" /></label>${select('warranty','是否在保',ANSWERS)}${select('faultType','故障分类',FAULT_TYPES)}<div data-edit-laptop>${select('liquidMetal','是否使用液金',ANSWERS)}</div><div data-edit-dell>${select('dellG15','是否属于 Dell G15 系列',['',...ANSWERS])}</div></div><label class="field">故障描述与补充说明<textarea name="issue" maxlength="${STUDENT_FIELD_LIMITS.issue}">${escapeHtml(item.issue || '')}</textarea></label><p data-edit-error class="notice is-error" role="alert" hidden></p><div class="actions"><button type="submit" class="primary-btn">保存修改</button><button type="button" class="secondary-btn" data-edit-close>取消修改</button></div></form>`;
  const form=root.querySelector('form'),field=name=>form.elements.namedItem(name),message=root.querySelector('[data-edit-error]');
  function sync(){root.querySelector('[data-edit-laptop]').hidden=field('deviceType').value!=='笔记本';root.querySelector('[data-edit-dell]').hidden=field('deviceType').value!=='笔记本' || field('brand').value!=='Dell';}
  form.addEventListener('input',sync);sync();field('deviceType').focus();
  root.querySelector('[data-edit-close]').addEventListener('click',()=>{root.replaceChildren();root.hidden=true;root.parentElement.querySelector('[data-edit-device]')?.focus();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();const patch=Object.fromEntries(DEVICE_FIELDS.map(key=>[key,field(key).value.trim()]));
    if(patch.deviceType!=='笔记本')patch.liquidMetal=null;if(patch.deviceType!=='笔记本' || patch.brand!=='Dell')patch.dellG15=null;
    const errors=Object.fromEntries(Object.entries(studentFieldErrors({...item,...patch})).filter(([key])=>DEVICE_FIELDS.includes(key)));
    message.hidden=!Object.keys(errors).length;message.textContent=Object.values(errors).join('；');
    if(Object.keys(errors).length){field(Object.keys(errors)[0]).focus();return;}
    const controls=[...form.querySelectorAll('input,select,textarea,button')];controls.forEach(control=>control.disabled=true);
    try{const result=await apiJson('/api/appointments/'+encodeURIComponent(item.id)+'/device',{method:'PATCH',headers:credentialHeaders(item),json:{...patch,revision:item.revision},timeoutMs:15000});onSaved({...item,...result});root.replaceChildren();root.hidden=true;}
    catch(failure){message.hidden=false;message.textContent=(failure.message || '保存结果暂时无法确认')+'。输入已保留，可重试；如预约已变更，请先核对最新资料。';}
    finally{controls.forEach(control=>control.disabled=false);}
  });
}
