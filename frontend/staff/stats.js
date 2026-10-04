import { apiJson } from '/shared/api.js';
import { $, escapeHtml, showToast } from '/shared/utils.js';
import { formatDate } from '/shared/time.js';

function renderBars(target, values, total) {
  if (!values.length) { target.innerHTML = '<p class="stats-empty">暂无数据</p>'; return; }
  const max = Math.max(...values.map(([, value]) => value), 1);
  target.innerHTML = values.map(([label, value]) => `<div class="bar-row"><div class="bar-label"><span>${escapeHtml(label)}</span><strong>${value}</strong></div><div class="bar-track"><i style="width:${Math.max(6, value / max * 100)}%"></i></div><small>${total ? Math.round(value / total * 100) : 0}%</small></div>`).join('');
}

function renderStats(stats) {
  const { daily, faults, campuses, technicians } = stats;
  const completed = stats.completed;
  const noShow = stats.noShow;
  $('#stats-total').textContent = stats.total;
  $('#stats-completed').textContent = completed;
  $('#stats-rate').textContent = `${stats.total ? Math.round(completed / stats.total * 100) : 0}%`;
  $('#stats-no-show').textContent = `${stats.total ? Math.round(noShow / stats.total * 100) : 0}%`;

  const days = Object.entries(daily);
  const maxDay = Math.max(...days.map(([, value]) => value.total), 1);
  $('#daily-chart').innerHTML = days.length ? days.map(([day, value]) => `<div class="daily-column"><div class="daily-values"><span style="height:${Math.max(8, value.total / maxDay * 100)}%" title="预约 ${value.total}"></span><i style="height:${Math.max(value.completed ? 8 : 0, value.completed / maxDay * 100)}%" title="完成 ${value.completed}"></i></div><strong>${value.total}</strong><small>${formatDate(day).slice(5)}</small></div>`).join('') : '<p class="stats-empty">暂无数据</p>';
  renderBars($('#fault-chart'), Object.entries(faults), completed);
  renderBars($('#campus-chart'), Object.entries(campuses), stats.total);
  // Integer-like account keys lose SQL ordering when represented as a JSON object.
  const workload = Object.entries(technicians).sort((a, b) => b[1].completed - a[1].completed);
  $('#technician-chart').innerHTML = workload.length ? `<div class="workload-head"><span>维修人员</span><span>接单数</span><span>完成数</span><span>完成率</span></div>${workload.map(([name, value]) => `<div class="workload-row"><strong>${escapeHtml(name)}</strong><span>${value.claimed}</span><span>${value.completed}</span><span>${value.claimed ? Math.round(value.completed / value.claimed * 100) : 0}%</span></div>`).join('')}` : '<p class="stats-empty">暂无已分配的维修记录</p>';
}

export function initStats() {
  let generation = 0;
  function empty() { renderStats({ total: 0, completed: 0, noShow: 0, daily: {}, faults: {}, campuses: {}, technicians: {} }); }
  async function refresh() {
    const current = ++generation;
    const query = new URLSearchParams({ range: $('#stats-range').value, day: $('#stats-day').value });
    try {
      const stats = await apiJson(`/api/stats/summary?${query}`);
      if (current === generation) renderStats(stats);
    } catch (error) { if (current === generation) showToast(error.message || '统计加载失败'); }
  }
  $('#stats-range').addEventListener('change', refresh);
  $('#stats-day').addEventListener('change', refresh);
  $('#stats-clear-day').addEventListener('click', () => { $('#stats-day').value = ''; refresh(); });
  empty();
  return { refresh, clear() { generation++; empty(); } };
}
