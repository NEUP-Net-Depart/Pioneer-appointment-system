import { apiJson } from '/shared/api.js';
import { showToast } from '/shared/utils.js';

export function initRepairLocations() {
  let items = [], pending, loaded = false, failed = false;
  const find = campus => items.find(item => item.campus === campus);
  function paint() {
    for (const target of document.querySelectorAll('[data-repair-campus]')) {
      const item = find(target.dataset.repairCampus);
      const text = item?.location || (loaded ? '地点待确认，请联系工作人员' : failed ? '地点暂时无法读取，请重试' : '正在读取维修地点…');
      if (target.textContent !== text) target.textContent = text;
    }
    for (const button of document.querySelectorAll('[data-copy-repair-location]')) button.hidden = !find(button.dataset.copyRepairLocation)?.location;
    for (const button of document.querySelectorAll('[data-repair-retry]')) { button.hidden = !failed; button.disabled = Boolean(pending); }
    for (const target of document.querySelectorAll('[data-location-state]')) {
      target.hidden = !failed || !loaded;
      target.textContent = '地点更新失败，当前显示上次读取的信息';
    }
  }
  function refresh() {
    if (pending) return pending;
    pending = apiJson('/api/repair-locations').then(result => {
      items = result.items; loaded = true; failed = false;
    }).catch(() => { failed = true; }).finally(() => { pending = undefined; paint(); });
    paint(); return pending;
  }
  document.addEventListener('click',async event => {
    if (event.target.closest('[data-repair-retry]')) { await refresh(); return; }
    const button = event.target.closest('[data-copy-repair-location]');
    if (!button) return;
    const value = find(button.dataset.copyRepairLocation)?.location;
    if (!value) return;
    try { await navigator.clipboard.writeText(value); showToast('维修地点已复制'); }
    catch { showToast('无法自动复制，请选中地点文字复制'); }
  });
  void refresh();
  return { paint, refresh };
}
