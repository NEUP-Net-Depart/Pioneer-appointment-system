import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useContext, useId, useState } from 'react';
import { apiFetch } from '../../shared/api.js';
import { attachmentSize, attachmentUrl, uploadAttachments } from '../../shared/attachments.js';
import { ActivityContext, Notice } from './field/ui';

export function RepairAttachments({ id }) {
  const active = useContext(ActivityContext);
  const filesId = useId(),
    uploadId = useId();
  const [open, setOpen] = useState(false),
    [uploadOpen, setUploadOpen] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(''),
    [selected, setSelected] = useState(null);
  const client = useQueryClient();
  const queryKey = [`/api/appointments/${encodeURIComponent(id)}/attachments`];
  const result = useQuery({ queryKey, enabled: active && open });
  const files = result.data?.items;
  async function upload(event) {
    event.preventDefault();
    if (!selected || busy) return;
    setBusy('upload');
    setError('');
    try {
      await uploadAttachments({ id }, [selected]);
      setSelected(null);
      setUploadOpen(false);
      await client.invalidateQueries({ queryKey });
      setOpen(true);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy('');
    }
  }
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
    <section className="repair-attachments" aria-label="附件与设备照片">
      <div className="field-actions">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={filesId}
          disabled={!!busy}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? '收起附件与照片' : '查看附件与照片'}
        </button>
        <button
          type="button"
          aria-expanded={uploadOpen}
          aria-controls={uploadId}
          disabled={!!busy}
          onClick={() => {
            setUploadOpen((value) => !value);
            setSelected(null);
            setError('');
          }}
        >
          {uploadOpen ? '取消补充上传' : '上传补充照片'}
        </button>
      </div>
      <Notice>{error}</Notice>
      {open && (
        <div id={filesId} className="repair-attachment-list">
          <Notice>{result.error?.message}</Notice>
          {result.error && <button onClick={() => result.refetch()}>重试读取附件</button>}
          {result.isPending && !result.error && <p role="status">正在读取附件…</p>}
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
        </div>
      )}
      {uploadOpen && (
        <form id={uploadId} className="repair-attachment-upload" onSubmit={upload}>
          <label>
            补充照片
            <input
              type="file"
              accept="image/*"
              required
              disabled={!!busy}
              onChange={(event) => setSelected(event.target.files?.[0] || null)}
            />
          </label>
          <p>补充照片不替代首次接收原图。</p>
          <button className="field-primary" disabled={!selected || !!busy}>
            {busy === 'upload' ? '正在上传…' : '确认上传照片'}
          </button>
        </form>
      )}
    </section>
  );
}
