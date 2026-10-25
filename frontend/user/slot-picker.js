import { $ } from '/shared/utils.js';
import { apiJson } from '/shared/api.js';
import { startVisiblePolling } from '/shared/polling.js';
import { CAMPUSES,TIME_SLOTS } from '/shared/constants.js';
import { bookingDates,slotAvailability } from '/shared/booking-slots.js';
import { DEFAULT_RELEASE_TIME } from '/shared/booking-settings.js';
import { animateLayout,reveal } from './motion.js';
import { initBookingNotices } from './booking-notices.js';

const weekday = new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',weekday:'short'});
function updateCount(count, remaining) {
  const value=remaining===undefined ? 'pending' : String(remaining),previous=/^\d+$/.test(count.dataset.value || '') ? count.dataset.value : '0';
  if(count.dataset.value===value)return;
  count.getAnimations({subtree:true}).forEach(animation=>animation.cancel());
  count.dataset.value=value;
  if(remaining===undefined || matchMedia('(prefers-reduced-motion: reduce)').matches || previous===value){count.textContent=remaining===undefined ? '—' : value;return;}
  const accessible=document.createElement('span');accessible.className='booking-count-value';accessible.textContent=value;
  const reel=document.createElement('span');reel.className='booking-count-reel';reel.setAttribute('aria-hidden','true');
  const oldDigits=previous.padStart(value.length,'0').slice(-value.length);
  for(const [index,digit] of [...value].entries()){
    const column=document.createElement('span');column.className='booking-count-column';
    const track=document.createElement('span');track.className='booking-count-track';
    const start=Number(oldDigits[index]),target=Number(digit),end=target+(target<=start ? 10 : 0);
    for(let step=0;step<=end;step++){
      const cell=document.createElement('span');cell.className='booking-count-digit';cell.dataset.digit=String(step%10);track.append(cell);
    }
    track.style.transform=`translateY(-${end}em)`;column.append(track);reel.append(column);
    if(start!==target)track.animate([{transform:`translateY(-${start}em)`},{transform:`translateY(-${end}em)`}],{duration:380+index*25,easing:'cubic-bezier(.18,.7,.25,1)'});
  }
  count.replaceChildren(accessible,reel);
}
function showRemaining(button,remaining,label) {
  const detail=button.querySelector('.booking-remaining');
  let count=detail.querySelector('.booking-remaining-count');
  if(label){
    count?.getAnimations({subtree:true}).forEach(animation=>animation.cancel());
    if(detail.textContent!==label)detail.textContent=label;
  }else{
    if(!count){count=document.createElement('span');count.className='booking-remaining-count';detail.replaceChildren('剩余 ',count,' 名');}
    updateCount(count,remaining);
  }
}
export function initSlotPicker({onChange = () => {},getDeviceCount=()=>1,getLockedScope=()=>null} = {}) {
  const campusInput=$('[name=campus]'),dateInput=$('[name=date]'),slotInput=$('[name=timeSlot]');
  const campuses=$('#booking-campuses'),days=$('#booking-days'),slots=$('#booking-slots');
  let summaries=new Map(),failed=new Set(),generation=0,loading=false,notice='',offset=0,active=true,loadFailed=false,selectionIssue='';
  const campusSummaries=new Map();
  const settingsByCampus=new Map(),announcements=initBookingNotices();
  const settings=()=>settingsByCampus.get(campusInput.value);
  const datesNow=()=>bookingDates(now(),settings()?.releaseTime || DEFAULT_RELEASE_TIME);
  const now=() => new Date(Date.now()+offset);
  function button(value,key,title) {
    const item=document.createElement('button'); item.type='button';item.className='booking-choice';item.dataset[key]=value;
    const strong=document.createElement('strong');strong.textContent=title;
    item.append(strong);if(key!=='campus'){const detail=document.createElement('small'),remaining=document.createElement('span');remaining.className='booking-remaining';detail.append(remaining);item.append(detail);}return item;
  }
  for (const campus of CAMPUSES) campuses.append(button(campus,'campus',campus+'校区'));
  for (const slot of TIME_SLOTS) slots.append(button(slot,'slot',slot));
  const availability=(date,slot) => {const state=summaries.get(date) && slotAvailability(summaries.get(date),date,slot,now());return state && !state.disabled && state.remaining<getDeviceCount() ? {...state,disabled:true,label:'不足 '+getDeviceCount()+' 个名额'} : state;};
  const selectable=date => !failed.has(date) && TIME_SLOTS.some(slot => availability(date,slot) && !availability(date,slot).disabled);
  function render() {
    const dates=datesNow();
    announcements.render(settings()?.notices || [],campusInput.value);
    const hint=$('#booking-release-hint');
    if(hint)hint.textContent=campusInput.value ? `每日北京时间 ${settings()?.releaseTime || DEFAULT_RELEASE_TIME} 更新预约范围；当天未结束时段仍可预约。` : '';
    for(const cache of campusSummaries.values())for(const date of cache.keys())if(!dates.includes(date))cache.delete(date);
    if ([...days.children].map(item=>item.dataset.date).join()!==dates.join()) {
      days.replaceChildren(...dates.map(date=>{
        const item=button(date,'date','');
        const strong=item.querySelector('strong');
        const day=document.createElement('span');day.className='booking-weekday';day.textContent=weekday.format(new Date(date+'T12:00:00+08:00'));
        const number=document.createElement('span');number.className='booking-date-number';number.textContent=`${Number(date.slice(5,7))}/${Number(date.slice(8))}`;
        strong.append(day,number);return item;
      }));
    }
    days.dataset.count=String(dates.length);
    days.style.setProperty('--booking-day-count',String(Math.max(1,dates.length)));
    const paused=!!summaries.get(dateInput.value)?.paused;
    const calendar=$('#booking-calendar'),slotPanel=$('#booking-slot-panel'),location=$('#booking-location'),pausePanel=$('#booking-paused');
    const showSlots=!!dateInput.value && !paused;
    if(calendar.hidden===Boolean(campusInput.value) || slotPanel.hidden===showSlots || pausePanel.hidden===paused){
      animateLayout($('#booking-picker'),()=>{calendar.hidden=!campusInput.value;slotPanel.hidden=!showSlots;pausePanel.hidden=!paused;location.hidden=!dateInput.value || paused;},{resize:true});
      if(showSlots)for(const [index,item] of [...slots.children].entries())reveal(item,{delay:index*30,distance:6});
    }
    $('#booking-picker').setAttribute('aria-busy',String(loading));
    for (const item of campuses.children){item.setAttribute('aria-pressed',String(item.dataset.campus===campusInput.value));item.disabled=!!getLockedScope();}
    if (!getLockedScope() && dateInput.value && !dates.includes(dateInput.value)) { dateInput.value='';slotInput.value='';selectionIssue=notice='原日期已不在预约范围内，请重新选择。'; }
    if (!getLockedScope() && slotInput.value && !failed.has(dateInput.value) && availability(dateInput.value,slotInput.value)?.disabled) {
      selectionIssue=notice=`${availability(dateInput.value,slotInput.value).label}，请重新选择时段。`;slotInput.value='';onChange();
    }
    for (const item of days.children) {
      const date=item.dataset.date,summary=summaries.get(date);
      const unavailable=!selectable(date);
      item.disabled=!!getLockedScope() || loading || unavailable&&!summary?.paused;item.dataset.loading=String(loading && (!summary || !unavailable));item.setAttribute('aria-pressed',String(date===dateInput.value));
      item.dataset.paused=String(!!summary?.paused);
      const count=TIME_SLOTS.reduce((sum,slot)=>sum+(availability(date,slot)?.disabled ? 0 : availability(date,slot)?.remaining || 0),0);
      showRemaining(item,summary ? count : undefined,failed.has(date) ? '读取失败' : !summary ? '' : summary.paused ? '暂停维修' : !summary.location ? '地点未配置' : count ? '' : '暂无名额');
    }
    for (const item of slots.children) {
      const state=availability(dateInput.value,item.dataset.slot);
      item.disabled=!!getLockedScope() || loading || failed.has(dateInput.value) || !state || state.disabled;
      item.dataset.loading=String(loading && (!state || !state.disabled));
      item.setAttribute('aria-pressed',String(item.dataset.slot===slotInput.value));
      showRemaining(item,state?.remaining,failed.has(dateInput.value) ? '暂时无法更新' : state?.disabled ? state.label : '');
    }
    $('#booking-slot-panel').hidden=!dateInput.value || paused;
    pausePanel.hidden=!paused;
    const nextButton=$('#step-one-next');
    if(paused)nextButton.disabled=true;else if(nextButton.dataset.paused==='true')nextButton.disabled=false;
    nextButton.dataset.paused=String(paused);
    nextButton.textContent=paused ? '当日暂停，请选择其他日期' : '下一步 · 填写设备信息';
    if(paused){
      $('#booking-paused-date').textContent=`${campusInput.value}校区 · ${dateInput.value}（${weekday.format(new Date(dateInput.value+'T12:00:00+08:00'))}）`;
      const announcement=settings()?.notices?.find(item=>item.type==='suspension' && item.businessDate===dateInput.value);
      $('#booking-paused-reason').textContent=announcement?.content || summaries.get(dateInput.value)?.pauseReason || '该校区当日暂停维修，请选择其他日期。';
    }
    const noDates=!loading && !loadFailed && !failed.size && !dates.some(selectable);
    $('#booking-empty').hidden=!noDates;
    $('#booking-retry').hidden=!campusInput.value || loading || (!loadFailed && !failed.size && !noDates);
    const feedback=$('#booking-selection');
    feedback.textContent=notice || (loadFailed || failed.size ? '暂时无法更新名额，请重试。' : loading && !summaries.size && !dateInput.value ? '正在读取可预约日期…' : '');
    feedback.parentElement.hidden=!feedback.textContent && $('#booking-retry').hidden;
    location.hidden=!dateInput.value || paused;
    location.textContent=summaries.get(dateInput.value)?.location ? `维修地点：${summaries.get(dateInput.value).location}` : loading ? '维修地点：更新中…' : '维修地点尚未配置';
  }
  async function refresh() {
    if (!campusInput.value) {render();return true;}
    const current=++generation,campus=campusInput.value;loading=true;render();
    let result;
    try {result=await apiJson('/api/booking-availability?'+new URLSearchParams({campus}),{timeoutMs:15000});}
    catch {if(current!==generation)return false;loading=false;loadFailed=true;failed=new Set(datesNow());render();return false;}
    if(current!==generation)return false;
    loading=false;loadFailed=false;failed=new Set();offset=Date.parse(result.serverNow)-Date.now();
    if(result.bookingSettings)settingsByCampus.set(campus,result.bookingSettings);
    const dates=datesNow();
    summaries=new Map(result.items.map(summary=>[summary.date,summary]));campusSummaries.set(campus,summaries);
    if (!getLockedScope() && (!dateInput.value || (!summaries.get(dateInput.value)?.paused && !failed.has(dateInput.value) && !selectable(dateInput.value)))) {
      if(dateInput.value){const summary=summaries.get(dateInput.value);selectionIssue=notice=(summary && !summary.location ? '原日期的维修地点未配置' : '原日期当前没有可预约时段')+'，请重新选择日期和到场时段。';}
      dateInput.value=dates.find(selectable) || '';slotInput.value='';
    }
    render();onChange();return !failed.size;
  }
  campuses.addEventListener('click',event=>{
    const item=event.target.closest('[data-campus]');if(!item || item.disabled)return;
    if(campusInput.value!==item.dataset.campus){campusInput.value=item.dataset.campus;slotInput.value='';summaries=campusSummaries.get(campusInput.value) || new Map();failed=new Set();loadFailed=false;selectionIssue=notice='';onChange();}
    void refresh();
  });
  days.addEventListener('click',event=>{
    const item=event.target.closest('[data-date]');if(!item || item.disabled)return;
    if(dateInput.value!==item.dataset.date)slotInput.value='';dateInput.value=item.dataset.date;notice='';render();onChange();
  });
  slots.addEventListener('click',event=>{
    const item=event.target.closest('[data-slot]');if(!item || item.disabled)return;
    slotInput.value=item.dataset.slot;selectionIssue=notice='';render();onChange();
  });
  $('#booking-retry').addEventListener('click',()=>void refresh());
  $('#booking-change-date').addEventListener('click',()=>{
    if(getLockedScope())return;
    dateInput.value=datesNow().find(day=>day!==dateInput.value && selectable(day)) || '';slotInput.value='';selectionIssue=notice='';render();onChange();
    (days.querySelector('[aria-pressed=true]') || campuses.querySelector('[aria-pressed=true]'))?.focus();
  });
  const stop=startVisiblePolling(()=>active && !loading ? refresh() : undefined);
  render();
  return {
    refresh,issue:()=>selectionIssue,
    acceptedNotices:announcements.accepted,
    confirmNotices:announcements.confirm,
    hasUnacceptedNotices:announcements.hasUnaccepted,
    setHome:announcements.setHome,
    value(){return {campus:campusInput.value,date:dateInput.value,timeSlot:slotInput.value,location:summaries.get(dateInput.value)?.location || ''};},
    validate(){render();const valid=Boolean(datesNow().includes(dateInput.value) && campusInput.value && dateInput.value && slotInput.value && selectable(dateInput.value) && !availability(dateInput.value,slotInput.value)?.disabled);
      if(!valid){notice=notice || '请选择可预约的校区、日期和到场时段。';render();(campuses.querySelector('button[aria-pressed=true]') || campuses.querySelector('button')).focus();}return valid;},
    async recover(message){if(!getLockedScope())slotInput.value='';notice=message;await refresh();render();},
    async restore(value){campusInput.value=CAMPUSES.includes(value.campus) ? value.campus : '';dateInput.value=value.date || '';slotInput.value=value.timeSlot || '';summaries=new Map();await refresh();render();},
    reset(){generation++;loading=false;campusInput.value=dateInput.value=slotInput.value='';summaries=new Map();campusSummaries.clear();announcements.reset();failed=new Set();loadFailed=false;selectionIssue=notice='';render();},
    setActive(value){active=value;announcements.setActive(value);if(value)void refresh();},
    dispose(){generation++;stop();announcements.dispose();$('#booking-picker').getAnimations({subtree:true}).forEach(animation=>animation.cancel());}
  };
}
