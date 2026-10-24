import { useContext, useEffect, useState } from 'react';
import { apiBlob } from '../../../shared/api.js';
import { attachmentUrl } from '../../../shared/attachments.js';
import { ActivityContext, Modal } from './ui';

function IntakePhoto({
  id,
  side,
  photoId,
  preview,
  busy,
  onFile
}: {
  id: string;
  side: string;
  photoId?: string;
  preview?: string;
  busy: boolean;
  onFile: (side: string, file: File) => void;
}) {
  const active = useContext(ActivityContext);
  const [remote, setRemote] = useState(''),
    [error, setError] = useState(''),
    [expanded, setExpanded] = useState(false),
    [retry, setRetry] = useState(0);
  const label = `设备${side === 'front' ? '正面' : '背面'}照片`;
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
    <div className="field-intake-photo">
      {src ? (
        <button
          type="button"
          className="field-photo-preview"
          aria-label={`查看${label}`}
          onClick={(event) => {
            event.currentTarget.focus({ preventScroll: true });
            setExpanded(true);
          }}
        >
          <img src={src} alt={label} />
        </button>
      ) : (
        <div className="field-photo-placeholder" role="status">
          {error || (photoId ? '加载中…' : '待上传')}
        </div>
      )}
      <div className="field-photo-caption">
        <span>{side === 'front' ? '正面' : '背面'}</span>
        <label className="field-photo-upload">
          {src || photoId ? '替换照片' : '拍照'}
          <input
            type="file"
            disabled={busy}
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            aria-label={label}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onFile(side, file);
            }}
          />
        </label>
      </div>
      {error && (
        <button type="button" onClick={() => setRetry((value) => value + 1)}>
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
  onFile
}: {
  id: string;
  uploaded: Record<string, string>;
  previews: Record<string, string>;
  busy: boolean;
  onFile: (side: string, file: File) => void;
}) {
  return (
    <div className="field-intake-photos" aria-label="本次设备照片">
      {['front', 'back'].map((side) => (
        <IntakePhoto
          key={side}
          id={id}
          side={side}
          photoId={uploaded[side]}
          preview={previews[side]}
          busy={busy}
          onFile={onFile}
        />
      ))}
    </div>
  );
}
