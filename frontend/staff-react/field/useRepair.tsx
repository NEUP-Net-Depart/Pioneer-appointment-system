import { useEffect, useRef, useState } from 'react';
import { uploadAttachments } from '../../../shared/attachments.js';
import { api } from './ui';
import type { Appointment, Verification } from './types';
import { intakePhoto } from './photos';

export function useRepair({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [item, setItem] = useState<Appointment | null>(null);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [timedOut, setTimedOut] = useState(false);
  const [verification, setVerification] = useState<Verification>({
    brand: '',
    model: '',
    warranty: 'unknown',
    liquidMetal: 'unknown',
    note: ''
  });
  const [note, setNote] = useState(''),
    [outcome, setOutcome] = useState('');
  const [files, setFiles] = useState<Record<string, File>>({}),
    [uploaded, setUploaded] = useState<Record<string, string>>({}),
    [previews, setPreviews] = useState<Record<string, string>>({});
  const pending = useRef<{ signature: string; requestId: string } | null>(null);
  async function load() {
    const value = await api<Appointment>(`/api/field/appointments/${encodeURIComponent(id)}`);
    setItem(value);
    return value;
  }
  useEffect(() => {
    let active = true;
    api<Appointment>(`/api/field/appointments/${encodeURIComponent(id)}`)
      .then((value) => {
        if (!active) return;
        setItem(value);
        setNote(value.repairNote || '');
        setOutcome(value.outcome || '');
        setVerification({
          brand: value.brand || '',
          model: value.deviceModel || '',
          warranty: value.warranty || 'unknown',
          liquidMetal: value.liquidMetal || 'unknown',
          note: ''
        });
        setUploaded({ front: value.frontPhotoId || '', back: value.backPhotoId || '' });
      })
      .catch((failure) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [id]);
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
    await api(`/api/appointments/${encodeURIComponent(id)}/${path}`, {
      method,
      body: operation({ ...body, revision: item!.revision })
    });
    await load();
    onChanged();
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (failure) {
      setError((failure as Error).message);
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function photos(partial = false) {
    if (!partial && ['front', 'back'].some((side) => !files[side] && !uploaded[side]))
      throw new Error('请先拍摄正反面两张照片');
    const saved = { ...uploaded };
    const results = await Promise.allSettled(
      ['front', 'back'].map(async (side) => {
        if (saved[side] || !files[side]) return;
        const [attachment] = await uploadAttachments(
          item,
          [await intakePhoto(files[side])],
          `intake_${side}`
        );
        saved[side] = attachment.id;
      })
    );
    setUploaded(saved);
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    if (
      failures.some(
        (result) => result.reason?.name === 'AbortError' || result.reason?.name === 'TimeoutError'
      )
    )
      setTimedOut(true);
    if (failures.length)
      throw new Error(
        timedOut ||
        failures.some((result) => ['AbortError', 'TimeoutError'].includes(result.reason?.name))
          ? '上传超时。请保留首次接收原图，可选择稍后补传。'
          : '照片上传失败，请手动重试。'
      );
    return { frontPhotoId: saved.front || undefined, backPhotoId: saved.back || undefined };
  }
  const start = (receiveOnly = false, defer = false) =>
    run(async () => {
      const photoData = item!.receivedAt
        ? {}
        : defer
          ? {
              frontPhotoId: uploaded.front || undefined,
              backPhotoId: uploaded.back || undefined,
              photosCaptured: true,
              uploadTimedOut: true
            }
          : await photos();
      await send(
        receiveOnly ? 'receive' : 'status',
        { ...photoData, verification, ...(!receiveOnly ? { status: 'in_progress' } : {}) },
        receiveOnly ? 'POST' : 'PATCH'
      );
      setTimedOut(false);
    });
  const supplement = () =>
    run(async () => {
      await send('photos', await photos(true));
    });
  const finish = () =>
    run(() => send('status', { status: 'completed', outcome, repairNote: note.trim() }, 'PATCH'));
  const correct = () =>
    run(() => send('correction', { outcome, repairNote: note.trim() }, 'PATCH'));
  const handoff = () => run(() => send('transfer', { receivedDevice: true }));
  return {
    item,
    error,
    busy,
    timedOut,
    verification,
    setVerification,
    note,
    setNote,
    outcome,
    setOutcome,
    files,
    uploaded,
    previews,
    onFile: (side: string, file: File) => {
      setFiles({ ...files, [side]: file });
      setUploaded({ ...uploaded, [side]: '' });
      setTimedOut(false);
    },
    load,
    start,
    supplement,
    finish,
    correct,
    handoff
  };
}
