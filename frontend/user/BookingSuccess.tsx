import { useLayoutEffect, useRef, useState } from 'react';
import { reveal } from './motion';
import { TimeSummary } from './presentation';
import { RepairQr } from './RepairQr';
import type { Appointment } from './types';
import type { Booking } from './use-booking';
import type { Photo } from './use-photos';
import type { QrCache } from './RepairQr';

const labels = { uploaded: '已上传', uploading: '上传中', failed: '上传失败', waiting: '等待上传' };
const icons = { uploaded: '✓', uploading: '', failed: '!', waiting: '◷' };

function PhotoProgress({
  entries,
  deferred,
  retry,
  later
}: {
  entries: Photo[];
  deferred: boolean;
  retry: () => void;
  later: () => void;
}) {
  const count = entries.filter((entry) => entry.attachment).length;
  const pending = count < entries.length;
  const failures = entries.some((entry) => entry.state === 'upload-error');
  const uploading = entries.some((entry) => entry.state === 'uploading');
  let status = '预约已创建。';
  if (pending && deferred)
    status = uploading ? '预约已创建，当前照片上传后暂停。' : '预约已创建，剩余照片可稍后补传。';
  else if (uploading) status = '预约已创建，正在上传故障照片。';
  else if (pending) status = '预约已创建，仍有照片未上传。';
  const message = failures
    ? '预约已成功，部分照片未上传。你可以重试或稍后在预约详情补充。'
    : pending && deferred
      ? '你可以稍后在预约详情重新选择并补传照片。'
      : pending
        ? '照片上传不影响已成功创建的预约。'
        : '照片已全部上传。';
  return (
    <section id="success-photos" aria-labelledby="success-photo-title" hidden={!entries.length}>
      <h2 id="success-photo-title">故障照片上传</h2>
      <p id="success-photo-status">{status}</p>
      <div className="photo-upload-heading">
        <span>照片上传进度</span>
        <span id="success-photo-count">{count + ' / ' + entries.length + ' 张'}</span>
      </div>
      <progress
        id="success-photo-total"
        value={count}
        max={entries.length || 1}
        aria-label="照片上传总进度"
      />
      <div id="success-photo-progress">
        {entries.map((entry, index) => {
          const state = entry.attachment
            ? 'uploaded'
            : entry.state === 'uploading'
              ? 'uploading'
              : entry.state === 'upload-error'
                ? 'failed'
                : 'waiting';
          return (
            <div className="photo-upload-row" data-upload-state={state} key={entry.id}>
              <strong title={entry.name}>{'照片 ' + (index + 1) + ' · ' + entry.name}</strong>
              <span className="photo-upload-state">
                <span className="upload-state-icon" aria-hidden="true">
                  {icons[state]}
                </span>
                {labels[state]}
              </span>
              {state === 'failed' && <p className="is-error">{entry.message}</p>}
            </div>
          );
        })}
      </div>
      <p id="success-photo-message" role="status" hidden={pending && !failures && !deferred}>
        {message}
      </p>
      <p
        id="success-photo-advice"
        className="upload-advice"
        hidden={!pending || failures || deferred}
      >
        <span className="advice-icon" aria-hidden="true">
          i
        </span>
        <span>建议等待照片上传完成后再关闭页面。预约本身已经成功。</span>
      </p>
      <div className="photo-upload-actions">
        <button
          data-track="student.index.button.38"
          id="success-photo-retry"
          className="secondary-btn"
          type="button"
          hidden={!failures}
          disabled={uploading}
          onClick={retry}
        >
          重试未上传照片
        </button>
        <button
          data-track="student.index.button.39"
          id="success-photo-later"
          className="text-btn"
          type="button"
          hidden={!pending || deferred}
          onClick={later}
        >
          稍后补传
        </button>
      </div>
    </section>
  );
}
export function BookingSuccess({
  booking,
  detail,
  list
}: {
  booking: Booking;
  detail: (item: Appointment) => void;
  list: () => void;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  const root = useRef<HTMLElement>(null);
  const [cache] = useState<QrCache>(() => new Map());
  const { created } = booking;
  useLayoutEffect(() => {
    if (!created) return;
    reveal(root.current);
    title.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'auto' });
    return () => cache.clear();
  }, [created, cache]);
  return (
    <section
      ref={root}
      className="success-panel"
      id="success-panel"
      hidden={!created}
      aria-labelledby="success-title"
    >
      <div className="success-icon" aria-hidden="true">
        ✓
      </div>
      <h1 ref={title} id="success-title" tabIndex={-1}>
        预约成功
      </h1>
      <div className="success-layout">
        <div className="success-details">
          <div id="success-summary" className="selection-summary">
            {created && <TimeSummary item={created} />}
          </div>
          <div className="booking-code">
            <span>预约编号</span>
            <strong id="success-code">{created?.id}</strong>
          </div>
          <p
            id="credential-save-message"
            className="notice"
            hidden={booking.credentialSaved}
            role="status"
          >
            {created && '此浏览器无法保存预约记录。请在关闭页面前保存到场二维码。'}
          </p>
        </div>
        <div className="repair-qr success-qr-panel">
          <div id="success-repair-qr">{created && <RepairQr item={created} cache={cache} />}</div>
          <p className="success-qr-hint">建议截图保存此二维码，并在前来维修时出示给维修人员</p>
        </div>
      </div>
      <PhotoProgress
        entries={created ? booking.photos.entries : []}
        deferred={booking.deferred}
        retry={booking.retryPhotos}
        later={booking.deferPhotos}
      />
      <div className="success-actions">
        <button
          data-track="student.index.button.40"
          className="primary-btn"
          id="view-created-appointment"
          type="button"
          onClick={() => {
            if (created) {
              booking.photos.pauseUpload();
              detail(created);
            }
          }}
        >
          查看本次预约
        </button>
        <button
          data-track="student.index.button.41"
          className="secondary-btn"
          type="button"
          data-view-link="lookup"
          onClick={list}
        >
          我的预约
        </button>
      </div>
    </section>
  );
}
