import { $, escapeHtml, showToast } from '/shared/utils.js';
import { apiJson } from '/shared/api.js';

export function initRepairLocationSettings() {
  const panel = $('#repair-location-settings'), fields = $('#repair-location-fields'), state = $('#repair-location-load-state');
  const rows = new Map();
  let generation = 0, saving = false;
  async function save(row) {
    if (saving) return;
    const current = ++generation;
    saving = true; state.textContent = '';
    for (const control of fields.querySelectorAll('input,button')) control.disabled = true;
    try {
      const item = await apiJson('/api/repair-locations',{ method:'PATCH',json:{...row.item,location:row.input.value.trim()} });
      if (current !== generation) return;
      row.item = item; row.input.value = item.location; row.status.textContent = '已保存';
      showToast('维修地点已更新，用户将看到最新地点');
    } catch (error) { if (current === generation) { row.status.textContent = error.message; showToast(error.message); } }
    finally {
      if (current === generation) { saving = false; for (const control of fields.querySelectorAll('input,button')) control.disabled = false; }
    }
  }
  function create(item) {
    const form = document.createElement('form'); form.className = 'repair-location-form'; form.dataset.locationCampus = item.campus;
    form.innerHTML = `<label><span>${escapeHtml(item.campus)}校区</span><input type="text" maxlength="200" autocomplete="off" aria-label="${escapeHtml(item.campus)}校区维修地点" placeholder="例如：教学楼名称 · 楼层 · 房间号" /></label><button type="submit" class="secondary-btn">保存地点</button><p class="repair-location-form-state" role="status"></p>`;
    const row = { item,form,input:form.querySelector('input'),status:form.querySelector('p') };
    row.input.value = item.location;
    row.input.addEventListener('input',() => { row.status.textContent = row.input.value === row.item.location ? '' : '未保存'; });
    form.addEventListener('submit',event => { event.preventDefault(); if (form.checkValidity()) void save(row); });
    rows.set(item.campus,row); fields.append(form);
  }
  async function refresh(user) {
    if (user.role !== 'superadmin') { clear(); return; }
    panel.hidden = false;
    if (saving) return;
    const current = ++generation;
    try {
      const { items } = await apiJson('/api/repair-locations');
      if (current !== generation) return;
      const allowed = items.filter(item => user.authorizedCampuses.includes(item.campus));
      for (const [campus,row] of rows) if (!allowed.some(item => item.campus === campus)) { row.form.remove(); rows.delete(campus); }
      for (const item of allowed) {
        const row = rows.get(item.campus);
        if (!row) create(item);
        else if (row.input.value === row.item.location && document.activeElement !== row.input) { row.item = item; row.input.value = item.location; row.status.textContent = ''; }
      }
      state.textContent = '';
    } catch (error) { if (current === generation) state.textContent = error.message; }
  }
  function clear() { generation++; saving = false; rows.clear(); fields.replaceChildren(); state.textContent = ''; panel.hidden = true; }
  $('#reload-repair-locations').addEventListener('click',() => {
    if (saving) return;
    // Reset only this section; the settings page's next refresh fetches the latest values.
    for (const row of rows.values()) { row.input.value = row.item.location; row.status.textContent = ''; }
    apiJson('/api/auth/me').then(refresh).catch(error => { state.textContent = error.message; });
  });
  return { refresh, clear };
}
