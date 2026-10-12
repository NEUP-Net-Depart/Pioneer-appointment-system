import { $ } from '/shared/utils.js';
import { apiJson } from '/shared/api.js';
import { startVisiblePolling } from '/shared/polling.js';
import { CAMPUSES, TIME_SLOTS } from '/shared/constants.js';
import { timeLabel } from '/shared/time.js';
import { availableSlots, bookingDates, slotAvailability } from '/shared/booking-slots.js';
import { initBookingFloat } from './booking-float.js';

const weekday = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', weekday: 'short' });
const dayLabel = date => `${weekday.format(new Date(`${date}T12:00:00+08:00`))} · ${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;

function updateCount(count, remaining) {
  const value = String(remaining ?? 0), previous = count.dataset.value || '0';
  if (count.dataset.value === value) return;
  count.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
  count.dataset.value = value;
  if (remaining === undefined || matchMedia('(prefers-reduced-motion: reduce)').matches || previous === value) {
    count.textContent = value; return;
  }
  // Expose the real count immediately; decorative reels never affect validation.
  const accessible = document.createElement('span'); accessible.className = 'booking-count-value'; accessible.textContent = value;
  const reel = document.createElement('span'); reel.className = 'booking-count-reel'; reel.setAttribute('aria-hidden', 'true');
  const oldDigits = previous.padStart(value.length, '0').slice(-value.length);
  for (const [index, digit] of [...value].entries()) {
    const column = document.createElement('span'); column.className = 'booking-count-column';
    const track = document.createElement('span'); track.className = 'booking-count-track';
    const start = Number(oldDigits[index]), target = Number(digit), end = target + (target <= start ? 10 : 0);
    for (let step = 0; step <= end; step++) {
      const cell = document.createElement('span'); cell.className = 'booking-count-digit'; cell.dataset.digit = String(step % 10); track.append(cell);
    }
    track.style.transform = `translateY(-${end}em)`;
    column.append(track); reel.append(column);
    if (start !== target) track.animate([
      { transform: `translateY(-${start}em)` }, { transform: `translateY(-${end}em)` }
    ], { duration: 380 + index * 25, easing: 'cubic-bezier(.18,.7,.25,1)' });
  }
  count.replaceChildren(accessible, reel);
}

function choiceButton(value, attribute, title) {
  const button = document.createElement('button');
  button.type = 'button'; button.dataset[attribute] = value;
  button.className = 'booking-choice'; button.setAttribute('aria-pressed', 'false');
  const heading = document.createElement('strong'); heading.textContent = title;
  if (attribute === 'date') {
    const [weekday, date] = title.split(' · ');
    const weekdayLabel = document.createElement('span'); weekdayLabel.className = 'booking-weekday'; weekdayLabel.textContent = weekday;
    const separator = document.createElement('span'); separator.className = 'booking-date-separator'; separator.textContent = ' · ';
    const dateLabel = document.createElement('span'); dateLabel.className = 'booking-date-number'; dateLabel.textContent = date;
    heading.replaceChildren(weekdayLabel, separator, dateLabel);
  }
  const detail = document.createElement('small');
  if (attribute !== 'campus') {
    const remaining = document.createElement('span'); remaining.className = 'booking-remaining';
    const count = document.createElement('span'); count.className = 'booking-remaining-count'; count.textContent = '0'; count.dataset.value = '0';
    remaining.append('剩余 ', count, ' 名'); detail.append(remaining);
    if (attribute === 'slot') {
      const capacity = document.createElement('span'); capacity.className = 'booking-slot-limit'; capacity.textContent = '最多 - 人';
      detail.append(capacity);
    }
  }
  button.append(heading, detail);
  return button;
}

export function initSlotPicker() {
  const campusInput = $('[name="campus"]'), dateInput = $('[name="date"]'), slotInput = $('[name="timeSlot"]');
  const campusButtons = $('#booking-campuses'), days = $('#booking-days'), slots = $('#booking-slots');
  const status = $('#booking-selection'), updated = $('#booking-updated'), retry = $('#booking-retry');
  const floating = initBookingFloat($('#booking-picker'));
  let generation = 0, summaries = new Map(), dates = [], notice = '', disposed = false, refreshing = false;
  let selectionIssue = '';
  campusInput.value = CAMPUSES[0];
  const campusSummaries = new Map([[campusInput.value, summaries]]), campusUpdated = new Map();

  function selected(button, value) {
    button.setAttribute('aria-pressed', String(button.dataset.campus === value || button.dataset.date === value || button.dataset.slot === value));
  }
  function showRemaining(button, remaining, label) {
    const detail = button.querySelector('.booking-remaining');
    let count = detail.querySelector('.booking-remaining-count');
    if (label) {
      count?.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
      if (detail.textContent !== label) detail.textContent = label;
    } else {
      if (!count) {
        count = document.createElement('span'); count.className = 'booking-remaining-count';
        detail.replaceChildren('剩余 ', count, ' 名');
      }
      updateCount(count, remaining);
    }
  }
  function render() {
    $('#booking-picker').setAttribute('aria-busy', String(refreshing));
    const currentDates = bookingDates();
    for (const cache of campusSummaries.values()) for (const date of cache.keys()) if (!currentDates.includes(date)) cache.delete(date);
    if (dates.join() !== currentDates.join()) {
      dates = currentDates;
      days.replaceChildren(...dates.map(date => choiceButton(date, 'date', dayLabel(date))));
    }
    days.dataset.count = String(dates.length);
    days.style.setProperty('--booking-day-count', String(Math.max(1, dates.length)));
    const reservedSlots = Math.max(1, ...dates.map(date => availableSlots(date).length));
    $('.booking-picker-body').style.setProperty('--booking-slot-count', String(reservedSlots));
    if (!dates.includes(dateInput.value)) {
      if (slotInput.value) selectionIssue = notice = '时段已过期，请重新选择';
      dateInput.value = ''; slotInput.value = '';
    }
    for (const button of campusButtons.children) selected(button, campusInput.value);
    for (const button of days.children) {
      const date = button.dataset.date, summary = summaries.get(date);
      selected(button, dateInput.value);
      const remaining = summary ? availableSlots(date).reduce((total, slot) => total + slotAvailability(summary, date, slot).remaining, 0) : 0;
      button.disabled = !summary || remaining === 0;
      button.dataset.loading = String(refreshing && (!summary || remaining > 0));
      showRemaining(button, summary ? remaining : undefined, summary && remaining === 0 ? availableSlots(date).every(slot => summary.slotCapacities[slot] === 0) ? '暂停预约' : '预约已满' : summary === null ? '读取失败' : undefined);
    }
    $('#booking-empty').hidden = dates.length > 0;
    $('#booking-slot-panel').hidden = !dateInput.value;
    const summary = summaries.get(dateInput.value);
    if (slotInput.value && (!summary || slotAvailability(summary, dateInput.value, slotInput.value).disabled)) {
      selectionIssue = notice = summary ? `${slotAvailability(summary, dateInput.value, slotInput.value).label}，请重新选择` : '名额读取失败，请重试';
      slotInput.value = '';
    }
    $('#booking-slot-title').textContent = dateInput.value ? `${campusInput.value} · ${dayLabel(dateInput.value)}，请选择时段` : '';
    for (const button of slots.children) {
      const slot = button.dataset.slot;
      button.hidden = !dateInput.value || !availableSlots(dateInput.value).includes(slot);
      const availability = summary && slotAvailability(summary, dateInput.value, slot);
      button.disabled = !availability || availability.disabled;
      button.dataset.loading = String(refreshing && (!availability || !availability.disabled));
      showRemaining(button, availability?.remaining, availability?.disabled ? availability.label : summary === null ? '读取失败' : undefined);
      const capacity = button.querySelector('.booking-slot-limit');
      const capacityLabel = `最多 ${availability?.capacity ?? '-'} 人`;
      if (capacity.textContent !== capacityLabel) capacity.textContent = capacityLabel;
      selected(button, slotInput.value);
    }
    slots.dataset.count = String([...slots.children].filter(button => !button.hidden).length);
    status.textContent = slotInput.value ? `已选：${campusInput.value} · ${dayLabel(dateInput.value)} · ${slotInput.value}` : notice || (dateInput.value ? '请选择可预约时段。' : '先选日期，再选时段。');
    floating.update(campusInput.value, dateInput.value ? dayLabel(dateInput.value) : '', slotInput.value, selectionIssue);
  }
  async function refresh({ date } = {}) {
    if (disposed) return false;
    const requestGeneration = ++generation, campus = campusInput.value;
    const requestedDates = date && bookingDates().includes(date) ? [date] : bookingDates();
    refreshing = true; retry.disabled = true;
    render();
    const results = await Promise.allSettled(requestedDates.map(date => apiJson(`/api/live/summary?${new URLSearchParams({ campus, date })}`)));
    if (disposed || requestGeneration !== generation) return false;
    for (const [index, date] of requestedDates.entries()) summaries.set(date, results[index].status === 'fulfilled' ? results[index].value : null);
    refreshing = false; retry.disabled = false;
    const failed = bookingDates().some(date => summaries.get(date) === null);
    retry.hidden = !failed;
    updated.textContent = failed ? '名额读取失败，可重试' : `更新于 ${timeLabel()}`;
    campusUpdated.set(campus, updated.textContent);
    render();
    return results.every(result => result.status === 'fulfilled');
  }
  function changeCampus(value) {
    if (!CAMPUSES.includes(value)) value = CAMPUSES[0];
    campusInput.value = value; slotInput.value = ''; notice = ''; selectionIssue = '';
    if (!campusSummaries.has(value)) campusSummaries.set(value, new Map());
    summaries = campusSummaries.get(value);
    updated.textContent = campusUpdated.get(value) || '更新于 --:--';
    retry.hidden = true;
    render(); void refresh();
  }
  for (const campus of CAMPUSES) {
    const button = choiceButton(campus, 'campus', `${campus}校区`);
    button.querySelector('small').remove(); campusButtons.append(button);
  }
  for (const slot of TIME_SLOTS) slots.append(choiceButton(slot, 'slot', slot));
  campusButtons.addEventListener('click', event => {
    const button = event.target.closest('[data-campus]');
    if (!button) return;
    if (button.dataset.campus !== campusInput.value) changeCampus(button.dataset.campus);
    else void refresh();
  });
  campusInput.addEventListener('change', () => changeCampus(campusInput.value));
  days.addEventListener('click', event => {
    const button = event.target.closest('[data-date]');
    if (!button || button.disabled) return;
    const changedDate = dateInput.value !== button.dataset.date;
    if (changedDate) { slotInput.value = ''; selectionIssue = ''; }
    dateInput.value = button.dataset.date; notice = ''; render();
    void refresh({ date: dateInput.value });
  });
  slots.addEventListener('click', event => {
    const button = event.target.closest('[data-slot]');
    if (!button || button.disabled) return;
    slotInput.value = button.dataset.slot; notice = ''; selectionIssue = '';
    render();
    void refresh({ date: dateInput.value });
  });
  retry.addEventListener('click', () => { void refresh(); });
  render();
  const stopPolling = startVisiblePolling(() => refreshing ? undefined : refresh());
  return {
    validate() {
      render();
      const summary = summaries.get(dateInput.value);
      const valid = bookingDates().includes(dateInput.value) && slotInput.value && summary && !slotAvailability(summary, dateInput.value, slotInput.value).disabled;
      if (!valid) {
        notice = '请先在上方选择可预约的日期和时段。'; render();
        const target = dateInput.value ? slots : days;
        (target.querySelector('button:not(:disabled):not([hidden])') || campusButtons.querySelector('button')).focus();
      }
      return Boolean(valid);
    },
    async recover(message) {
      slotInput.value = ''; selectionIssue = notice = `${message}，请重新选择时段。`;
      await refresh({ date: dateInput.value });
      const target = dateInput.value ? slots : days;
      (target.querySelector('button:not(:disabled):not([hidden])') || campusButtons.querySelector('button')).focus({ preventScroll: true });
    },
    dispose() {
      disposed = true; generation++;
      stopPolling();
      floating.dispose();
      $('#booking-picker').getAnimations({ subtree: true }).forEach(animation => animation.cancel());
      $('#booking-picker').hidden = true;
    }
  };
}
