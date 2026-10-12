import { $, $$ } from '/shared/utils.js';
import { addDays, dateKey, validDate, serviceDay } from '/shared/time.js';

export function initDateFilter() {
  const input = $('#staff-date-filter'), days = $('#staff-nearby-days'), manual = $('#staff-date-manual');
  const history = $('#staff-date-history'), weekdays = ['周日','周一','周二','周三','周四','周五','周六'];
  function nextWork(today) {
    let date = addDays(today,1);
    while (!serviceDay(date)) date = addDays(date,1);
    return date;
  }
  function render() {
    const today = dateKey(), selected = input.value;
    const dates = Array.from({length:4},(_,index)=>addDays(today,index)).filter(serviceDay);
    days.style.gridTemplateColumns=`repeat(${dates.length},minmax(0,1fr))`;
    days.innerHTML = dates.map(date=>`<button type="button" data-nearby-date="${date}" aria-pressed="${date===selected}" ${date===today?'aria-current="date"':''} class="${date===selected?'is-selected':''}"><span>${date===today?'今天':weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()]}</span><strong>${date.slice(5).replace('-','/')}</strong></button>`).join('');
    manual.value = selected;
    manual.setAttribute('aria-invalid','false');
    $('#staff-date-message').textContent = '';
    $('#staff-calendar-selection').textContent = input.dataset.from ? `本周 ${input.dataset.from.slice(5).replace('-','/')}–${input.dataset.to.slice(5).replace('-','/')}` : selected ? `已选 ${selected.replaceAll('-',' / ')}` : '全部日期';
    for(const button of $$('[data-date-shortcut]')) {
      const active = selected===nextWork(today);
      button.classList.toggle('is-active',active);button.setAttribute('aria-pressed',String(active));
    }
    $('#staff-clear-date').classList.toggle('is-active',!selected && !input.dataset.from);
    $('#staff-clear-date').setAttribute('aria-pressed',String(!selected && !input.dataset.from));
  }
  function select(date) {
    const changed=input.value!==date || !!input.dataset.from;
    input.dataset.from='';input.dataset.to='';
    input.value=date;render();
    if(changed)input.dispatchEvent(new Event('change',{bubbles:true}));
  }
  days.addEventListener('click',event=>{
    const button=event.target.closest('[data-nearby-date]');
    if(button){const date=button.dataset.nearbyDate;select(date);days.querySelector(`[data-nearby-date="${date}"]`)?.focus();}
  });
  days.addEventListener('keydown',event=>{
    const buttons=[...days.querySelectorAll('button')],index=buttons.indexOf(event.target);
    const offset={ArrowLeft:-1,ArrowUp:-1,ArrowRight:1,ArrowDown:1}[event.key];
    if(index>=0 && offset!==undefined){event.preventDefault();buttons[(index+offset+buttons.length)%buttons.length].focus();}
  });
  $$('[data-date-shortcut]').forEach(button=>button.addEventListener('click',()=>select(nextWork(dateKey()))));
  $('#staff-clear-date').addEventListener('click',()=>select(''));
  function applyManual() {
    const value=manual.value.trim().replaceAll('/','-');
    if(!value || validDate(value) && value<=dateKey()){select(value);}
    else{$('#staff-date-message').textContent='请输入有效的历史日期（不晚于今天）';manual.setAttribute('aria-invalid','true');}
  }
  manual.addEventListener('change',applyManual);
  manual.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();applyManual();}});
  return {sync(){history.open=false;render();}};
}
