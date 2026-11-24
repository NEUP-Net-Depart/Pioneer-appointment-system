import { useEffect, useLayoutEffect, useRef } from 'react';
import { startVisiblePolling } from '../../shared/polling.js';
import { CAMPUSES, TIME_SLOTS } from '../../shared/constants.js';
import { bookingDates, slotAvailability } from '../../shared/booking-slots.js';
import { DEFAULT_RELEASE_TIME } from '../../shared/booking-settings.js';
import { studentJson } from './api';
import { reveal, useLayoutMotion } from './motion';
import { useCurrent } from './use-current';
import type { Notice, SlotSelection, SlotSummary } from './types';

type Summary = {
  date: string;
  location: string;
  paused?: boolean;
  pauseReason?: string;
  slots: Record<string, number>;
  slotCapacities: Record<string, number>;
  timeSlots?: string[];
};
type Settings = { releaseTime: string; notices?: Notice[] };
type AvailabilityResponse = { serverNow: string; bookingSettings?: Settings; items: Summary[] };
const emptySelection = { campus: '', date: '', timeSlot: '' };

export function useAvailability(onChange: (selection: SlotSelection, issue: string) => void) {
  const [, redraw] = useCurrent(0);
  const model = useRef({
    selection: emptySelection,
    summaries: new Map<string, Summary>(),
    failed: new Set<string>(),
    loading: false,
    loadFailed: false,
    offset: 0,
    notice: '',
    issue: '',
    generation: 0,
    active: true
  }).current;
  const caches = useRef(new Map<string, Map<string, Summary>>()).current;
  const settingsByCampus = useRef(new Map<string, Settings>()).current;
  const callback = useRef(onChange);
  useLayoutEffect(() => {
    callback.current = onChange;
  });
  const root = useRef<HTMLElement>(null);
  const measure = useLayoutMotion(root);
  const campusButtons = useRef<HTMLDivElement>(null);
  const slotButtons = useRef<HTMLDivElement>(null);
  const shown = useRef({ calendar: false, slots: false });
  const revision = useRef(0);
  const request = useRef<AbortController | null>(null);
  const settings = () => settingsByCampus.get(model.selection.campus);
  const now = () => new Date(Date.now() + model.offset);
  const datesNow = () => bookingDates(now(), settings()?.releaseTime || DEFAULT_RELEASE_TIME);
  const availability = (date: string, slot: string) => {
    const summary = model.summaries.get(date);
    return summary && slotAvailability(summary, date, slot, now());
  };
  const selectable = (date: string) =>
    !model.failed.has(date) &&
    TIME_SLOTS.some((slot) => availability(date, slot)?.disabled === false);

  function dateStatus(date: string): { kind: string; label?: string; remaining?: number } {
    const summary = model.summaries.get(date);
    if (model.failed.has(date)) return { kind: 'error', label: '读取失败' };
    if (!summary) return { kind: 'loading', label: '读取中' };
    if (summary.paused) return { kind: 'paused', label: '暂停维修' };
    if (!summary.location) return { kind: 'missing', label: '地点未配置' };
    const available = TIME_SLOTS.map((slot) => availability(date, slot)).filter(
      (state) => state && !state.ended
    );
    if (!available.length) return { kind: 'ended', label: '时段已结束' };
    if (available.every((state) => state?.capacity === 0))
      return { kind: 'unopened', label: '未开放名额' };
    const remaining = available.reduce((sum, state) => sum + (state?.remaining || 0), 0);
    return remaining ? { kind: 'open', remaining } : { kind: 'full', label: '预约已满' };
  }
  function value(): SlotSummary {
    return {
      ...model.selection,
      location: model.summaries.get(model.selection.date)?.location || ''
    };
  }
  function changed() {
    callback.current(model.selection, model.issue);
  }
  function publish() {
    const dates = datesNow();
    for (const cache of caches.values())
      for (const date of cache.keys()) if (!dates.includes(date)) cache.delete(date);
    const selection = model.selection;
    const next = {
      calendar: !!selection.campus,
      slots: !!selection.date && model.summaries.has(selection.date)
    };
    if (next.calendar !== shown.current.calendar || next.slots !== shown.current.slots)
      measure({ resize: true });
    if (selection.date && !dates.includes(selection.date)) {
      model.selection = { ...selection, date: '', timeSlot: '' };
      model.issue = model.notice = '原日期已不在预约范围内，请重新选择。';
    }
    const state = availability(model.selection.date, model.selection.timeSlot);
    if (model.selection.timeSlot && !model.failed.has(model.selection.date) && state?.disabled) {
      model.issue = model.notice = state.label + '，请重新选择时段。';
      model.selection = { ...model.selection, timeSlot: '' };
      changed();
    }
    redraw(++revision.current);
  }
  async function refresh({ telemetryPoll = false } = {}) {
    const campus = model.selection.campus;
    if (!campus) {
      publish();
      return true;
    }
    const current = ++model.generation;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    model.loading = true;
    publish();
    let result: AvailabilityResponse;
    try {
      result = await studentJson<AvailabilityResponse>(
        '/api/booking-availability?' + new URLSearchParams({ campus }),
        { telemetryPoll, signal: controller.signal }
      );
    } catch {
      if (current !== model.generation) return false;
      model.loading = false;
      model.loadFailed = true;
      model.failed = new Set(datesNow());
      publish();
      return false;
    } finally {
      if (request.current === controller) request.current = null;
    }
    if (current !== model.generation) return false;
    model.loading = false;
    model.loadFailed = false;
    model.failed = new Set();
    model.offset = Date.parse(result.serverNow) - Date.now();
    if (result.bookingSettings) settingsByCampus.set(campus, result.bookingSettings);
    const dates = datesNow();
    model.summaries = new Map(result.items.map((summary) => [summary.date, summary]));
    caches.set(campus, model.summaries);
    if (!model.selection.date || !dates.includes(model.selection.date)) {
      if (model.selection.date) model.issue = model.notice = '原日期已不在预约范围内，请重新选择。';
      model.selection = {
        ...model.selection,
        date: dates.find(selectable) || dates[0] || '',
        timeSlot: ''
      };
    }
    publish();
    changed();
    return !model.failed.size;
  }

  useEffect(() => {
    const stop = startVisiblePolling((options: { telemetryPoll: boolean }) =>
      model.active && !model.loading ? refresh(options) : undefined
    );
    return () => {
      stop();
      model.generation++;
      request.current?.abort();
      model.loading = false;
    };
  }, []);

  const selection = model.selection,
    selected = model.summaries.get(selection.date);
  const showSlots = !!selection.date && !!selected;
  useLayoutEffect(() => {
    if (showSlots && !shown.current.slots)
      [...(slotButtons.current?.children || [])].forEach((item, index) =>
        reveal(item, { delay: index * 30, distance: 6 })
      );
    shown.current = { calendar: !!selection.campus, slots: showSlots };
  }, [selection.campus, showSlots]);
  return {
    root,
    campusButtons,
    slotButtons,
    selection,
    selected,
    showSlots,
    dates: datesNow(),
    dateStatus,
    availability,
    notices: settings()?.notices || [],
    loading: model.loading,
    loadFailed: model.loadFailed,
    failed: model.failed,
    feedback:
      model.notice ||
      (model.loadFailed || model.failed.size
        ? '暂时无法更新名额，请重试。'
        : model.loading && !model.summaries.size && !selection.date
          ? '正在读取可预约日期…'
          : ''),
    blocked: !!selection.date && !selectable(selection.date),
    refresh,
    value,
    issue: () => model.issue,
    currentNotices: () => settings()?.notices || [],
    selectCampus(campus: string) {
      if (model.selection.campus !== campus) {
        model.selection = { ...model.selection, campus, timeSlot: '' };
        model.summaries = caches.get(campus) || new Map();
        model.failed = new Set();
        model.loadFailed = false;
        model.issue = model.notice = '';
        changed();
      }
      void refresh();
    },
    selectDate(date: string) {
      model.selection = {
        ...model.selection,
        date,
        timeSlot: date === model.selection.date ? model.selection.timeSlot : ''
      };
      model.notice = '';
      publish();
      changed();
    },
    selectSlot(timeSlot: string) {
      model.selection = { ...model.selection, timeSlot };
      model.issue = model.notice = '';
      publish();
      changed();
    },
    validate() {
      publish();
      const { campus, date, timeSlot } = model.selection;
      const valid = !!(
        campus &&
        date &&
        timeSlot &&
        selectable(date) &&
        !availability(date, timeSlot)?.disabled
      );
      if (!valid) {
        model.notice ||= '请选择可预约的校区、日期和到场时段。';
        publish();
        (
          campusButtons.current?.querySelector<HTMLButtonElement>('button[aria-pressed=true]') ||
          campusButtons.current?.querySelector('button')
        )?.focus();
      }
      return valid;
    },
    async recover(message: string) {
      model.selection = { ...model.selection, timeSlot: '' };
      model.notice = message;
      await refresh();
      publish();
    },
    async restore(values: Partial<SlotSelection>) {
      model.selection = {
        campus: CAMPUSES.includes(values.campus || '') ? values.campus || '' : '',
        date: values.date || '',
        timeSlot: values.timeSlot || ''
      };
      model.summaries = new Map();
      await refresh();
      publish();
    },
    reset() {
      model.generation++;
      request.current?.abort();
      model.loading = false;
      model.selection = emptySelection;
      model.summaries = new Map();
      caches.clear();
      model.failed = new Set();
      model.loadFailed = false;
      model.issue = model.notice = '';
      publish();
    },
    setActive(active: boolean) {
      model.active = active;
      if (active) void refresh();
    }
  };
}

export type Availability = ReturnType<typeof useAvailability>;
