import { useContext, useEffect, useRef, useState } from 'react';
import { Image } from 'lucide-react';
import { apiBlob } from '../../../shared/api.js';
import { attachmentUrl } from '../../../shared/attachments.js';
import { ActivityContext, Modal } from './ui';
import type { PhotoProgress } from './intake-upload';
import { intakePhotoError } from './photos';

export function PhotoUpload({
  id,
  side,
  photoId,
  preview,
  busy,
  progress,
  onFile,
  label: customLabel
}: {
  id: string;
  side: string;
  photoId?: string;
  preview?: string;
  busy: boolean;
  progress?: PhotoProgress;
  onFile: (side: string, file: File) => void;
  label?: string;
}) {
  const active = useContext(ActivityContext);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [selectionError, setSelectionError] = useState('');
  const [filename, setFilename] = useState('');
  function select(files: File[]) {
    if (busy) return;
    const message = files.length !== 1 ? '每次请添加一张照片。' : intakePhotoError(files[0]);
    setSelectionError(message);
    if (message) return;
    setFilename(files[0].name);
    onFile(side, files[0]);
  }
  const [remote, setRemote] = useState(''),
    [error, setError] = useState(''),
    [expanded, setExpanded] = useState(false),
    [retry, setRetry] = useState(0);
  const title = customLabel || `设备${side === 'front' ? '正面' : '背面'}`;
  const label = customLabel || `${title}照片`;
  useEffect(() => {
    if (!active) return;
    const preventNavigation = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    };
    window.addEventListener('dragover', preventNavigation);
    window.addEventListener('drop', preventNavigation);
    return () => {
      window.removeEventListener('dragover', preventNavigation);
      window.removeEventListener('drop', preventNavigation);
    };
  }, [active]);
  useEffect(() => {
    setRemote('');
    setError('');
    setExpanded(false);
    if (!active || !photoId || preview) return;
    const controller = new AbortController();
    let url = '';
    apiBlob(attachmentUrl(id, photoId), { signal: controller.signal })
      .then((blob: Blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setRemote(url);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('照片加载失败');
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [active, id, photoId, preview, retry]);
  const src = preview || remote;
  return (
    <div
      className={`field-intake-photo${dragging && !busy ? ' is-dragging' : ''}`}
      aria-busy={busy}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDragging(!busy);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
        setDragging(!busy);
      }}
      onDragLeave={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        )
          return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX >= bounds.left &&
          event.clientX < bounds.right &&
          event.clientY >= bounds.top &&
          event.clientY < bounds.bottom
        )
          return;
        setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        select(Array.from(event.dataTransfer.files));
      }}
    >
      {src && (
        <div className="field-photo-heading">
          <strong>{title}</strong>
        </div>
      )}
      {src ? (
        <button
          data-track="staff.field.intakephotos.button.1"
          type="button"
          className="field-photo-preview"
          aria-label={`查看${label}`}
          onClick={(event) => {
            event.currentTarget.focus({ preventScroll: true });
            setExpanded(true);
          }}
        >
          <img src={src} alt={label} draggable={false} />
        </button>
      ) : (
        <button
          data-track="staff.field.intakephotos.add"
          type="button"
          className="field-photo-dropzone"
          disabled={busy}
          aria-label={`添加${label}`}
          title="拖拽或选择照片"
          onClick={() => input.current?.click()}
        >
          <Image size={24} aria-hidden="true" />
          <strong>{dragging ? '松开添加' : error || (photoId ? '照片加载中…' : title)}</strong>
        </button>
      )}
      {(src || photoId) && (
        <div className="field-photo-caption">
          <span className="field-photo-filename" title={filename}>
            {filename}
          </span>
          <button
            data-track="staff.field.intakephotos.replace"
            type="button"
            className="field-photo-upload"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            替换照片
          </button>
        </div>
      )}
      <input
        ref={input}
        data-track="staff.field.intakephotos.input.2"
        type="file"
        hidden
        disabled={busy}
        accept="image/jpeg,image/png,image/webp"
        aria-label={label}
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          event.target.value = '';
          if (files.length) select(files);
        }}
      />
      {selectionError && (
        <p className="field-photo-error" role="alert">
          {selectionError}
        </p>
      )}
      {progress && (
        <div className="field-photo-progress">
          <progress max={100} value={progress.value} aria-label={`${label}上传进度`} />
          <small role="status">
            {progress.label}
            {progress.value !== undefined ? ` · ${progress.value}%` : ''}
          </small>
        </div>
      )}
      {error && (
        <button
          data-track="staff.field.intakephotos.button.3"
          type="button"
          onClick={() => setRetry((value) => value + 1)}
        >
          重试加载
        </button>
      )}
      {expanded && src && (
        <Modal title={label} onClose={() => setExpanded(false)}>
          <img className="field-photo-enlarged" src={src} alt={label} />
        </Modal>
      )}
    </div>
  );
}

export function IntakePhotos({
  id,
  uploaded,
  previews,
  busy,
  progress = {},
  onFile
}: {
  id: string;
  uploaded: Record<string, string>;
  previews: Record<string, string>;
  busy: boolean;
  progress?: Record<string, PhotoProgress>;
  onFile: (side: string, file: File) => void;
}) {
  return (
    <div className="field-intake-photos" aria-label="本次设备照片">
      {['front', 'back'].map((side) => (
        <PhotoUpload
          key={side}
          id={id}
          side={side}
          photoId={uploaded[side]}
          preview={previews[side]}
          busy={busy}
          progress={progress[side]}
          onFile={onFile}
        />
      ))}
    </div>
  );
}
