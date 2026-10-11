import { $, escapeHtml, showToast } from '/shared/utils.js';
import { apiJson } from '/shared/api.js';
import { CAMPUSES, TIME_SLOTS } from '/shared/constants.js';

export function initSlotCapacities() {
  const panel = $('#capacity-settings'), root = $('#capacity-fields');
  const reload = $('#reload-capacities'), state = $('#capacity-load-state');
  const rows = new Map();
  let generation = 0, user = null;

  function applyItem(row, item) {
    row.item = item;
    row.input.value = String(item.capacity);
    row.input.setCustomValidity('');
    row.note.textContent = item.capacity === 0 ? '暂停预约' : `开放预约 · 最多 ${item.capacity} 人`;
  }

  function createRow(item, group) {
    const key = `${item.campus}/${item.timeSlot}`, form = document.createElement('form');
    form.className = 'capacity-row';
    form.dataset.campus = item.campus;
    form.dataset.timeSlot = item.timeSlot;
    form.innerHTML = `<label>${escapeHtml(item.timeSlot)}<input type="number" min="0" max="9007199254740991" step="1" required aria-label="${escapeHtml(item.campus)} ${escapeHtml(item.timeSlot)} 预约人数" /></label><button class="secondary-btn" type="submit">保存</button><p role="status"></p>`;
    const row = { form, input: form.querySelector('input'), button: form.querySelector('button'), note: form.querySelector('p'), saving: false };
    rows.set(key, row);
    group.append(form);
    applyItem(row, item);
    row.input.addEventListener('input', () => {
      row.input.setCustomValidity('');
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (row.saving) return;
      const capacity = row.input.valueAsNumber;
      if (!Number.isSafeInteger(capacity) || capacity < 0) {
        row.input.setCustomValidity('请输入不小于 0 的整数，且不超过 9007199254740991');
        row.input.reportValidity();
        return;
      }
      generation++;
      row.saving = true;
      row.input.disabled = row.button.disabled = reload.disabled = true;
      try {
        const updated = await apiJson('/api/slot-capacities', { method: 'PATCH', json: { ...row.item, capacity } });
        if (rows.get(key) !== row) return;
        generation++;
        applyItem(row, updated);
        showToast('预约人数已保存');
      } catch (error) {
        if (rows.get(key) !== row) return;
        row.note.textContent = error.message;
        showToast(error.message);
      } finally {
        row.saving = false;
        row.input.disabled = row.button.disabled = false;
        reload.disabled = [...rows.values()].some(entry => entry.saving);
      }
    });
  }

  async function refresh(actor, { discard = false } = {}) {
    if (!actor || !['admin', 'superadmin'].includes(actor.role)) { clear(); return; }
    user = actor;
    panel.hidden = false;
    const current = ++generation;
    if (!rows.size) state.textContent = '正在读取预约人数配置…';
    try {
      const { items } = await apiJson('/api/slot-capacities');
      if (current !== generation) return;
      const keys = new Set(items.map(item => `${item.campus}/${item.timeSlot}`));
      for (const [key, row] of rows) {
        if (!keys.has(key)) { row.form.remove(); rows.delete(key); }
      }
      for (const group of [...root.children]) {
        if (!items.some(item => item.campus === group.dataset.campus)) group.remove();
      }
      for (const campus of CAMPUSES) {
        const campusItems = items.filter(item => item.campus === campus);
        if (!campusItems.length) continue;
        let group = [...root.children].find(element => element.dataset.campus === campus);
        if (!group) {
          group = document.createElement('section');
          group.className = 'capacity-campus';
          group.dataset.campus = campus;
          const heading = document.createElement('h3');
          heading.textContent = `${campus}校区`;
          group.append(heading);
          root.append(group);
        }
        for (const timeSlot of TIME_SLOTS) {
          const item = campusItems.find(entry => entry.timeSlot === timeSlot);
          if (!item) continue;
          const row = rows.get(`${campus}/${timeSlot}`);
          if (!row) createRow(item, group);
          else {
            const untouched = row.input.value === String(row.item.capacity) && document.activeElement !== row.input;
            if (!row.saving && (discard || untouched)) applyItem(row, item);
          }
        }
      }
      state.textContent = items.length ? '' : '当前账号没有可配置的授权校区';
    } catch (error) {
      if (current !== generation) return;
      state.textContent = '配置读取失败，请点击重新读取配置重试';
      showToast(error.message);
    }
  }

  function clear() {
    generation++;
    user = null;
    rows.clear();
    root.replaceChildren();
    state.textContent = '';
    reload.disabled = false;
    panel.hidden = true;
  }

  reload.addEventListener('click', () => refresh(user, { discard: true }));
  return { refresh, clear };
}
