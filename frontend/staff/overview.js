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
    if (!data.dates.includes(selectedDate)) selectedDate = data.dates[0] || '';
    const buttons = data.dates.map(date => `<button type="button" data-overview-date="${date}" aria-pressed="${date === selectedDate}" class="${date === selectedDate ? 'is-active' : ''}"><span>${date === dateKey() ? '今天' : weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()]}</span><strong>${date.slice(5).replace('-', '/')}</strong></button>`).join('');
    if (dates.innerHTML !== buttons) dates.innerHTML = buttons;
    const panels = data.campuses.map(campus => {
      const items = data.items.filter(item => item.campus === campus && item.date === selectedDate);
      const pending = items.reduce((sum, item) => sum + item.booked + item.inProgress, 0);
      return `<section class="staff-campus-panel"><div class="staff-campus-heading"><h3>${escapeHtml(campus)}校区</h3><span>待处理 <strong>${pending}</strong> 人</span></div>${items.map(item => {
        const label = item.ended ? '时段已结束' : item.capacity === 0 ? '暂停预约' : item.occupied > item.capacity ? '超出当前上限' : item.remaining === 0 ? '名额已满' : `剩余 ${item.remaining} 名`;
        const ratio = item.capacity ? Math.min(100, item.occupied / item.capacity * 100) : 0;
        return `<button type="button" class="staff-overview-slot" data-overview-slot="${escapeHtml(item.timeSlot)}" data-overview-campus="${escapeHtml(campus)}" aria-label="查看${escapeHtml(campus)}${dateLabel(selectedDate)}${escapeHtml(item.timeSlot)}的预约"><span class="staff-slot-top"><strong>${escapeHtml(item.timeSlot)}</strong><span class="staff-slot-availability ${item.ended || item.capacity === 0 || item.remaining === 0 ? 'is-muted' : ''}">${label}</span></span><span class="staff-slot-count"><span>已占名额 <b>${item.occupied}</b> / ${item.capacity}</span><span>待签到 ${item.booked} · 维修中 ${item.inProgress}</span></span><span class="staff-slot-track" aria-hidden="true"><i style="width:${ratio}%"></i></span></button>`;
      }).join('')}</section>`;
    }).join('');
    if (campuses.innerHTML !== panels) campuses.innerHTML = panels;
    state.textContent = `更新于 ${timeLabel(new Date(data.updatedAt))} · ${dateLabel(selectedDate)}`;
  }
  dates.addEventListener('click', event => {
    const button = event.target.closest('[data-overview-date]');
    if (!button) return;
    selectedDate = button.dataset.overviewDate;
    render();
    dates.querySelector(`[data-overview-date="${selectedDate}"]`)?.focus();
  });
  campuses.addEventListener('click', event => {
    const button = event.target.closest('[data-overview-slot]');
    if (button) onSelect({ campus: button.dataset.overviewCampus, date: selectedDate, timeSlot: button.dataset.overviewSlot });
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
