import { useRef } from 'react';
import { useDialogs } from './dialogs';
import type { Photos } from './use-photos';

const accept = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';

export function PhotoCollection({
  id,
  inputId,
  photos
}: {
  id: string;
  inputId?: string;
  photos: Photos;
}) {
  const input = useRef<HTMLInputElement>(null);
  const replacement = useRef<HTMLInputElement>(null);
  const replacementId = useRef<string | null>(null);
  const { open } = useDialogs();
  return (
    <div id={id} className="photo-collection">
      <div className="photo-grid">
        {photos.entries.map((entry) => {
          const locked = entry.state === 'uploading' || !!entry.attachment;
          return (
            <article key={entry.id} className="photo-card" data-photo={entry.id}>
              {entry.url ? (
                <button
                  data-track="student.photos.button.1"
                  type="button"
                  className="photo-preview-button"
                  data-preview={entry.id}
                  aria-label={'预览 ' + entry.name}
                  onClick={() => entry.url && open({ kind: 'photo', url: entry.url })}
                >
                  <img src={entry.url} alt={entry.name} />
                </button>
              ) : (
                <div className="photo-preview-placeholder" aria-hidden="true" />
              )}
              <p>{entry.name}</p>
              <p className={entry.state === 'error' ? 'is-error' : ''} role="status">
                {entry.message}
              </p>
              {entry.state === 'preparing' && (
                <progress max={100} value={entry.progress} aria-label="照片准备进度" />
              )}
              {entry.state === 'uploading' && <progress aria-label="照片上传进度" />}
              <div className="photo-controls">
                <button
                  data-track="student.photos.button.2"
                  type="button"
                  className="text-btn"
                  data-replace={entry.id}
                  disabled={locked}
                  onClick={() => {
                    replacementId.current = entry.id;
                    replacement.current?.click();
                  }}
                >
                  替换
                </button>
                <button
                  data-track="student.photos.button.3"
                  type="button"
                  className="text-btn"
                  data-delete={entry.id}
                  disabled={locked}
                  onClick={() => photos.remove(entry)}
                >
                  删除
                </button>
              </div>
            </article>
          );
        })}
      </div>
      <input
        ref={input}
        data-track="student.photos.dynamic.file"
        type="file"
        multiple
        accept={accept}
        hidden
        id={inputId}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files || []);
          event.currentTarget.value = '';
          photos.add(files);
        }}
      />
      <button
        ref={photos.addButton}
        data-track="student.photos.dynamic.add"
        type="button"
        className="secondary-btn"
        disabled={photos.full}
        onClick={() => input.current?.click()}
      >
        添加照片
      </button>
      <p className="field-error" role="alert">
        {photos.error}
      </p>
      <input
        ref={replacement}
        data-track="student.photos.dynamic.replacement"
        type="file"
        accept={accept}
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          const entry = photos.current.current.find((photo) => photo.id === replacementId.current);
          if (file && entry && !entry.attachment && entry.state !== 'uploading')
            void photos.prepare(entry, file);
        }}
      />
    </div>
  );
}
