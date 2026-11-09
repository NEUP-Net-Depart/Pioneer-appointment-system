import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useContext, useState } from 'react';
import { apiFetch } from '../../shared/api.js';
import { attachmentSize, attachmentUrl, uploadAttachments } from '../../shared/attachments.js';
import { ActivityContext, Notice } from './field/ui';
import { DataExpansion } from './DataExpansion.jsx';

export function RepairAttachments({ id }) {
  const active = useContext(ActivityContext);
  const [open, setOpen] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(''),
    [selected, setSelected] = useState(null);
  const client = useQueryClient();
  const queryKey = [`/api/appointments/${encodeURIComponent(id)}/attachments`];
  const result = useQuery({ queryKey, enabled: active && open });
  const files = result.data?.items;
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
      <Notice>{error || result.error?.message}</Notice>
      <p>出现新的外观变化可手动补拍；此处照片不替代首次接收原图。</p>
      <input
        type="file"
        accept="image/*"
        disabled={!!busy}
        onChange={(event) => setSelected(event.target.files?.[0] || null)}
      />
      <button
        disabled={!selected || !!busy}
        onClick={async () => {
          setBusy('upload');
          setError('');
          try {
            await uploadAttachments({ id }, [selected]);
            setSelected(null);
            client.invalidateQueries({ queryKey });
          } catch (failure) {
            setError(failure.message);
          } finally {
            setBusy('');
          }
        }}
      >
        上传补充照片
      </button>
      {error && (
        <button onClick={() => client.invalidateQueries({ queryKey })}>重试读取附件</button>
      )}
      <DataExpansion ready={!!files}>
        {files ? (
          files.length ? (
            <ul className="record-attachments">
              {files.map((file) => (
                <li data-motion-item="" key={file.id}>
                  <button disabled={!!busy} onClick={() => download(file)}>
                    {busy === file.id ? '正在读取…' : file.filename}
                    <small data-motion-value="text">{attachmentSize(file.size)}</small>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="field-muted">暂无可用附件。</p>
          )
        ) : null}
      </DataExpansion>
    </details>
  );
}
