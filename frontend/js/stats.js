import { $, escapeHtml, formatDate, localDateString } from './utils.js';

function aggregate(appointments, range, selectedDay) {
  const today = new Date();
  const start = new Date(today);
  if (range !== 'all') start.setDate(start.getDate() - Number(range) + 1);
  const startKey = selectedDay || range === 'all' ? '' : localDateString(start);
  const rows = appointments.filter(item => (!startKey || item.date >= startKey) && (!selectedDay || item.date === selectedDay));
  const daily = new Map();
  const faults = new Map();
  const campuses = new Map();
  const technicians = new Map();
  rows.forEach(item => {
    const day = daily.get(item.date) || { total: 0, completed: 0 };
    day.total += 1;
    if (item.status === 'completed') day.completed += 1;
    daily.set(item.date, day);
    if (item.status === 'completed') faults.set(item.faultType || '未分类', (faults.get(item.faultType || '未分类') || 0) + 1);
    campuses.set(item.campus || '未填写', (campuses.get(item.campus || '未填写') || 0) + 1);
    if (item.assignedTo) {
      const workload = technicians.get(item.assignedTo) || { claimed: 0, completed: 0 };
      workload.claimed += 1;
      if (item.status === 'completed') workload.completed += 1;
      technicians.set(item.assignedTo, workload);
    }
  });
  return { rows, daily, faults, campuses, technicians };
}

function renderBars(target, values, total) {
  if (!values.length) { target.innerHTML = '<p class="stats-empty">暂无数据</p>'; return; }
  const max = Math.max(...values.map(([, value]) => value), 1);
  target.innerHTML = values.map(([label, value]) => `<div class="bar-row"><div class="bar-label"><span>${escapeHtml(label)}</span><strong>${value}</strong></div><div class="bar-track"><i style="width:${Math.max(6, value / max * 100)}%"></i></div><small>${total ? Math.round(value / total * 100) : 0}%</small></div>`).join('');
}

export function renderStats(appointments) {
  const range = $('#stats-range').value;
  const selectedDay = $('#stats-day').value;
  const { rows, daily, faults, campuses, technicians } = aggregate(appointments, range, selectedDay);
  const completed = rows.filter(item => item.status === 'completed').length;
  const noShow = rows.filter(item => item.status === 'no_show').length;
  $('#stats-total').textContent = rows.length;
  $('#stats-completed').textContent = completed;
  $('#stats-rate').textContent = `${rows.length ? Math.round(completed / rows.length * 100) : 0}%`;
  $('#stats-no-show').textContent = `${rows.length ? Math.round(noShow / rows.length * 100) : 0}%`;

  const days = [...daily.entries()].sort(([a], [b]) => a.localeCompare(b));
  const maxDay = Math.max(...days.map(([, value]) => value.total), 1);
  $('#daily-chart').innerHTML = days.length ? days.map(([day, value]) => `<div class="daily-column"><div class="daily-values"><span style="height:${Math.max(8, value.total / maxDay * 100)}%" title="预约 ${value.total}"></span><i style="height:${Math.max(value.completed ? 8 : 0, value.completed / maxDay * 100)}%" title="完成 ${value.completed}"></i></div><strong>${value.total}</strong><small>${formatDate(day).slice(5)}</small></div>`).join('') : '<p class="stats-empty">暂无数据</p>';
  renderBars($('#fault-chart'), [...faults.entries()].sort((a, b) => b[1] - a[1]), completed);
  renderBars($('#campus-chart'), [...campuses.entries()].sort((a, b) => b[1] - a[1]), rows.length);
  const workload = [...technicians.entries()].sort((a, b) => b[1].completed - a[1].completed);
  $('#technician-chart').innerHTML = workload.length ? `<div class="workload-head"><span>维修人员</span><span>接单数</span><span>完成数</span><span>完成率</span></div>${workload.map(([name, value]) => `<div class="workload-row"><strong>${escapeHtml(name)}</strong><span>${value.claimed}</span><span>${value.completed}</span><span>${value.claimed ? Math.round(value.completed / value.claimed * 100) : 0}%</span></div>`).join('')}` : '<p class="stats-empty">暂无已分配的维修记录</p>';
}

export function initStats(appointments) {
  $('#stats-range').addEventListener('change', () => renderStats(appointments));
  $('#stats-day').addEventListener('change', () => renderStats(appointments));
  $('#stats-clear-day').addEventListener('click', () => { $('#stats-day').value = ''; renderStats(appointments); });
  renderStats(appointments);
}
