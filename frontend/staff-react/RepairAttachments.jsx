import { DataValue } from './DataValue';
import React, { useContext, useEffect, useState } from 'react';
import { apiFetch } from '../../shared/api.js';
import { attachmentSize, attachmentUrl } from '../../shared/attachments.js';
import { request } from './request.js';
import { ActivityContext, Notice } from './field/ui';

export function RepairAttachments({ id, revision }) {
  const active = useContext(ActivityContext);
  const [open, setOpen] = useState(false),
    [files, setFiles] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(''),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!active || !open) return;
    const controller = new AbortController();
    setError('');
    request(`/api/appointments/${encodeURIComponent(id)}/attachments`, {
      signal: controller.signal
    })
      .then((value) => {
        if (!controller.signal.aborted) setFiles(value.items);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          if ([401, 403].includes(failure.status)) setFiles(null);
          setError(failure.message);
        }
      });
    return () => controller.abort();
  }, [id, revision, open, active, retry]);
  async function download(file) {
    if (busy) return;
    setBusy(file.id);
    setError('');
    try {
      const response = await apiFetch(attachmentUrl(id, file.id));
      if (!response.ok) throw new Error('附件读取失败，请重试。');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = file.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy('');
    }
  }
  return (
    <details className="field-details" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>附件与设备照片</summary>
      <Notice>{error}</Notice>
      {error && <button onClick={() => setRetry((value) => value + 1)}>重试读取附件</button>}
      {files ? (
        files.length ? (
          <ul className="record-attachments">
            {files.map((file) => (
              <li key={file.id}>
                <button disabled={!!busy} onClick={() => download(file)}>
                  {busy === file.id ? '正在读取…' : file.filename}
                  <small>{attachmentSize(file.size)}</small>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="field-muted">暂无可用附件。</p>
        )
      ) : (
        open && !error && <DataValue label="附件" />
      )}
    </details>
  );
}
