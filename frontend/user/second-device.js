import { STUDENT_FIELD_LIMITS,studentFieldErrors,FAULT_HINTS } from '/shared/student-booking.js';
import { DEVICE_FIELDS,deviceFields } from '/shared/booking-devices.js';
import { createPhotoCollection } from './photos.js';

// Clone the same device fields before photos are mounted, keeping labels and validation identical.
export function initSecondDevice(form,{onChange,onUploadChange}) {
  const blocks=[...form.querySelectorAll('[data-step="2"] > .form-block')].slice(0,2);
  const root=document.createElement('section');root.id='second-device';root.hidden=true;
  root.setAttribute('aria-label','第二台设备');
  for(const block of blocks){
    const clone=block.cloneNode(true);
    for(const element of [clone,...clone.querySelectorAll('*')]){
      for(const attribute of ['id','name','for','data-answer','data-error-for']){
        if(element.hasAttribute(attribute))element.setAttribute(attribute,'second_'+element.getAttribute(attribute));
      }
    }
    root.append(clone);
  }
  root.querySelector('h3').textContent='第二台 · 设备信息';
  root.querySelectorAll('h3')[1].textContent='第二台 · 故障说明';
  blocks.at(-1).after(root);
  const field=name=>form.elements.namedItem('second_'+name);
  const collection=createPhotoCollection(root.querySelector('#second_booking-photos'),{inputId:'second-appointment-attachments',onChange,onUploadChange});
  function data(){
    const values={};for(const name of [...DEVICE_FIELDS,'brandOther'])values[name]=field(name)?.value || '';
    values.brand=values.brand==='other' ? values.brandOther.trim() : values.brand;
    if(values.deviceType!=='笔记本')values.liquidMetal=undefined;
    if(values.deviceType!=='笔记本' || values.brand!=='Dell')values.dellG15=undefined;
    return deviceFields(values);
  }
  function sync(enabled){
    root.hidden=!enabled;blocks[0].querySelector('h3').textContent=enabled ? '第一台 · 设备信息' : '设备信息';blocks[1].querySelector('h3').textContent=enabled ? '第一台 · 故障说明' : '故障说明';
    for(const control of root.querySelectorAll('input,select,textarea,button'))control.disabled=!enabled;
    if(!enabled)return;
    const values=data();
    for(const [id,show] of [['brand-other-field',field('brand').value==='other'],['liquid-metal-field',values.deviceType==='笔记本'],['dell-g15-field',values.deviceType==='笔记本' && values.brand==='Dell']]){
      const group=root.querySelector('#second_'+id);group.hidden=!show;
      for(const control of group.querySelectorAll('input')){control.disabled=!show;if(!show){if(control.type==='radio')control.checked=false;else control.value='';}}
    }
    const hint=FAULT_HINTS[values.faultType] || '';
    root.querySelector('#second_fault-advice').hidden=!hint;
    root.querySelector('#second_fault-advice-title').textContent=hint ? values.faultType+'须知' : '';
    root.querySelector('#second_fault-advice-message').textContent=hint;
    root.querySelector('#second_issue-required').hidden=values.faultType!=='其他';
    field('issue').required=values.faultType==='其他';
  }
  function errors(common){
    const errors=studentFieldErrors({...common,...data()});
    for(const key of Object.keys(errors))if(!DEVICE_FIELDS.includes(key))delete errors[key];
    for(const [key,limit] of Object.entries(STUDENT_FIELD_LIMITS)){
      const control=field(key==='brand' ? 'brandOther' : key);
      if(control && !control.disabled && [...control.value].length>limit)errors[key]=`必须在 ${limit} 字以内`;
    }
    return Object.fromEntries(Object.entries(errors).map(([key,value])=>['second_'+key,value]));
  }
  return {data,sync,errors,photos:collection};
}
