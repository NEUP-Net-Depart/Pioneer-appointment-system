import { $, $$ } from '/shared/utils.js';
import { addDays, dateKey, validDate } from '/shared/time.js';

export function initDateFilter() {
  const input = $('#staff-date-filter'), days = $('#staff-calendar-days');
  const year = $('#staff-calendar-year'), month = $('#staff-calendar-month'), manual = $('#staff-date-manual');
  let view = dateKey().slice(0,7), cursor = dateKey();
  const firstOfMonth = value => `${value}-01`;
  function render() {
    const selected = input.value, today = dateKey(), currentYear = Number(view.slice(0,4));
    const yearOptions = Array.from({length:21},(_,index) => currentYear - 10 + index).filter(value => value >= 1 && value <= 9999).map(value => `<option value="${value}">${value} 年</option>`).join('');
    if (year.innerHTML !== yearOptions) year.innerHTML = yearOptions;
    year.value = String(currentYear); month.value = String(Number(view.slice(5,7)));
    const first = firstOfMonth(view), weekday = new Date(`${first}T00:00:00Z`).getUTCDay();
    const start = addDays(first,-((weekday + 6) % 7));
    if (cursor.slice(0,7) !== view) cursor = selected.startsWith(view) ? selected : today.startsWith(view) ? today : first;
    days.innerHTML = Array.from({length:42},(_,index) => {
      const date = addDays(start,index), outside = date.slice(0,7) !== view;
      return `<button type="button" data-calendar-date="${date}" tabindex="${date === cursor ? 0 : -1}" aria-label="${date.replace('-','年').replace('-','月')}日" aria-pressed="${date === selected}" ${date === today ? 'aria-current="date"' : ''} class="${outside ? 'is-outside' : ''} ${date === selected ? 'is-selected' : ''} ${date === today ? 'is-today' : ''}">${Number(date.slice(8))}</button>`;
    }).join('');
    $('#staff-calendar-selection').textContent = selected ? `已选 ${selected.replaceAll('-',' / ')}` : '全部日期';
    manual.value = selected;
    manual.setAttribute('aria-invalid','false');
    $('#staff-date-message').textContent = '';
    const shortcuts = {today,tomorrow:addDays(today,1),monday:addDays(today,-((new Date(`${today}T00:00:00Z`).getUTCDay()+6)%7))};
    $$('[data-date-shortcut]').forEach(button => {
      const active = shortcuts[button.dataset.dateShortcut] === selected;
      button.classList.toggle('is-active',active);button.setAttribute('aria-pressed',String(active));
    });
    $('#staff-clear-date').classList.toggle('is-active',!selected);
    $('#staff-clear-date').setAttribute('aria-pressed',String(!selected));
  }
  function select(date) {
    const changed = input.value !== date;
    input.value = date;
    cursor = date || dateKey(); view = cursor.slice(0,7);
    render();if(changed)input.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function moveMonth(offset) {
    const date = new Date(`${firstOfMonth(view)}T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth()+offset);
    if (date.getUTCFullYear()<1 || date.getUTCFullYear()>9999) return;
    view = date.toISOString().slice(0,7);cursor = firstOfMonth(view);render();
  }
  month.innerHTML = Array.from({length:12},(_,index) => `<option value="${index+1}">${index+1} 月</option>`).join('');
  year.addEventListener('change',()=>{view=`${year.value.padStart(4,'0')}-${month.value.padStart(2,'0')}`;render();});
  month.addEventListener('change',()=>{view=`${year.value.padStart(4,'0')}-${month.value.padStart(2,'0')}`;render();});
  $('#staff-calendar-prev').addEventListener('click',()=>moveMonth(-1));
  $('#staff-calendar-next').addEventListener('click',()=>moveMonth(1));
  days.addEventListener('click',event=>{
    const button=event.target.closest('[data-calendar-date]');
    if(button){select(button.dataset.calendarDate);days.querySelector(`[data-calendar-date="${cursor}"]`)?.focus();}
  });
  days.addEventListener('keydown',event=>{
    const button=event.target.closest('[data-calendar-date]');
    if(!button)return;
    const offset={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[event.key];
    if(offset!==undefined){event.preventDefault();cursor=addDays(button.dataset.calendarDate,offset);view=cursor.slice(0,7);render();days.querySelector(`[data-calendar-date="${cursor}"]`)?.focus();}
    if(event.key==='PageUp' || event.key==='PageDown'){event.preventDefault();moveMonth(event.key==='PageUp' ? -1:1);days.querySelector(`[data-calendar-date="${cursor}"]`)?.focus();}
  });
  $$('[data-date-shortcut]').forEach(button=>button.addEventListener('click',()=>{
    const today=dateKey(), key=button.dataset.dateShortcut;
    select(key==='today' ? today : key==='tomorrow' ? addDays(today,1) : addDays(today,-((new Date(`${today}T00:00:00Z`).getUTCDay()+6)%7)));
  }));
  $('#staff-clear-date').addEventListener('click',()=>select(''));
  function applyManual() {
    const value=manual.value.trim().replaceAll('/','-');
    if(!value || validDate(value)){select(value);manual.setAttribute('aria-invalid','false');}
    else{$('#staff-date-message').textContent='请输入有效日期，如 2026-10-12';manual.setAttribute('aria-invalid','true');}
  }
  manual.addEventListener('change',applyManual);
  manual.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();applyManual();}});
  return {sync(){cursor=input.value || dateKey();view=cursor.slice(0,7);render();manual.setAttribute('aria-invalid','false');}};
}
