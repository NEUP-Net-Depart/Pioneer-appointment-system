import type { PhotoProgress } from './field/intake-upload.ts';
import type { AttachmentDto } from '../../shared/appointment-types.ts';
import type { ItemsResponse } from '../../shared/api-types.ts';
import { failureFrom } from '../../shared/api-types.ts';
import { track } from '../../shared/telemetry-client.ts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useContext, useEffect, useId, useState } from 'react';
import { apiFetch } from '../../shared/api.ts';
import { attachmentSize, attachmentUrl, uploadAttachments } from '../../shared/attachments.ts';
import { ActivityContext, Notice } from './field/ui';
import { PhotoUpload } from './field/IntakePhotos';
import { supplementalPhotoError } from './field/photos';
import { useRepairTool } from './RepairTools';

export function RepairAttachments({ id }: { id: string }) {
  const active = useContext(ActivityContext);
  const filesId = useId(),
    uploadId = useId();
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(''),
    [selected, setSelected] = useState<File | null>(null),
    [preview, setPreview] = useState(''),
    [progress, setProgress] = useState<PhotoProgress | undefined>(undefined);
  const [checkingPhoto, setCheckingPhoto] = useState(false);
  const onPhotoChecking = useCallback(
    (_side: string, checking: boolean) => setCheckingPhoto(checking),
    []
  );
  const filesTool = useRepairTool('attachments');
  const uploadTool = useRepairTool('upload', {
    dirty: !!selected,
    busy: !!busy || checkingPhoto,
    save: upload,
    discard: () => {
      setSelected(null);
      setError('');
    }
  });
  useEffect(() => {
    if (!selected) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(selected);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [selected]);
  const client = useQueryClient();
  const queryKey = [`/api/appointments/${encodeURIComponent(id)}/attachments`];
  const result = useQuery<ItemsResponse<AttachmentDto>>({
    queryKey,
    enabled: active && filesTool.open
  });
  const files = result.data?.items;
  async function upload() {
    if (!selected || busy || checkingPhoto) return false;
    setBusy('upload');
    setError('');
    setProgress({ label: '正在处理照片' });
    try {
      await uploadAttachments({ id }, [selected], 'general', {
        onProgress: ({ loaded, total }) =>
          setProgress({
            label: loaded >= total ? '正在保存' : '正在上传',
            value: Math.min(99, Math.floor((loaded / Math.max(1, total)) * 100))
          })
      });
      setSelected(null);
      await client.invalidateQueries({ queryKey });
      return true;
    } catch (failureValue) {
      const failure = failureFrom(failureValue);
      setError(failure.message);
      return false;
    } finally {
      setBusy('');
      setProgress(undefined);
    }
  }
  async function download(file: AttachmentDto) {
    if (busy) return;
    setBusy(file.id);
    setError('');
    try {
      const response = await apiFetch(attachmentUrl(id, file.id));
      if (!response.ok) throw new Error('附件读取失败，请重试。');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.setAttribute('data-track', 'staff.repairattachments.dynamic.download');
      link.href = url;
      link.download = file.filename;
      link.click();
      track('flow.result', { control: 'staff.repairattachments.dynamic.download', result: 'ok' });
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (failureValue) {
      const failure = failureFrom(failureValue);
      setError(failure.message);
    } finally {
      setBusy('');
    }
  }
  return (
    <section className="repair-attachments repair-action-row" aria-label="附件与设备照片">
      <button
        data-track="staff.repairattachments.button.1"
        type="button"
        className="repair-tool-trigger"
        aria-expanded={filesTool.open}
        aria-controls={filesId}
        disabled={!!busy}
        onClick={filesTool.toggle}
      >
        查看照片与附件
      </button>
      <button
        data-track="staff.repairattachments.button.2"
        type="button"
        className="repair-tool-trigger"
        aria-expanded={uploadTool.open}
        aria-controls={uploadId}
        disabled={!!busy}
        onClick={uploadTool.toggle}
      >
        补充照片
      </button>
      <Notice>{error}</Notice>
      {filesTool.open && (
        <div id={filesId} className="repair-attachment-list repair-control-panel">
          <Notice>{result.error?.message}</Notice>
          {result.error && (
            <button data-track="staff.repairattachments.button.3" onClick={() => result.refetch()}>
              重试读取附件
            </button>
          )}
          {result.isPending && !result.error && <p role="status">正在读取附件…</p>}
          {files ? (
            files.length ? (
              <ul className="record-attachments">
                {files.map((file) => (
                  <li data-motion-item="" key={file.id}>
                    <button
                      data-track="staff.repairattachments.button.4"
                      disabled={!!busy}
                      onClick={() => download(file)}
                    >
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
      {uploadTool.open && (
        <form
          data-track="staff.repairattachments.form.5"
          id={uploadId}
          className="repair-attachment-upload repair-control-panel"
          ref={uploadTool.form}
          onSubmit={async (event) => {
            event.preventDefault();
            if (await upload()) uploadTool.finish('attachments');
          }}
        >
          <PhotoUpload
            id={id}
            side="supplement"
            label="补充照片"
            preview={preview}
            busy={!!busy}
            progress={progress}
            accept="image/*"
            validateFile={supplementalPhotoError}
            onChecking={onPhotoChecking}
            onFile={(_side, file) => setSelected(file)}
          />
          <div className="repair-panel-actions">
            <button
              data-track="staff.repairattachments.cancel"
              type="button"
              disabled={!!busy}
              onClick={uploadTool.cancel}
            >
              取消
            </button>
            <button
              data-track="staff.repairattachments.button.7"
              className="field-primary"
              disabled={!selected || !!busy || checkingPhoto}
            >
              {busy === 'upload' ? '正在上传…' : '确认上传照片'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
