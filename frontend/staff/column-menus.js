import { $, $$ } from '/shared/utils.js';
import { statusLabels } from '/shared/constants.js';

export function initColumnMenus(onSort) {
  let trigger, panel;
  const shade = $('#staff-menu-shade');
  function close(restoreFocus = false) {
    if (!panel) return;
    panel.hidden = true; shade.hidden = true;
    trigger.setAttribute('aria-expanded','false');
    if (restoreFocus) trigger.focus();
    panel = undefined; trigger = undefined;
  }
  function position() {
    if (!panel || window.innerWidth <= 760) return;
    const rect = trigger.getBoundingClientRect();
    panel.style.left = `${Math.max(12,Math.min(rect.left,window.innerWidth - panel.offsetWidth - 12))}px`;
    const top = rect.bottom + 8;
    panel.style.top = `${Math.max(12,Math.min(top,window.innerHeight - panel.offsetHeight - 12))}px`;
  }
  $$('[data-column-menu]').forEach(button => button.addEventListener('click', () => {
    if (button === trigger) { close(true); return; }
    close(); trigger = button; panel = $(`#staff-menu-${button.dataset.columnMenu}`);
    trigger.setAttribute('aria-expanded','true'); panel.setAttribute('aria-modal','true'); panel.hidden = false; shade.hidden = false;
    position(); panel.querySelector('input,select,[data-filter],[data-column-sort]')?.focus();
  }));
  $$('[data-menu-close]').forEach(button => button.addEventListener('click',() => close(true)));
  $$('[data-column-sort]').forEach(button => button.addEventListener('click',() => onSort(button.dataset.columnSort,button.dataset.direction)));
  shade.addEventListener('click', () => close(true));
  document.addEventListener('keydown', event => {
    if (!panel) return;
    if (event.key === 'Escape') { event.preventDefault(); close(true); }
    if (event.key === 'Tab') {
      const focusable = [...panel.querySelectorAll('button,input,select')].filter(element => !element.disabled);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  window.addEventListener('resize',position);
  window.addEventListener('scroll',position,{passive:true});
  return {
    close,
    update(status) {
      const sort = $('#staff-sort').value, direction = $('#staff-direction').value;
      const campus = $('#staff-campus-filter').value, date = $('#staff-date-filter').value, slot = $('#staff-slot-filter').value;
      const labels = { createdAt:'提交时间',campus:campus === 'all' ? '全部校区' : campus,date:[date?.slice(5).replace('-','/'),slot].filter(Boolean).join(' · ') || '全部日期',status:statusLabels[status] || '全部状态' };
      for (const button of $$('[data-column-menu]')) {
        const key = button.dataset.columnMenu, sorted = key === sort;
        const filtered = key === 'campus' ? campus !== 'all' : key === 'date' ? !!(date || slot) : key === 'status' ? status !== 'all' : false;
        button.classList.toggle('is-filtered',filtered);
        button.classList.toggle('is-sorted',sorted);
        $('[data-column-summary="'+key+'"]').textContent = labels[key] + (sorted ? (direction === 'asc' ? ' ↑' : ' ↓') : '');
        button.closest('th').setAttribute('aria-sort',sorted ? (direction === 'asc' ? 'ascending' : 'descending') : 'none');
      }
      $$('[data-column-sort]').forEach(button => {
        const active = button.dataset.columnSort === sort && button.dataset.direction === direction;
        button.classList.toggle('is-active',active);button.setAttribute('aria-pressed',String(active));
      });
    }
  };
}
