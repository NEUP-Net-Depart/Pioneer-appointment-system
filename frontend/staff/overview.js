import { $, escapeHtml } from '/shared/utils.js';
import { apiJson } from '/shared/api.js';
import { dateKey, timeLabel } from '/shared/time.js';

export function initOverview(onSelect) {
  let data, selectedDate = '', generation = 0;
  const weekdays = ['周日','周一','周二','周三','周四','周五','周六'];
  const dateLabel = date => `${date.slice(5).replace('-', '/')} ${weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()]}`;
  const dates = $('#staff-overview-dates'), campuses = $('#staff-overview-campuses'), state = $('#staff-overview-state');
  function render() {
    if (!data) return;
    if (!(selectedDate === 'week' && data.week) && !data.dates.includes(selectedDate)) selectedDate = data.dates[0] || '';
    const weekly = selectedDate === 'week';
    dates.style.setProperty('--overview-day-count',data.dates.length+(data.week ? 1:0));
    const periodLabel = weekly ? `本周 ${data.week.start.slice(5).replace('-','/')}–${data.week.end.slice(5).replace('-','/')}` : dateLabel(selectedDate);
    const buttons = (data.week ? `<button type="button" data-overview-date="week" aria-pressed="${weekly}" class="${weekly ? 'is-active' : ''}"><span>汇总</span><strong>本周</strong></button>` : '') + data.dates.map(date => `<button type="button" data-overview-date="${date}" aria-pressed="${date === selectedDate}" class="${date === selectedDate ? 'is-active' : ''}"><span>${date === dateKey() ? '今天' : weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()]}</span><strong>${date.slice(5).replace('-', '/')}</strong></button>`).join('');
    if (dates.innerHTML !== buttons) dates.innerHTML = buttons;
    const panels = data.campuses.map(campus => {
      let items = (weekly ? data.week.items : data.items).filter(item => item.campus === campus && (weekly || item.date === selectedDate));
      if (weekly) items = [...new Set(items.map(item=>item.timeSlot))].map(timeSlot=>{
        const slots = items.filter(item=>item.timeSlot===timeSlot);
        const sum = key=>slots.reduce((total,item)=>total+item[key],0);
        return {timeSlot,capacity:sum('capacity'),occupied:sum('occupied'),booked:sum('booked'),inProgress:sum('inProgress'),remaining:slots.reduce((total,item)=>total+(item.ended ? 0:item.remaining),0),ended:slots.every(item=>item.ended)};
      });
      const pending = items.reduce((sum, item) => sum + item.booked + item.inProgress, 0);
      const campusAttr = `data-overview-campus="${escapeHtml(campus)}"`;
      return `<section class="staff-campus-panel"><div class="staff-campus-heading"><h3><button class="staff-campus-link" type="button" ${campusAttr} aria-label="查看${escapeHtml(campus)}${periodLabel}全部预约">${escapeHtml(campus)}校区</button></h3><button class="staff-overview-status" type="button" ${campusAttr} data-overview-status="pending">待处理 <strong>${pending}</strong> 人</button></div>${items.map(item => {
        const label = item.ended ? '时段已结束' : item.capacity === 0 ? '暂停预约' : item.occupied > item.capacity ? '超出当前上限' : item.remaining === 0 ? '名额已满' : `剩余 ${item.remaining} 名`;
        const ratio = item.capacity ? Math.min(100, item.occupied / item.capacity * 100) : 0;
        const slotAttr = `${campusAttr} data-overview-slot="${escapeHtml(item.timeSlot)}"`;
        return `<div class="staff-overview-slot"><button type="button" class="staff-slot-main" ${slotAttr} aria-label="查看${escapeHtml(campus)}${periodLabel}${escapeHtml(item.timeSlot)}的预约"><span class="staff-slot-top"><strong>${escapeHtml(item.timeSlot)}</strong><span class="staff-slot-availability ${item.ended || item.capacity === 0 || item.remaining === 0 ? 'is-muted' : ''}">${weekly && item.remaining>0 ? `剩余可约 ${item.remaining} 名` : label}</span></span></button><div class="staff-slot-count"><span>已占名额 <b>${item.occupied}</b> / ${item.capacity}</span><div class="staff-slot-statuses"><button class="staff-overview-status" type="button" ${slotAttr} data-overview-status="booked">待签到 ${item.booked}</button><button class="staff-overview-status" type="button" ${slotAttr} data-overview-status="in_progress">维修中 ${item.inProgress}</button></div></div><span class="staff-slot-track" aria-hidden="true"><i style="width:${ratio}%"></i></span></div>`;
      }).join('')}</section>`;
    }).join('');
    if (campuses.innerHTML !== panels) campuses.innerHTML = panels;
    state.textContent = `更新于 ${timeLabel(new Date(data.updatedAt))} · ${periodLabel}`;
  }
  const selectionDate = () => selectedDate === 'week' ? {date:'',dateFrom:data.week.start,dateTo:data.week.end} : {date:selectedDate};
  dates.addEventListener('click', event => {
    const button = event.target.closest('[data-overview-date]');
    if (!button) return;
    selectedDate = button.dataset.overviewDate;
    render();
    dates.querySelector(`[data-overview-date="${selectedDate}"]`)?.focus();
    onSelect({campus:'all',...selectionDate(),timeSlot:'',status:'all',navigate:false});
  });
  campuses.addEventListener('click', event => {
    const button = event.target.closest('[data-overview-campus]');
    if (button) onSelect({ campus: button.dataset.overviewCampus, ...selectionDate(), timeSlot: button.dataset.overviewSlot || '', status:button.dataset.overviewStatus || 'all' });
  });
  return {
    async refresh() {
      const current = ++generation;
      try {
        const result = await apiJson('/api/appointments/overview');
        if (current !== generation) return;
        data = result; render();
      } catch {
        if (current === generation) state.textContent = data ? '更新失败，保留上次数据；请重试刷新。' : '近期预约读取失败，请点击刷新数据重试。';
      }
    },
    clear() { generation++; data = undefined; selectedDate = ''; dates.innerHTML = ''; campuses.innerHTML = ''; state.textContent = '登录后读取近期预约'; }
  };
}
