import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityContext, api } from './ui';
import type { Appointment, Verification } from './types';
import { intakeUpload } from './intake-upload';

export function useRepair({ id }: { id: string }) {
  const client = useQueryClient();
  const queryKey = [`/api/field/appointments/${encodeURIComponent(id)}`];
  const result = useQuery<Appointment>({
    queryKey,
    enabled: useContext(ActivityContext),
    refetchInterval: false,
    refetchOnWindowFocus: false
  });
  const item = result.data;
  const initialized = useRef(false);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [waitingForPhotos, setWaitingForPhotos] = useState(false);
  const skipWaiting = useRef<(() => void) | null>(null);
  const actionRunning = useRef(false);
  const photoTask = useMemo(
    () =>
      intakeUpload(id, () => {
        void load().catch(() => {});
      }),
    [id, client]
  );
  const photoState = useSyncExternalStore(photoTask.subscribe, photoTask.snapshot);
  const { files, uploaded } = photoState;
  const [verification, setVerification] = useState<Verification>({
    brand: '',
    model: '',
    warranty: 'unknown',
    liquidMetal: 'unknown',
    note: ''
  });
  const [note, setNote] = useState(''),
    [outcome, setOutcome] = useState('');
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const pending = useRef<{ signature: string; requestId: string } | null>(null);
  async function load() {
    const affected = {
      predicate: (query) =>
        [
          '/api/appointments',
          '/api/appointments/counts',
          '/api/appointments/overview',
          '/api/field/home',
          '/api/field/board',
          '/api/stats/summary',
          '/api/attendance/workload',
          '/api/attendance/day'
        ].includes(query.queryKey[0]) ||
        String(query.queryKey[0]).startsWith(`/api/appointments/${encodeURIComponent(id)}/`) ||
        String(query.queryKey[0]).startsWith('/api/field/appointments/')
    };
    await client.cancelQueries(affected);
    await client.invalidateQueries(affected);
    return client.getQueryData<Appointment>(queryKey);
  }
  useEffect(() => {
    if (!item || initialized.current) return;
    initialized.current = true;
    setNote(item.repairNote || '');
    setOutcome(item.outcome || '');
    setVerification({
      brand: item.brand || '',
      model: item.deviceModel || '',
      warranty: item.warranty || 'unknown',
      liquidMetal: item.liquidMetal || 'unknown',
      note: ''
    });
    photoTask.seed(item);
  }, [item]);
  useEffect(() => {
    // A receipt may succeed even if its response was lost. A fresh detail
    // read can still enable association of this session's pending photos.
    if (item?.receivedAt) photoTask.confirmed(item);
  }, [item, photoTask]);
  useEffect(() => {
    const urls = Object.fromEntries(
      Object.entries(files).map(([side, file]) => [side, URL.createObjectURL(file)])
    );
    setPreviews(urls);
    return () => Object.values(urls).forEach(URL.revokeObjectURL);
  }, [files]);
  function operation(body: Record<string, unknown>) {
    const signature = JSON.stringify(body);
    if (pending.current?.signature !== signature)
      pending.current = { signature, requestId: crypto.randomUUID() };
    return { ...body, requestId: pending.current.requestId };
  }
  async function send(path: string, body: Record<string, unknown>, method = 'POST') {
    const updated = await api<Appointment>(`/api/appointments/${encodeURIComponent(id)}/${path}`, {
      method,
      body: operation({ ...body, revision: item!.revision })
    });
    await load();
    return updated;
  }
  async function run(action: () => Promise<unknown>) {
    if (actionRunning.current) return;
    actionRunning.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (failure) {
      setError((failure as Error).message);
      await load().catch(() => {});
    } finally {
      actionRunning.current = false;
      skipWaiting.current = null;
      setWaitingForPhotos(false);
      setBusy(false);
    }
  }
  async function waitForPhotos(action: () => Promise<unknown>) {
    const skip = new Promise<boolean>((resolve) => {
      skipWaiting.current = () => resolve(true);
    });
    setWaitingForPhotos(true);
    try {
      return await Promise.race([action().then(() => false), skip]);
    } finally {
      skipWaiting.current = null;
      setWaitingForPhotos(false);
    }
  }
  const start = (receiveOnly = false, defer = false) =>
    run(async () => {
      let skipped = false;
      if (!item!.receivedAt) {
        if (defer) {
          if (!photoTask.snapshot().canSkip) return;
          skipped = true;
        } else {
          skipped = await waitForPhotos(() => photoTask.upload());
          if (!skipped && photoTask.snapshot().error) throw new Error(photoTask.snapshot().error);
        }
      }
      const photoData = item!.receivedAt
        ? {}
        : {
            ...photoTask.photoIds(),
            ...(skipped ? { photosCaptured: true, uploadTimedOut: true } : {})
          };
      const updated = await send(
        receiveOnly ? 'receive' : 'status',
        { ...photoData, verification, ...(!receiveOnly ? { status: 'in_progress' } : {}) },
        receiveOnly ? 'POST' : 'PATCH'
      );
      photoTask.confirmed(updated);
    });
  const supplement = () => run(() => waitForPhotos(() => photoTask.supplement()));
  const finish = () =>
    run(() => send('status', { status: 'completed', outcome, repairNote: note.trim() }, 'PATCH'));
  const correct = () =>
    run(() => send('correction', { outcome, repairNote: note.trim() }, 'PATCH'));
  const handoff = () => run(() => send('transfer', { receivedDevice: true }));
  return {
    item,
    error: error || photoState.error || result.error?.message || '',
    busy,
    canSkip: photoState.canSkip,
    waitingForPhotos,
    photoBusy: photoState.uploading || photoState.linking,
    photoProgress: photoState.progress,
    skip: () => {
      if (photoTask.snapshot().canSkip) skipWaiting.current?.();
    },
    verification,
    setVerification,
    note,
    setNote,
    outcome,
    setOutcome,
    files,
    uploaded,
    previews,
    onFile: photoTask.select,
    load,
    start,
    supplement,
    finish,
    correct,
    handoff
  };
}
