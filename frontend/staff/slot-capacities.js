import { $, escapeHtml, showToast } from '/shared/utils.js';
import { apiJson } from '/shared/api.js';
import { CAMPUSES, TIME_SLOTS } from '/shared/constants.js';

export function initSlotCapacities() {
  const panel = $('#capacity-settings'), root = $('#capacity-fields');
  const reload = $('#reload-capacities'), state = $('#capacity-load-state');
  const weekdays = $('#capacity-weekdays'), campuses = $('#capacity-campuses');
  const save = $('#capacity-save-all'), draft = $('#capacity-draft-status');
  const copyTarget = $('#capacity-copy-target'), copyCampus = $('#capacity-copy-campus');
  const rows = new Map(), weekdayNames = ['','周一','周二','周三','周四'];
  let generation = 0, user = null, selectedWeekday = 1, selectedCampus = '', saving = false;
  const keyOf = item => `${item.campus}/${item.weekday}/${item.timeSlot}`;
  const dirty = row => row.input.value !== String(row.item.capacity);
  const dayRows = () => [...rows.values()].filter(row => row.item.campus === selectedCampus && row.item.weekday === selectedWeekday);

  function render() {
    const allowed = CAMPUSES.filter(campus => [...rows.values()].some(row => row.item.campus === campus));
    if (!allowed.includes(selectedCampus)) selectedCampus = allowed[0] || '';
    const pending = [...rows.values()].filter(dirty);
    for (const row of rows.values()) {
      row.form.hidden = row.item.weekday !== selectedWeekday;
      row.form.classList.toggle('is-dirty', dirty(row));
      row.note.textContent = dirty(row) ? '未保存' : row.item.capacity === 0 ? '暂停预约' : `最多 ${row.item.capacity} 人`;
    }
    for (const group of root.children) group.hidden = group.dataset.campus !== selectedCampus;
    const campusMarkup = allowed.map(campus => `<button type="button" class="secondary-btn" data-capacity-campus="${campus}" aria-pressed="${campus === selectedCampus}">${campus}校区</button>`).join('');
    if (campuses.innerHTML !== campusMarkup) campuses.innerHTML = campusMarkup;
    for (const button of weekdays.children) {
      const weekday = Number(button.dataset.weekday);
      const count = pending.filter(row => row.item.campus === selectedCampus && row.item.weekday === weekday).length;
      button.textContent = `${weekdayNames[weekday]}${count ? ' · ' + count : ''}`;
      button.setAttribute('aria-pressed', String(weekday === selectedWeekday));
    }
    const targets = allowed.filter(campus => campus !== selectedCampus);
    const targetMarkup = targets.map(campus => `<option>${campus}</option>`).join('');
    if (copyTarget.innerHTML !== targetMarkup) copyTarget.innerHTML = targetMarkup;
    copyTarget.disabled = copyCampus.disabled = saving || !targets.length;
    draft.textContent = pending.length ? `${pending.length} 项修改待保存（包含其他校区和星期）` : '所有配置已保存';
    save.disabled = saving || !pending.length;
    save.textContent = saving ? '正在保存…' : '保存全部修改';
  }
  function applyItem(row, item) {
    row.item = item; row.input.value = String(item.capacity); row.input.setCustomValidity('');
  }
  function valid(row) {
    const capacity = row.input.valueAsNumber;
    if (Number.isSafeInteger(capacity) && capacity >= 0) { row.input.setCustomValidity(''); return true; }
    selectedCampus = row.item.campus; selectedWeekday = row.item.weekday; render();
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
      showToast(`已保存 ${result.items.length} 项人数配置`);
    } catch (error) {
      if (current !== generation) return;
      state.textContent = error.message; showToast(error.message);
    } finally { if (current === generation) busy(false); }
  }
  function createRow(item, group) {
    const form = document.createElement('div'); form.className = 'capacity-row';
    form.dataset.campus = item.campus; form.dataset.timeSlot = item.timeSlot; form.dataset.weekday = String(item.weekday);
    form.innerHTML = `<label>${escapeHtml(item.timeSlot)}<input type="number" min="0" max="9007199254740991" step="1" required aria-label="${escapeHtml(item.campus)} ${weekdayNames[item.weekday]} ${escapeHtml(item.timeSlot)} 预约人数" /></label><p></p>`;
    const row = { form, input: form.querySelector('input'), note: form.querySelector('p') };
    rows.set(keyOf(item), row); group.append(form); applyItem(row, item);
    row.input.addEventListener('input', () => { row.input.setCustomValidity(''); render(); });
    row.input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void saveAll(); } });
  }
  campuses.addEventListener('click', event => {
    const button = event.target.closest('[data-capacity-campus]');
    if (button) { selectedCampus = button.dataset.capacityCampus; render(); }
  });
  weekdays.addEventListener('click', event => {
    const button = event.target.closest('[data-weekday]');
    if (button) { selectedWeekday = Number(button.dataset.weekday); render(); }
  });
  $('#capacity-bulk-form').addEventListener('submit', event => {
    event.preventDefault();
    const input = $('#capacity-bulk-value'), capacity = input.valueAsNumber;
    if (!Number.isSafeInteger(capacity) || capacity < 0) { input.setCustomValidity('请输入非负整数人数'); input.reportValidity(); return; }
    input.setCustomValidity('');
    const wholeWeek = $('#capacity-bulk-scope').value === 'week';
    for (const row of rows.values()) if (row.item.campus === selectedCampus && (wholeWeek || row.item.weekday === selectedWeekday)) {
      row.input.value = String(capacity); row.input.setCustomValidity('');
    }
    render();
  });
  $('#capacity-bulk-value').addEventListener('input', event => event.target.setCustomValidity(''));
  function copyDay(campus, wholeWeek) {
    const source = dayRows();
    if (!source.length || source.some(row => !valid(row))) return;
    for (const row of rows.values()) if (row.item.campus === campus && (wholeWeek || row.item.weekday === selectedWeekday)) {
      row.input.value = source.find(item => item.item.timeSlot === row.item.timeSlot).input.value;
      row.input.setCustomValidity('');
    }
    render();
  }
  $('#capacity-copy-week').addEventListener('click', () => copyDay(selectedCampus, true));
  copyCampus.addEventListener('click', () => copyDay(copyTarget.value, false));
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
          const heading = document.createElement('h3'); heading.textContent = `${campus}校区`; group.append(heading); root.append(group);
        }
        for (const weekday of [1,2,3,4]) for (const timeSlot of TIME_SLOTS) {
          const item = campusItems.find(entry => entry.weekday === weekday && entry.timeSlot === timeSlot);
          if (!item) continue;
          const row = rows.get(keyOf(item));
          if (!row) createRow(item, group);
          else if (discard || !dirty(row) && document.activeElement !== row.input) applyItem(row, item);
        }
      }
      render(); state.textContent = items.length ? '' : '当前账号没有可配置的授权校区';
    } catch (error) {
      if (current !== generation) return;
      state.textContent = '配置读取失败，请重新读取'; showToast(error.message);
    }
  }
  function clear() {
    generation++; user = null; saving = false; selectedCampus = '';
    rows.clear(); root.replaceChildren(); campuses.replaceChildren();
    state.textContent = ''; busy(false); panel.hidden = true;
  }
  reload.addEventListener('click', () => refresh(user, { discard: true }));
  return { refresh, clear };
}
