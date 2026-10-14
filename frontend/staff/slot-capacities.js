import { $, escapeHtml, showToast } from '/shared/utils.js';
import { apiJson } from '/shared/api.js';
import { CAMPUSES, TIME_SLOTS } from '/shared/constants.js';
import { initCapacitySheet } from './capacity-sheet.js';

export function initSlotCapacities() {
  const panel = $('#capacity-settings'), root = $('#capacity-fields');
  const reload = $('#reload-capacities'), state = $('#capacity-load-state');
  const campuses = $('#capacity-campuses');
  const save = $('#capacity-save-all'), draft = $('#capacity-draft-status');
  const copyTarget = $('#capacity-copy-target'), copyCampus = $('#capacity-copy-campus');
  const discard = $('#capacity-discard'), undo = $('#capacity-undo');
  const rows = new Map(), weekdayNames = ['','周一','周二','周三','周四'];
  let generation = 0, user = null, selectedCampus = '', saving = false, previous = null;
  const keyOf = item => `${item.campus}/${item.weekday}/${item.timeSlot}`;
  const dirty = row => row.input.value !== String(row.item.capacity);

  function render() {
    const allowed = CAMPUSES.filter(campus => [...rows.values()].some(row => row.item.campus === campus));
    if (!allowed.includes(selectedCampus)) selectedCampus = allowed[0] || '';
    const pending = [...rows.values()].filter(dirty);
    for (const row of rows.values()) {
      row.form.classList.toggle('is-dirty', dirty(row));
      row.form.classList.toggle('is-paused', row.input.value === '0');
      row.input.title = dirty(row) ? `未保存 · 原人数 ${row.item.capacity}` : row.item.capacity === 0 ? '暂停预约' : `最多 ${row.item.capacity} 人`;
    }
    for (const group of root.children) group.hidden = group.dataset.campus !== selectedCampus;
    const campusMarkup = allowed.map(campus => `<button type="button" class="secondary-btn" data-capacity-campus="${campus}" aria-pressed="${campus === selectedCampus}"${saving ? ' disabled' : ''}>${campus}校区${pending.some(row => row.item.campus === campus) ? ' · 未保存' : ''}</button>`).join('');
    if (campuses.innerHTML !== campusMarkup) campuses.innerHTML = campusMarkup;
    for (const group of root.children) {
      for (const total of group.querySelectorAll('[data-day-total]')) {
        const day = [...rows.values()].filter(row => row.item.campus === group.dataset.campus && row.item.weekday === Number(total.dataset.dayTotal));
        total.textContent = day.every(row => Number.isSafeInteger(row.input.valueAsNumber) && row.input.valueAsNumber >= 0) ? String(day.reduce((sum, row) => sum + row.input.valueAsNumber, 0)) : '—';
      }
    }
    const targets = allowed.filter(campus => campus !== selectedCampus);
    const targetMarkup = targets.map(campus => `<option>${campus}</option>`).join('');
    if (copyTarget.innerHTML !== targetMarkup) copyTarget.innerHTML = targetMarkup;
    copyTarget.disabled = copyCampus.disabled = saving || !targets.length;
    $('#capacity-campus-copy-row').hidden = !targets.length;
    const changedDays = allowed.map(campus => {
      const days = [1,2,3,4].filter(day => pending.some(row => row.item.campus === campus && row.item.weekday === day));
      return days.length ? `${campus} ${days.map(day => weekdayNames[day]).join('、')}` : '';
    }).filter(Boolean).join('；');
    draft.textContent = pending.length ? `${pending.length} 项待保存 · ${changedDays}` : '所有配置已保存';
    discard.disabled = saving || !pending.length;
    undo.disabled = saving || !previous?.size;
    save.disabled = saving || !pending.length;
    save.textContent = saving ? '正在保存…' : '保存全部修改';
    sheet.refresh();
  }
  function applyItem(row, item) {
    row.item = item; row.input.value = String(item.capacity); row.input.setCustomValidity('');
  }
  function valid(row) {
    const capacity = row.input.valueAsNumber;
    if (Number.isSafeInteger(capacity) && capacity >= 0) { row.input.setCustomValidity(''); return true; }
    selectedCampus = row.item.campus; render();
    row.input.setCustomValidity('请输入不小于 0 的整数，且不超过 9007199254740991');
    row.input.reportValidity(); return false;
  }
  function busy(value) {
    saving = value;
    for (const control of panel.querySelectorAll('button,input,select')) control.disabled = value;
    render();
  }
  async function saveAll() {
    if (saving) return;
    const changed = [...rows.values()].filter(dirty);
    if (!changed.length || changed.some(row => !valid(row))) return;
    const current = ++generation;
    busy(true); state.textContent = '';
    try {
      const result = await apiJson('/api/slot-capacities', { method: 'PATCH', json: {
        items: changed.map(row => ({ ...row.item, capacity: row.input.valueAsNumber }))
      } });
      if (current !== generation) return;
      for (const item of result.items) { const row = rows.get(keyOf(item)); if (row) applyItem(row, item); }
      previous = null;
      showToast(`已保存 ${result.items.length} 项人数配置`);
    } catch (error) {
      if (current !== generation) return;
      state.textContent = error.message.includes('配置已更新') ? `${error.message}。草稿已保留；请先放弃修改，再读取最新配置。` : error.message;
      showToast(error.message);
    } finally { if (current === generation) busy(false); }
  }
  function createRow(item, group) {
    const form = document.createElement('td'); form.className = 'capacity-row';
    form.dataset.campus = item.campus; form.dataset.timeSlot = item.timeSlot; form.dataset.weekday = String(item.weekday);
    form.dataset.sheetRow = String(TIME_SLOTS.indexOf(item.timeSlot)); form.tabIndex = 0;
    form.setAttribute('role','gridcell'); form.setAttribute('aria-label',`${item.campus} ${weekdayNames[item.weekday]} ${item.timeSlot}`);
    form.innerHTML = `<input type="number" min="0" max="9007199254740991" step="1" required aria-label="${escapeHtml(item.campus)} ${weekdayNames[item.weekday]} ${escapeHtml(item.timeSlot)} 预约人数" />`;
    const row = { form, input: form.querySelector('input') };
    rows.set(keyOf(item), row); group.append(form); applyItem(row, item);
    row.input.addEventListener('input', () => { previous?.delete(keyOf(item)); row.input.setCustomValidity(''); render(); });
  }
  campuses.addEventListener('click', event => {
    const button = event.target.closest('[data-capacity-campus]');
    if (button) { selectedCampus = button.dataset.capacityCampus; render(); }
  });
  const remember = () => { previous = new Map([...rows].map(([key,row]) => [key,row.input.value])); };
  function finishQuickSetting() {
    for (const [key,value] of previous) if (rows.get(key)?.input.value === value) previous.delete(key);
    render();
  }
  undo.addEventListener('click', () => {
    if (!previous) return;
    for (const [key,value] of previous) { const row = rows.get(key); if (row) { row.input.value = value; row.input.setCustomValidity(''); } }
    previous = null; render();
  });
  const sheet = initCapacitySheet({ root,toolbar:$('#capacity-sheet-toolbar'),campus:() => selectedCampus,disabled:() => saving || !rows.size,
    beforeChange:remember,afterChange:finishQuickSetting,notify:showToast,undo:() => undo.click() });
  discard.addEventListener('click', () => {
    for (const row of rows.values()) applyItem(row,row.item);
    previous = null; render(); state.textContent = '';
  });
  $('#capacity-bulk-form').addEventListener('submit', event => {
    event.preventDefault();
    const input = $('#capacity-bulk-value'), capacity = input.valueAsNumber;
    if (!Number.isSafeInteger(capacity) || capacity < 0) { input.setCustomValidity('请输入非负整数人数'); input.reportValidity(); return; }
    input.setCustomValidity('');
    const scope = $('#capacity-bulk-scope').value;
    remember();
    for (const row of rows.values()) if (row.item.campus === selectedCampus && (scope === 'week' || row.item.weekday === Number(scope))) {
      row.input.value = String(capacity); row.input.setCustomValidity('');
    }
    finishQuickSetting();
  });
  $('#capacity-bulk-value').addEventListener('input', event => event.target.setCustomValidity(''));
  function copyConfiguration(wholeWeek) {
    const weekday = Number($('#capacity-copy-day').value);
    const campus = wholeWeek ? selectedCampus : copyTarget.value;
    const source = [...rows.values()].filter(row => row.item.campus === selectedCampus && (!wholeWeek || row.item.weekday === weekday));
    if (!source.length || source.some(row => !valid(row))) return;
    // Read before writing: copying within the same campus must not alter its source.
    const values = new Map(source.map(row => [`${wholeWeek ? '' : row.item.weekday}/${row.item.timeSlot}`,row.input.value]));
    remember();
    for (const row of rows.values()) if (row.item.campus === campus) {
      row.input.value = values.get(`${wholeWeek ? '' : row.item.weekday}/${row.item.timeSlot}`);
      row.input.setCustomValidity('');
    }
    finishQuickSetting();
  }
  $('#capacity-copy-week').addEventListener('click', () => copyConfiguration(true));
  copyCampus.addEventListener('click', () => copyConfiguration(false));
  save.addEventListener('click', saveAll);

  async function refresh(actor, { discard = false } = {}) {
    if (!actor || !['admin', 'superadmin'].includes(actor.role)) { clear(); return; }
    if (saving) return;
    user = actor; panel.hidden = false;
    const current = ++generation;
    if (!rows.size) state.textContent = '正在读取人数配置…';
    try {
      const { items } = await apiJson('/api/slot-capacities');
      if (current !== generation) return;
      const keys = new Set(items.map(keyOf));
      for (const [key, row] of rows) if (!keys.has(key)) { row.form.remove(); rows.delete(key); }
      for (const group of [...root.children]) if (!items.some(item => item.campus === group.dataset.campus)) group.remove();
      for (const campus of CAMPUSES) {
        const campusItems = items.filter(item => item.campus === campus);
        if (!campusItems.length) continue;
        let group = [...root.children].find(element => element.dataset.campus === campus);
        if (!group) {
          group = document.createElement('section'); group.className = 'capacity-campus'; group.dataset.campus = campus;
          group.innerHTML = `<div class="capacity-table-heading"><h3>${campus}校区 · 每周预约人数</h3><span>橙色数字为未保存修改</span></div><table class="capacity-table" role="grid" aria-multiselectable="true"><caption class="sr-only">${campus}校区周一至周四各半小时时段预约人数</caption><thead><tr><th scope="col"><button type="button" data-sheet-header="all" aria-label="选择整个校区表格">时段</button></th>${[1,2,3,4].map(day => `<th scope="col"><button type="button" data-sheet-header="col" data-sheet-index="${day - 1}" aria-label="选择${weekdayNames[day]}整列">${weekdayNames[day]}</button></th>`).join('')}</tr></thead><tbody>${TIME_SLOTS.map((time,index) => `<tr data-capacity-time="${time}"><th scope="row"><button type="button" data-sheet-header="row" data-sheet-index="${index}" aria-label="选择 ${time} 整行">${time.split('–').map(part => `<span>${part}</span>`).join('<span class="capacity-time-dash">–</span>')}</button></th></tr>`).join('')}</tbody><tfoot><tr><th scope="row">每天合计</th>${[1,2,3,4].map(day => `<td data-day-total="${day}"></td>`).join('')}</tr></tfoot></table>`;
          root.append(group);
        }
        for (const weekday of [1,2,3,4]) for (const timeSlot of TIME_SLOTS) {
          const item = campusItems.find(entry => entry.weekday === weekday && entry.timeSlot === timeSlot);
          if (!item) continue;
          const row = rows.get(keyOf(item));
          if (!row) createRow(item, group.querySelector(`[data-capacity-time="${item.timeSlot}"]`));
          else if (discard || !dirty(row) && document.activeElement !== row.input) applyItem(row, item);
        }
      }
      if (discard) previous = null;
      render(); state.textContent = items.length ? '' : '当前账号没有可配置的授权校区';
    } catch (error) {
      if (current !== generation) return;
      state.textContent = '配置读取失败，请重新读取'; showToast(error.message);
    }
  }
  function clear() {
    generation++; user = null; saving = false; selectedCampus = ''; previous = null;
    rows.clear(); root.replaceChildren(); campuses.replaceChildren();
    sheet.clear();
    state.textContent = ''; busy(false); panel.hidden = true;
  }
  reload.addEventListener('click', () => refresh(user));
  return { refresh, clear };
}
