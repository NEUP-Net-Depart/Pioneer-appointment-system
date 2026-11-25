import { useEffect, useRef, useState } from 'react';
import { startVisiblePolling } from '../../shared/polling.ts';
import { appointmentPath, failureFrom, readAppointment, studentJson, type Failure } from './api';
import {
  credentialHeaders,
  credentialStorageError,
  savedAppointments,
  saveAppointment
} from './credentials';
import type { Appointment, Credential } from './types';
import type { QrCache } from './RepairQr';
import { useCurrent } from './use-current';

const listFreshness = 60_000,
  detailFreshness = 30_000;

type RecordRow = {
  entry: Credential;
  item?: Appointment;
  message?: string;
  receivedAt?: number;
  checkedAt?: number;
};
const needsUpdate = (row: RecordRow, age: number) =>
  !row.checkedAt || Date.now() - row.checkedAt >= age;
const inaccessible = '此浏览器无法访问该预约，请联系工作人员查询。';

export function useLookup(onAlias: (id: string) => void, toast: (message: string) => void) {
  const records = useRef(new Map<string, RecordRow>()).current;
  const inFlight = useRef(new Map<string, Promise<Appointment>>()).current;
  const requests = useRef(new Set<AbortController>()).current;
  const qrImages = useRef<QrCache>(new Map()).current;
  const state = useRef({
    active: false,
    detailId: null as string | null,
    generation: 0,
    refreshing: false,
    cancelling: false
  }).current;
  const [detailId, setDetailId] = useState<string | null>(null);
  const [entries, setEntries] = useState<RecordRow[]>([]);
  const [detailError, setDetailError] = useState('');
  const [detailNotice, setDetailNotice] = useState('');
  const [cancelMessage, setCancelMessage] = useState('');
  const [cancelling, setCancelling] = useCurrent(false);
  const aliasHandler = useRef(onAlias);
  aliasHandler.current = onAlias;

  function readEntries() {
    for (const entry of savedAppointments()) {
      const previous = records.get(entry.id);
      if (previous?.entry.accessToken !== entry.accessToken) records.set(entry.id, { entry });
    }
  }

  function commit(item: Appointment) {
    const previous = records.get(item.id);
    if (previous?.item && previous.entry.accessToken === item.accessToken) {
      const revision = previous.item.revision - item.revision;
      const locationRevision =
        (previous.item.currentLocationRevision ?? -1) - (item.currentLocationRevision ?? -1);
      if (revision > 0 || (revision === 0 && locationRevision > 0)) return;
    }
    const now = Date.now();
    records.set(item.id, {
      entry: { id: item.id, accessToken: item.accessToken },
      item,
      message: '',
      receivedAt: now,
      checkedAt: now
    });
  }

  function updateFailure(row: RecordRow, failure: Failure) {
    records.set(row.entry.id, {
      ...row,
      checkedAt: Date.now(),
      message:
        failure.status === 404
          ? inaccessible
          : failure.status
            ? failure.message
            : '网络异常或请求超时，请重试。'
    });
  }

  function request(entry: Credential, options: { telemetryPoll?: boolean } = {}) {
    const key = entry.id + '/' + entry.accessToken;
    const pending = inFlight.get(key);
    if (pending) return pending;
    const controller = new AbortController();
    requests.add(controller);
    const task = readAppointment(entry, { ...options, signal: controller.signal }).finally(() => {
      requests.delete(controller);
      if (inFlight.get(key) === task) inFlight.delete(key);
    });
    inFlight.set(key, task);
    return task;
  }

  function publish() {
    setEntries([...records.values()]);
    const row = state.detailId ? records.get(state.detailId) : undefined;
    setDetailNotice(row?.message ? '暂时无法更新。' + row.message : '');
  }

  function setDetail(id: string | null) {
    state.detailId = id;
    setDetailId(id);
    setDetailError('');
    setCancelMessage('');
  }

  function alias(id: string, item: Appointment) {
    saveAppointment(item, id);
    records.delete(id);
    if (state.detailId === id) {
      setDetail(item.id);
      aliasHandler.current(item.id);
    }
  }

  async function refresh({
    force = false,
    onlyId,
    telemetryPoll
  }: { force?: boolean; onlyId?: string; telemetryPoll?: boolean } = {}) {
    if (state.refreshing || state.cancelling || !state.active) return;
    readEntries();
    const targetId = onlyId || state.detailId;
    const maxAge = state.detailId ? detailFreshness : listFreshness;
    const entries = [...records.values()]
      .filter(
        (row) => (!targetId || row.entry.id === targetId) && (force || needsUpdate(row, maxAge))
      )
      .map((row) => row.entry);
    if (!entries.length) return;
    state.refreshing = true;
    if (!state.detailId) publish();
    const current = ++state.generation;
    const results = await Promise.allSettled(
      entries.map((entry) => request(entry, { telemetryPoll }))
    );
    if (current !== state.generation) return;
    results.forEach((result, index) => {
      const entry = entries[index];
      const row = records.get(entry.id);
      if (row?.entry.accessToken !== entry.accessToken) return;
      if (result.status === 'rejected') {
        updateFailure(row, failureFrom(result.reason));
        return;
      }
      const item = result.value;
      if (item.id !== entry.id) {
        const known = records.get(item.id)?.item;
        if (!known || known.revision <= item.revision) alias(entry.id, item);
        else records.delete(entry.id);
      }
      commit(item);
      if (state.detailId === item.id) setDetailError('');
    });
    state.refreshing = false;
    publish();
  }

  async function showList() {
    state.generation++;
    state.refreshing = false;
    setDetail(null);
    readEntries();
    publish();
    await refresh();
  }

  async function showDetail(id: string, force = false) {
    const current = ++state.generation;
    state.refreshing = false;
    if (state.detailId !== id) setDetail(id);
    else setDetailError('');
    readEntries();
    publish();
    const row = records.get(id);
    if (!force && row?.item && !needsUpdate(row, detailFreshness)) return;
    state.refreshing = true;
    try {
      if (!row) throw new Error('此浏览器没有保存该预约记录。');
      const item = await request(row.entry);
      if (current !== state.generation || state.detailId !== id) return;
      if (item.id !== id) alias(id, item);
      commit(item);
      publish();
    } catch (value) {
      if (current !== state.generation) return;
      const failure = failureFrom(value);
      if (row) updateFailure(row, failure);
      if (!row?.item) setDetailError(failure.status === 404 ? inaccessible : failure.message);
      publish();
    } finally {
      if (current === state.generation) state.refreshing = false;
    }
  }

  async function cancel() {
    if (state.cancelling || !state.detailId) return;
    const id = state.detailId,
      item = records.get(id)?.item;
    if (!item) return;
    state.cancelling = true;
    setCancelling(true);
    state.generation++;
    state.refreshing = false;
    const controller = new AbortController();
    requests.add(controller);
    try {
      const result = await studentJson<Partial<Appointment>>(appointmentPath(id) + '/status', {
        method: 'PATCH',
        headers: credentialHeaders(item),
        json: { status: 'cancelled', revision: item.revision },
        signal: controller.signal
      });
      commit({ ...item, ...result });
    } catch {
      if (controller.signal.aborted) return;
      try {
        const actual = await request(item);
        commit(actual);
        if (actual.status === 'booked' && id === state.detailId)
          setCancelMessage('当前仍为已预约，可安全重试取消。');
      } catch {
        if (id === state.detailId)
          setCancelMessage('暂时无法确认取消结果。已保留最近状态，请重试查询后再操作。');
      }
    } finally {
      requests.delete(controller);
      state.cancelling = false;
      setCancelling(false);
      if (id === state.detailId && records.get(id)?.item?.status === 'cancelled')
        toast('预约已取消');
      publish();
    }
  }

  useEffect(() => {
    const stop = startVisiblePolling((options: { telemetryPoll: boolean }) =>
      state.active ? refresh(options) : undefined
    );
    return () => {
      stop();
      state.generation++;
      state.refreshing = false;
      for (const controller of requests) controller.abort();
      inFlight.clear();
      qrImages.clear();
    };
  }, []);

  const record = entries.find((row) => row.entry.id === detailId),
    item = record?.item;
  useEffect(() => {
    if (item?.status !== 'booked' || item.receivedAt || !item.expiresAt) return;
    const offset =
      item.serverNow && record?.receivedAt ? Date.parse(item.serverNow) - record.receivedAt : 0;
    const deadline = Date.parse(item.expiresAt) - (Date.now() + offset);
    if (!(deadline > 0 && deadline < 2147480000)) return;
    const timer = setTimeout(() => {
      if (state.active && !document.hidden) void refresh({ force: true });
    }, deadline + 1000);
    return () => clearTimeout(timer);
  }, [record, item]);

  const storageError = credentialStorageError();
  return {
    entries,
    item,
    detailId,
    detailError,
    detailNotice,
    setDetailNotice,
    cancelMessage,
    cancelling,
    storageError,
    showList,
    showDetail,
    refresh,
    cancel,
    qrImages,
    setActive(active: boolean) {
      state.active = active;
      if (!active) {
        state.generation++;
        state.refreshing = false;
      }
    },
    add(item: Appointment) {
      commit(item);
      if (state.active && !state.detailId) publish();
    },
    async refreshDetail(id: string) {
      if (state.detailId !== id) return false;
      state.generation++;
      state.refreshing = false;
      await refresh({ force: true });
      return state.detailId === id;
    }
  };
}
export type Lookup = ReturnType<typeof useLookup>;
