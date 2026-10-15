import { $, escapeHtml, assigneeLabel } from '/shared/utils.js';
import { apiJson } from '/shared/api.js';

export function initAssigneePicker() {
  const root = $('#correction-assignee-picker'), input = $('#correction-assigned');
  const list = $('#correction-assignee-options'), state = $('#correction-assignee-state');
  const clear = $('#clear-correction-assignee'), retry = $('#retry-correction-assignees');
  let item, selected, candidates = [], matches = [], generation = 0;
  let loading = false, loaded = false, error = '', expanded = false, active = -1, query = '';
  const label = person => person ? assigneeLabel(person.account, person.name) : '';

  function render() {
    const search = query.trim().toLowerCase();
    matches = candidates.filter(person => person.account.toLowerCase().includes(search) || (person.name || '').toLowerCase().includes(search));
    if (active >= matches.length) active = -1;
    list.innerHTML = matches.map((person, index) => `<button type="button" role="option" tabindex="-1" id="correction-assignee-option-${index}" data-assignee-index="${index}" aria-selected="${person.account === selected?.account}" class="${index === active ? 'is-active' : ''}">${escapeHtml(label(person))}</button>`).join('');
    list.hidden = !expanded || !matches.length;
    input.setAttribute('aria-expanded', String(!list.hidden));
    if (!list.hidden && active >= 0) input.setAttribute('aria-activedescendant', `correction-assignee-option-${active}`);
    else input.removeAttribute('aria-activedescendant');
    clear.disabled = !selected && !input.value;
    retry.hidden = !error;
    let message = '按姓名或学号搜索，并从列表中选择。';
    if (loading) message = '正在读取可选人员…';
    else if (error) message = `可选人员读取失败：${error}。可重试，当前关联已保留。`;
    else if (loaded && !candidates.length) message = '该校区暂无可选人员。';
    else if (expanded && query && !matches.length) message = '未找到匹配的工作人员。';
    else if (loaded && selected && !candidates.some(person => person.account === selected.account)) message = '当前关联不在可选人员中，可保留历史关联或重新选择。';
    state.textContent = message + (selected ? ` 当前选择：${label(selected)}` : '');
  }
  function close() {
    expanded = false; active = -1; query = ''; input.value = label(selected); render();
  }
  async function load() {
    if (!item || loaded || loading) return;
    const current = ++generation, previousLabel = label(selected);
    loading = true; error = ''; render();
    try {
      const result = await apiJson(`/api/staff/assignees?${new URLSearchParams({ campus: item.campus })}`);
      if (current !== generation) return;
      candidates = result.items; loaded = true;
      selected = candidates.find(person => person.account === selected?.account) || selected;
      if (input.value === previousLabel) input.value = label(selected);
    } catch (failure) {
      if (current === generation) error = failure.message;
    } finally {
      if (current === generation) { loading = false; render(); }
    }
  }
  function open() {
    expanded = true; active = -1;
    query = input.value === label(selected) ? '' : input.value;
    render(); load();
  }
  function choose(index) {
    if (!matches[index]) return;
    selected = matches[index];
    input.focus({ preventScroll: true }); close();
  }
  input.addEventListener('focus', open);
  input.addEventListener('click', () => { if (!expanded) open(); });
  input.addEventListener('blur', event => { if (!list.contains(event.relatedTarget)) close(); });
  input.addEventListener('input', () => { query = input.value; expanded = true; active = -1; render(); load(); });
  input.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      if (!expanded) open();
      if (matches.length) {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        active = active < 0 ? step > 0 ? 0 : matches.length - 1 : (active + step + matches.length) % matches.length;
        render(); document.getElementById(`correction-assignee-option-${active}`).scrollIntoView({ block: 'nearest' });
      }
    } else if (expanded && matches.length && ['Home', 'End'].includes(event.key)) {
      event.preventDefault(); active = event.key === 'Home' ? 0 : matches.length - 1;
      render(); document.getElementById(`correction-assignee-option-${active}`).scrollIntoView({ block: 'nearest' });
    } else if (expanded && event.key === 'Enter' && active >= 0) {
      event.preventDefault(); choose(active);
    } else if (expanded && event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); close();
    }
  });
  // Keep mouse focus on the combobox; touch users can still scroll the list.
  list.addEventListener('mousedown', event => event.preventDefault());
  list.addEventListener('click', event => {
    const option = event.target.closest('[data-assignee-index]');
    if (option) choose(Number(option.dataset.assigneeIndex));
  });
  clear.addEventListener('click', () => { selected = undefined; input.value = ''; input.focus({ preventScroll: true }); open(); });
  retry.addEventListener('click', () => load());
  root.addEventListener('focusout', event => { if (!root.contains(event.relatedTarget)) close(); });
  document.addEventListener('click', event => { if (!root.contains(event.target)) close(); });
  $('#correction-panel').addEventListener('toggle', () => { if ($('#correction-panel').open) load(); else close(); });
  return {
    reset(current) {
      generation++; item = current;
      selected = current?.assignedTo ? { account: current.assignedTo, name: current.assignedToName || '' } : undefined;
      candidates = []; loading = loaded = false; error = ''; close();
    },
    value() { return selected?.account || ''; }
  };
}
