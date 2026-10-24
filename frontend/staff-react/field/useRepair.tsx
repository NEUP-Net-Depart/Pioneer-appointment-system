import React, { useContext, useEffect, useRef, useState } from 'react';
import { uploadAttachments } from '../../../shared/attachments.js';
import { api, ActivityContext } from './ui';
import type { Appointment, Person, Verification } from './types';
import { intakePhoto } from './photos';

export function useRepair({
  id,
  memberId,
  people,
  onClose,
  onChanged,
  sidePanel = false,
  returnLabel = '返回工作台'
}: {
  id: string;
  memberId: string;
  people: Person[];
  onClose: () => void;
  onChanged: () => void;
  sidePanel?: boolean;
  returnLabel?: string;
}) {
  const routeActive = useContext(ActivityContext);
  const [readRevision, setReadRevision] = useState(0);
  const retry = () => {
    setError('');
    setReadRevision((value) => value + 1);
  };
  const [item, setItem] = useState<Appointment | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [verification, setVerification] = useState<Verification>({
    brand: '',
    model: '',
    warranty: 'unknown',
    liquidMetal: 'unknown',
    note: ''
  });
  const [note, setNote] = useState(''),
    [outcome, setOutcome] = useState(''),
    [confirm, setConfirm] = useState(false),
    [transfer, setTransfer] = useState(false),
    [target, setTarget] = useState(''),
    [reason, setReason] = useState('');
  const [files, setFiles] = useState<Record<string, File>>({}),
    [uploaded, setUploaded] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [receivers, setReceivers] = useState<Person[]>(people),
    [receiversLoading, setReceiversLoading] = useState(false);
  useEffect(() => {
    if (!transfer || !routeActive) return;
    const controller = new AbortController();
    setReceiversLoading(true);
    api<{ items: Person[] }>(
      `/api/field/appointments/${encodeURIComponent(id)}/transfer-candidates`,
      { signal: controller.signal }
    )
      .then((value) => {
        if (!controller.signal.aborted) setReceivers(value.items);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          setReceivers([]);
          setError(failure.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setReceiversLoading(false);
      });
    return () => controller.abort();
  }, [id, transfer, routeActive]);
  const pending = useRef<{ signature: string; requestId: string } | null>(null);
  const fetchedAt = useRef(0);
  function operation(body: Record<string, unknown>) {
    const signature = JSON.stringify(body);
    if (pending.current?.signature !== signature)
      pending.current = { signature, requestId: crypto.randomUUID() };
    return { ...body, requestId: pending.current.requestId };
  }
  const draftKey = `field:${memberId}:${id}`;
  const load = async () => {
    const value = await api<Appointment>(`/api/field/appointments/${encodeURIComponent(id)}`);
    setItem(value);
    fetchedAt.current = Date.now();
    return value;
  };
  useEffect(() => {
    let active = true;
    api<Appointment>(`/api/field/appointments/${encodeURIComponent(id)}`)
      .then((value) => {
        if (!active) return;
        setItem(value);
        let draft: {
          note?: string;
          outcome?: string;
          verification?: Verification;
          uploaded?: Record<string, string>;
        } = {};
        try {
          draft = JSON.parse(sessionStorage.getItem(draftKey) || '{}');
        } catch {
          /* No stored draft. */
        }
        setNote(draft.note ?? value.repairNote ?? '');
        setOutcome(draft.outcome ?? value.outcome ?? '');
        setVerification(
          draft.verification ||
            value.intake || {
              brand: value.brand || '',
              model: value.deviceModel || '',
              warranty: 'unknown',
              liquidMetal: 'unknown',
              note: ''
            }
        );
        setUploaded(
          value.canReceive
            ? {}
            : draft.uploaded ||
                (value.reception
                  ? { front: value.frontPhotoId || '', back: value.backPhotoId || '' }
                  : {})
        );
        fetchedAt.current = Date.now();
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [id, draftKey, readRevision]);
  const intakeSession = item?.canReceive ? `${item.id}:${item.reception?.leftAt || 'new'}` : null;
  useEffect(() => {
    if (intakeSession) {
      // A new arrival requires photos uploaded by the person receiving it.
      // Keep retries in this session, but never reuse a previous arrival's IDs.
      setUploaded({});
      setFiles({});
    }
  }, [intakeSession]);
  useEffect(() => {
    const urls = Object.fromEntries(
      Object.entries(files).map(([side, file]) => [side, URL.createObjectURL(file)])
    );
    setPreviews(urls);
    return () => Object.values(urls).forEach(URL.revokeObjectURL);
  }, [files]);
  useEffect(() => {
    if (item && item.status !== 'completed')
      try {
        sessionStorage.setItem(draftKey, JSON.stringify({ note, outcome, verification, uploaded }));
      } catch {
        /* Form remains in memory if storage is unavailable. */
      }
  }, [draftKey, note, outcome, verification, uploaded, item]);
  useEffect(() => {
    if (!routeActive) return;
    let active = true,
      controller: AbortController | null = null;
    const refresh = async () => {
      controller?.abort();
      if (document.hidden) return;
      controller = new AbortController();
      const current = controller;
      try {
        const value = await api<Appointment>(`/api/field/appointments/${encodeURIComponent(id)}`, {
          signal: current.signal
        });
        if (active && !current.signal.aborted) {
          setItem(value);
          fetchedAt.current = Date.now();
        }
      } catch (error) {
        if (!active || current.signal.aborted) return;
        if ([401, 403].includes((error as Error & { status: number }).status)) {
          setItem(null);
        }
        setError((error as Error).message);
      }
    };
    if (!document.hidden && fetchedAt.current && Date.now() - fetchedAt.current >= 30000) refresh();
    const timer = setInterval(refresh, 30000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false;
      controller?.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [id, routeActive]);
  async function command(body: Record<string, unknown>) {
    await api(`/api/appointments/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: operation({ ...body, revision: item!.revision })
    });
    await load();
    onChanged();
  }
  async function receptionCommand(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    const body = operation({ action, ...extra, revision: item!.revision });
    const send = () =>
      api(`/api/appointments/${encodeURIComponent(id)}/reception`, { method: 'POST', body });
    try {
      try {
        await send();
      } catch (failure) {
        const status = (failure as Error & { status?: number }).status;
        if (status && status < 500) throw failure;
        // Reuse the original receipt and revision if the response was lost.
        await send();
      }
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  }
  async function start(event: React.FormEvent, receive = false) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const photos = { ...uploaded };
      for (const side of ['front', 'back']) {
        if (!photos[side]) {
          if (!files[side] || files[side].size > 5 * 1024 * 1024)
            throw new Error('请选择两张不超过 5 MB 的设备照片');
          const [attachment] = await uploadAttachments(
            item,
            [await intakePhoto(files[side])],
            `intake_${side}`
          );
          photos[side] = attachment.id;
          setUploaded({ ...photos });
        }
      }
      const details = {
        status: 'in_progress',
        frontPhotoId: photos.front,
        backPhotoId: photos.back,
        verification
      };
      if (receive) await receptionCommand('receive', details);
      else await command(details);
    } catch (error) {
      setError((error as Error).message);
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function finish() {
    setBusy(true);
    setError('');
    try {
      await command({ status: 'completed', outcome, repairNote: note.trim() });
      sessionStorage.removeItem(draftKey);
      setConfirm(false);
    } catch (error) {
      setError((error as Error).message);
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function saveNote() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await command({ repairNote: note.trim() });
      setError('维修说明已保存。');
    } catch (failure) {
      setError((failure as Error).message);
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function handoff(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/api/appointments/${encodeURIComponent(id)}/transfer`, {
        method: 'POST',
        body: operation({
          assignedTo: target,
          reason,
          revision: item!.revision
        })
      });
      await load();
      setTransfer(false);
      onChanged();
    } catch (error) {
      setError((error as Error).message);
      await load().catch(() => {});
      onChanged();
    } finally {
      setBusy(false);
    }
  }
  return {
    item,
    error,
    busy,
    verification,
    setVerification,
    note,
    setNote,
    outcome,
    setOutcome,
    confirm,
    setConfirm,
    transfer,
    setTransfer,
    target,
    setTarget,
    reason,
    setReason,
    files,
    setFiles,
    uploaded,
    setUploaded,
    previews,
    receivers,
    receiversLoading,
    load,
    retry,
    start,
    receptionCommand,
    finish,
    saveNote,
    handoff
  };
}
