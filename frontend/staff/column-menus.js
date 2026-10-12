import { $, $$ } from '/shared/utils.js';
import { statusLabels } from '/shared/constants.js';
import { initDateFilter } from './date-filter.js';

export function initColumnMenus(onChange) {
  let trigger, panel, sorts = [];
  const shade = $('#staff-menu-shade'), calendar = initDateFilter();
  const names = {createdAt:'提交时间',date:'预约时间',status:'状态',campus:'校区'};
  function close(restoreFocus = false) {
    if (!panel) return;
    panel.hidden = true; shade.hidden = true;
    trigger.setAttribute('aria-expanded','false');
    if (restoreFocus) trigger.focus();
    panel = undefined; trigger = undefined;
  }
  $$('[data-column-menu]').forEach(button => button.addEventListener('click', () => {
    if (button === trigger) { close(true); return; }
    close(); trigger = button; panel = $(`#staff-menu-${button.dataset.columnMenu}`);
    if (button.dataset.columnMenu === 'date') calendar.sync();
    trigger.setAttribute('aria-expanded','true'); panel.setAttribute('aria-modal','true'); panel.hidden = false; shade.hidden = false;
    panel.querySelector('input:not([type="hidden"]),select,[data-filter]')?.focus();
  }));
  $$('[data-menu-close]').forEach(button => button.addEventListener('click',() => close(true)));
  $$('[data-column-sort]').forEach(button => button.addEventListener('click',() => {
    const key=button.dataset.columnSort, index=sorts.findIndex(item=>item.key===key);
    if(index<0)sorts.push({key,direction:'asc'});
    else if(sorts[index].direction==='asc')sorts[index].direction='desc';
    else sorts.splice(index,1);
    onChange();
  }));
  shade.addEventListener('click', () => close(true));
  document.addEventListener('keydown', event => {
    if (!panel) return;
    if (event.key === 'Escape') { event.preventDefault(); close(true); }
    if (event.key === 'Tab') {
      const focusable = [...panel.querySelectorAll('button,input,select')].filter(element => !element.disabled && element.type!=='hidden' && element.tabIndex>=0);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  return {
    close,
    query(){return sorts.map(item=>`${item.key}:${item.direction}`).join(',');},
    reset(){sorts=[];close();calendar.sync();},
    update(status) {
      const campus = $('#staff-campus-filter').value, date = $('#staff-date-filter').value, slot = $('#staff-slot-filter').value;
      const labels = { createdAt:'按提交时间',campus:campus === 'all' ? '全部校区' : campus,date:[date?.replaceAll('-','/'),slot].filter(Boolean).join(' · ') || '全部日期与时段',status:statusLabels[status] || '全部状态' };
      for(const button of $$('[data-column-sort]')){
        const key=button.dataset.columnSort,index=sorts.findIndex(item=>item.key===key),sort=sorts[index];
        const marker=$(`[data-sort-marker="${key}"]`);
        marker.hidden=!sort;marker.textContent=sort ? `${sort.direction==='asc' ? '↑':'↓'}${index+1}`:'';
        button.classList.toggle('is-sorted',!!sort);
        button.setAttribute('aria-label',`${names[key]}${sort ? `，第${index+1}排序，${sort.direction==='asc' ? '升序':'降序'}`:'，未排序'}；点击${!sort ? '升序':sort.direction==='asc' ? '降序':'清除排序'}`);
        button.closest('th').setAttribute('aria-sort',!sort ? 'none':index>0 ? 'other':sort.direction==='asc' ? 'ascending':'descending');
      }
      for (const button of $$('[data-column-menu]')) {
        const key = button.dataset.columnMenu;
        const filtered = key === 'campus' ? campus !== 'all' : key === 'date' ? !!(date || slot) : status !== 'all';
        button.classList.toggle('is-filtered',filtered);
        button.setAttribute('aria-label',`筛选${names[key]}：${labels[key]}`);
      }
      for(const key of Object.keys(names))$(`[data-column-summary="${key}"]`).textContent=labels[key];
      $('#staff-sort-summary').textContent=sorts.length ? '排序优先级：'+sorts.map((item,index)=>`${index+1}. ${names[item.key]} ${item.direction==='asc' ? '↑':'↓'}`).join(' → ') : '点击列名：升序 → 降序 → 清除；多列按选择顺序组合。';
    }
  };
}
