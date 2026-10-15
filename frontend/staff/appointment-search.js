import { $ } from '/shared/utils.js';
import { apiJson } from '/shared/api.js';
import { statusLabels, statusClass } from '/shared/constants.js';
import { parseAppointmentSearch, APPOINTMENT_SEARCH_LIMIT, APPOINTMENT_SEARCH_MIN_DIGITS } from '/shared/appointment-search.js';

export function initAppointmentSearch({ isActive, onSelect }) {
  $('#scan-search-help').textContent = `输入至少 ${APPOINTMENT_SEARCH_MIN_DIGITS} 位尾号查当天；输入含 - 的编号片段（如 1015-01）查所有可见日期。`;
  let suggestionTimer, suggestionGeneration = 0, suggestionRequest;
  const suggestionBox = $('#scan-number-suggestions'), suggestionMessage = $('#scan-number-message');
  function clearSuggestions() {
    clearTimeout(suggestionTimer); suggestionGeneration++; suggestionRequest?.abort();
    suggestionBox.hidden = true; suggestionBox.replaceChildren(); suggestionMessage.textContent = '';
  }
  function searchSuggestions() {
    clearSuggestions();
    const input = $('#scan-number'), query = parseAppointmentSearch(input.value);
    if (!query?.ready) return;
    const { text: raw, acrossDates } = query;
    const scopeLabel = acrossDates ? '可见预约' : '当天预约';
    const current = suggestionGeneration;
    suggestionTimer = setTimeout(async () => {
      suggestionRequest = new AbortController();
      suggestionMessage.textContent = `正在查找${scopeLabel}…`;
      try {
        const { items, hasMore } = await apiJson('/api/scan/search', { method: 'POST', json: { q: raw }, signal: suggestionRequest.signal });
        if (current !== suggestionGeneration || !isActive() || $('#scan-manual-form').hidden) return;
        suggestionBox.replaceChildren(...items.map(item => {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'scan-number-suggestion';
          const number = document.createElement('strong'), detail = document.createElement('span'), state = document.createElement('em');
          number.textContent = item.id; detail.textContent = `${item.campus} · ${acrossDates ? item.date + ' · ' : ''}${item.timeSlot}`; state.textContent = statusLabels[item.status] || item.status;
          state.className = `status-pill ${statusClass[item.status] || ''}`;
          button.append(number, detail, state);
          button.addEventListener('click', () => { input.value = item.id; clearSuggestions(); onSelect(item.id); });
          button.addEventListener('keydown', event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault(); (event.key === 'ArrowDown' ? button.nextElementSibling : button.previousElementSibling)?.focus();
            }
          });
          return button;
        }));
        suggestionBox.hidden = !items.length;
        suggestionMessage.textContent = hasMore ? `显示前 ${APPOINTMENT_SEARCH_LIMIT} 条，请继续输入以缩小范围` : items.length ? `找到 ${items.length} 条${scopeLabel}，选择即可打开` : `没有匹配的${scopeLabel}；可输入含 - 的编号片段扩大日期范围`;
      } catch (error) {
        if (current === suggestionGeneration && error.name !== 'AbortError') suggestionMessage.textContent = '搜索失败，请继续输入重试，或填写完整编号查询';
      }
    }, 300);
  }
  $('#scan-number').addEventListener('input', searchSuggestions);
  $('#scan-number').addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' && !suggestionBox.hidden) { event.preventDefault(); suggestionBox.firstElementChild?.focus(); }
  });
  $('#scan-manual-form').addEventListener('keydown', event => {
    if (event.key === 'Escape') { clearSuggestions(); $('#scan-number').focus(); }
  });
  return { clear: clearSuggestions };
}
