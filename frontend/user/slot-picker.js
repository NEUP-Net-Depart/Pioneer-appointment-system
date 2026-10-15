import { $ } from '/shared/utils.js';
import { apiJson } from '/shared/api.js';
import { startVisiblePolling } from '/shared/polling.js';
import { CAMPUSES,TIME_SLOTS } from '/shared/constants.js';
import { bookingDates,slotAvailability } from '/shared/booking-slots.js';
import { timeLabel } from '/shared/time.js';

const weekday = new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',weekday:'short'});
export function initSlotPicker({onChange = () => {}} = {}) {
  const campusInput=$('[name=campus]'),dateInput=$('[name=date]'),slotInput=$('[name=timeSlot]');
  const campuses=$('#booking-campuses'),days=$('#booking-days'),slots=$('#booking-slots');
  let summaries=new Map(),failed=new Set(),generation=0,loading=false,notice='',offset=0,active=true,loadFailed=false,selectionIssue='';
  const now=() => new Date(Date.now()+offset);
  function button(value,key,title) {
    const item=document.createElement('button'); item.type='button';item.className='booking-choice';item.dataset[key]=value;
    const strong=document.createElement('strong');strong.textContent=title;
    const detail=document.createElement('small');item.append(strong,detail);return item;
  }
  for (const campus of CAMPUSES) campuses.append(button(campus,'campus',campus+'校区'));
  for (const slot of TIME_SLOTS) slots.append(button(slot,'slot',slot));
  const availability=(date,slot) => summaries.get(date) && slotAvailability(summaries.get(date),date,slot,now());
  const selectable=date => !failed.has(date) && TIME_SLOTS.some(slot => availability(date,slot) && !availability(date,slot).disabled);
  function render() {
    const dates=bookingDates(now());
    if ([...days.children].map(item=>item.dataset.date).join()!==dates.join()) {
      days.replaceChildren(...dates.map(date=>{
        const item=button(date,'date','');
        const strong=item.querySelector('strong');
        const day=document.createElement('span');day.className='booking-weekday';day.textContent=weekday.format(new Date(date+'T12:00:00+08:00'));
        const number=document.createElement('span');number.className='booking-date-number';number.textContent=`${Number(date.slice(5,7))}/${Number(date.slice(8))}`;
        strong.append(day,number);return item;
      }));
    }
    days.style.setProperty('--booking-day-count',String(Math.max(1,dates.length)));
    $('#booking-calendar').hidden=!campusInput.value;
    $('#booking-picker').setAttribute('aria-busy',String(loading));
    for (const item of campuses.children) item.setAttribute('aria-pressed',String(item.dataset.campus===campusInput.value));
    if (dateInput.value && !dates.includes(dateInput.value)) { dateInput.value='';slotInput.value='';selectionIssue=notice='原日期已不在预约范围内，请重新选择。'; }
    if (slotInput.value && !failed.has(dateInput.value) && availability(dateInput.value,slotInput.value)?.disabled) {
      selectionIssue=notice=`${availability(dateInput.value,slotInput.value).label}，请重新选择时段。`;slotInput.value='';onChange();
    }
    for (const item of days.children) {
      const date=item.dataset.date,summary=summaries.get(date);
      item.disabled=!selectable(date);item.setAttribute('aria-pressed',String(date===dateInput.value));
      const count=TIME_SLOTS.reduce((sum,slot)=>sum+(availability(date,slot)?.disabled ? 0 : availability(date,slot)?.remaining || 0),0);
      item.querySelector('small').textContent=failed.has(date) ? '读取失败' : !summary ? '读取中…' : !summary.location ? '地点未配置' : count ? `剩余 ${count} 名` : '暂无名额';
    }
    for (const item of slots.children) {
      const state=availability(dateInput.value,item.dataset.slot);
      item.disabled=failed.has(dateInput.value) || !state || state.disabled;
      item.setAttribute('aria-pressed',String(item.dataset.slot===slotInput.value));
      item.querySelector('small').textContent=failed.has(dateInput.value) ? '暂时无法更新' : state?.label || '读取中…';
    }
    $('#booking-slot-panel').hidden=!dateInput.value;
    const noDates=!loading && !loadFailed && !failed.size && !dates.some(selectable);
    $('#booking-empty').hidden=!noDates;
    $('#booking-retry').hidden=!campusInput.value || loading || (!loadFailed && !failed.size && !noDates);
    $('#booking-selection').textContent=notice || (!campusInput.value ? '请先选择校区。' : loading && !summaries.size ? '正在读取可预约日期…' : loadFailed || failed.size ? '暂时无法更新名额，请重试。' : slotInput.value ? `已选：${campusInput.value} · ${dateInput.value} · ${slotInput.value}` : '请选择到场时段。');
    const location=$('#booking-location');location.hidden=!dateInput.value;
    location.textContent=summaries.get(dateInput.value)?.location ? `维修地点：${summaries.get(dateInput.value).location}` : '维修地点尚未配置';
  }
  async function refresh() {
    if (!campusInput.value) {render();return true;}
    const current=++generation,campus=campusInput.value;loading=true;render();
    let result;
    try {result=await apiJson('/api/booking-availability?'+new URLSearchParams({campus}),{timeoutMs:15000});}
    catch {if(current!==generation)return false;loading=false;loadFailed=true;failed=new Set(bookingDates(now()));$('#booking-updated').textContent='更新失败';render();return false;}
    if(current!==generation)return false;
    loading=false;loadFailed=false;failed=new Set();offset=Date.parse(result.serverNow)-Date.now();const dates=bookingDates(now());
    result.items.forEach(summary=>summaries.set(summary.date,summary));
    if (!dateInput.value || (!failed.has(dateInput.value) && !selectable(dateInput.value))) {
      if(dateInput.value){const summary=summaries.get(dateInput.value);selectionIssue=notice=(summary && !summary.location ? '原日期的维修地点未配置' : '原日期当前没有可预约时段')+'，请重新选择日期和到场时段。';}
      dateInput.value=dates.find(selectable) || '';slotInput.value='';
    }
    $('#booking-updated').textContent=failed.size ? '更新失败' : `更新于 ${timeLabel(now())}`;
    render();onChange();return !failed.size;
  }
  campuses.addEventListener('click',event=>{
    const item=event.target.closest('[data-campus]');if(!item)return;
    if(campusInput.value!==item.dataset.campus){campusInput.value=item.dataset.campus;slotInput.value='';summaries=new Map();selectionIssue=notice='';onChange();}
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
  const stop=startVisiblePolling(()=>active && !loading ? refresh() : undefined);
  render();
  return {
    refresh,issue:()=>selectionIssue,
    value(){return {campus:campusInput.value,date:dateInput.value,timeSlot:slotInput.value,location:summaries.get(dateInput.value)?.location || ''};},
    validate(){render();const valid=Boolean(campusInput.value && dateInput.value && slotInput.value && selectable(dateInput.value) && !availability(dateInput.value,slotInput.value)?.disabled);
      if(!valid){notice=notice || '请选择可预约的校区、日期和到场时段。';render();(campuses.querySelector('button[aria-pressed=true]') || campuses.querySelector('button')).focus();}return valid;},
    async recover(message){slotInput.value='';notice=message;await refresh();render();},
    async restore(value){campusInput.value=CAMPUSES.includes(value.campus) ? value.campus : '';dateInput.value=value.date || '';slotInput.value=value.timeSlot || '';summaries=new Map();await refresh();render();},
    reset(){generation++;campusInput.value=dateInput.value=slotInput.value='';summaries=new Map();failed=new Set();loadFailed=false;selectionIssue=notice='';render();},
    setActive(value){active=value;if(value)void refresh();},
    dispose(){generation++;stop();}
  };
}
