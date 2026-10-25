import { STUDENT_FIELD_LIMITS,studentFieldErrors,FAULT_HINTS } from '/shared/student-booking.js';
import { DEVICE_FIELDS,deviceFields } from '/shared/booking-devices.js';
import { animateLayout,reveal } from './motion.js';
import { createPhotoCollection } from './photos.js';

// Clone the same device fields before photos are mounted, keeping labels and validation identical.
export function initSecondDevice(form,{onChange,onUploadChange,onCountChange,onRemoveFirst}) {
  const blocks=[...form.querySelectorAll('[data-step="2"] > .form-block')].slice(0,2);
  const root=document.createElement('div');root.id='second-device';root.hidden=true;root.className='device-panel';
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
  root.querySelectorAll('h3')[1].textContent='故障说明';
  blocks.at(-1).after(root);
  const first=document.createElement('div');first.className='device-panel';first.id='first-device';
  blocks[0].before(first);blocks.forEach(block=>first.append(block));
  const heading=document.createElement('h3');heading.className='device-tabs';heading.setAttribute('role','tablist');heading.setAttribute('aria-label','设备信息');
  heading.innerHTML='<button type="button" role="tab" id="device-tab-one" aria-controls="first-device">设备信息一</button><span aria-hidden="true">/</span><button type="button" id="add-booking-device">添加设备二</button><button type="button" role="tab" id="device-tab-two" aria-controls="second-device" hidden>设备信息二</button>';
  first.before(heading);
  const add=heading.querySelector('#add-booking-device'),tabs=[heading.querySelector('#device-tab-one'),heading.querySelector('#device-tab-two')];
  const remove=document.createElement('button');remove.type='button';remove.id='remove-booking-device';remove.className='text-btn device-remove';remove.textContent='移除';remove.setAttribute('aria-label','移除当前设备');heading.append(remove);
  let active=0,enabledNow=false;
  for(const [index,panel] of [first,root].entries()){panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',tabs[index].id);panel.querySelector('h3').hidden=true;panel.addEventListener('device-reveal',()=>select(index));}
  function select(index,{motion=true}={}){
    index=index===1 && enabledNow?1:0;
    const changed=active!==index;active=index;
    const update=()=>{first.hidden=active!==0;root.hidden=!enabledNow || active!==1;tabs.forEach((tab,i)=>{tab.setAttribute('aria-selected',String(i===active));tab.tabIndex=i===active?0:-1;});};
    if(changed && motion){animateLayout(form,update,{resize:true});reveal(active?root:first,{distance:3});}else update();
  }
  tabs.forEach((tab,index)=>{tab.addEventListener('click',()=>select(index));tab.addEventListener('keydown',event=>{if(!enabledNow || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?1:1-active;select(next);tabs[next].focus();});});
  add.addEventListener('click',()=>{onCountChange(2);select(1);tabs[1].focus();});
  remove.addEventListener('click',()=>{animateLayout(form,()=>{if(active===0)onRemoveFirst();else collection.reset();clearSecond();onCountChange(1);select(0,{motion:false});},{resize:true});reveal(first,{distance:3});tabs[0].focus();});
  const contact=form.querySelector('[data-step="2"] > .form-block');contact.classList.add('booking-owner');
  const ownerHint=document.createElement('p');ownerHint.className='field-hint owner-hint';ownerHint.textContent='两台设备共用，只需填写一次。';contact.querySelector('h3').after(ownerHint);
  function clearSecond(){for(const control of root.querySelectorAll('input,select,textarea')){if(control.type==='radio' || control.type==='checkbox')control.checked=false;else control.value='';}}
  const field=name=>form.elements.namedItem('second_'+name);
  let collection=createPhotoCollection(root.querySelector('#second_booking-photos'),{inputId:'second-appointment-attachments',onChange,onUploadChange});
  function data(){
    const values={};for(const name of [...DEVICE_FIELDS,'brandOther'])values[name]=field(name)?.value || '';
    values.brand=values.brand==='other' ? values.brandOther.trim() : values.brand;
    if(values.deviceType!=='笔记本')values.liquidMetal=undefined;
    if(values.deviceType!=='笔记本' || values.brand!=='Dell')values.dellG15=undefined;
    return deviceFields(values);
  }
  function sync(enabled,locked=false){
    enabledNow=enabled;add.hidden=enabled || locked;tabs[1].hidden=!enabled;heading.querySelector('span').hidden=locked;remove.hidden=!enabled;ownerHint.hidden=!enabled;
    select(active,{motion:false});
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
  return {data,sync,errors,get photos(){return collection;},select,
    promote(primary){
      for(const control of first.querySelectorAll('input[name],select[name],textarea[name]')){const other=field(control.name);if(!other)continue;if(control.type==='radio')control.checked=[...root.querySelectorAll('input[type=radio]')].some(input=>input.name==='second_'+control.name && input.value===control.value && input.checked);else control.value=other.value;}
      primary.reset();
      const firstPhotos=first.querySelector('#booking-photos'),secondPhotos=root.querySelector('#second_booking-photos'),marker=document.createTextNode('');firstPhotos.replaceWith(marker);secondPhotos.replaceWith(firstPhotos);marker.replaceWith(secondPhotos);
      firstPhotos.id='second_booking-photos';secondPhotos.id='booking-photos';firstPhotos.querySelector('input[type=file]').id='second-appointment-attachments';secondPhotos.querySelector('input[type=file]').id='appointment-attachments';
      const kept=collection;collection=primary;return kept;
    },resetPanels(){select(0,{motion:false});}};
}
