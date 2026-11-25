import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { apiBlob } from '../../shared/api.ts';
import { attachmentUrl, attachmentSize } from '../../shared/attachments.ts';
import { terminalStatuses } from '../../shared/constants.ts';
import { formatDate } from '../../shared/time.ts';
import { failureFrom } from './api';
import { appointmentTicketImage } from './appointment-ticket';
import { credentialHeaders } from './credentials';
import { useDialogs } from './dialogs';
import { PhotoCollection } from './PhotoCollection';
import {
  InformationGroups,
  isAwaitingArrival,
  LookupSchedule,
  RepairRecord,
  statusExplanation,
  timeLabel
} from './presentation';
import { RepairHistory } from './RepairHistory';
import { RepairQr } from './RepairQr';
import type { Appointment, Attachment } from './types';
import type { Lookup } from './use-lookup';
import { usePhotos } from './use-photos';

function download(url: string, filename: string) {
  const link = document.createElement('a');
  link.setAttribute('data-track', 'student.lookup.dynamic.download');
  link.href = url;
  link.download = filename;
  link.click();
}

function DetailAttachments({
  item,
  lookup,
  active,
  toast
}: {
  item: Appointment;
  lookup: Lookup;
  active: boolean;
  toast: (message: string) => void;
}) {
  const existing = (item.attachments || []).filter(
    (file) =>
      ['general', 'student_photo'].includes(file.purpose) && file.mimeType.startsWith('image/')
  );
  const photos = usePhotos(existing.length);
  const { open } = useDialogs();
  const urls = useRef(new Map<string, ReturnType<typeof setTimeout> | undefined>()).current;
  const requests = useRef(new Map<string, AbortController>()).current;
  const [loading, setLoading] = useState(new Set<string>());
  const [message, setMessage] = useState('');
  const uploading = photos.entries.some((entry) => entry.state === 'uploading');
  const issue = photos.entries.some((entry) => entry.state === 'upload-error')
    ? '部分照片未上传，可再次点击上传重试。已成功的照片不会重复上传。'
    : '';
  useEffect(() => {
    if (!active) photos.pauseUpload();
  }, [active]);
  useEffect(
    () => () => {
      for (const controller of requests.values()) controller.abort();
      requests.clear();
      for (const [url, timer] of urls) {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      urls.clear();
    },
    [requests, urls]
  );

  async function attachment(file: Attachment) {
    if (requests.has(file.id)) return;
    const controller = new AbortController();
    requests.set(file.id, controller);
    setLoading(new Set(requests.keys()));
    try {
      const blob = await apiBlob(attachmentUrl(item.id, file.id), {
        headers: credentialHeaders(item),
        timeoutMs: 30000,
        signal: controller.signal
      });
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      urls.set(url, undefined);
      if (file.mimeType.startsWith('image/')) open({ kind: 'photo', url });
      else {
        download(url, file.filename);
        urls.set(
          url,
          setTimeout(() => {
            URL.revokeObjectURL(url);
            urls.delete(url);
          }, 60000)
        );
      }
    } catch (value) {
      if (!controller.signal.aborted) toast(failureFrom(value).message);
    } finally {
      if (requests.get(file.id) === controller) {
        requests.delete(file.id);
        setLoading(new Set(requests.keys()));
      }
    }
  }

  async function upload() {
    if (!photos.current.current.length) {
      setMessage('请先选择照片。');
      return;
    }
    if (!photos.validity()) return;
    setMessage('');
    await photos.uploadAll(item);
    if (!(await lookup.refreshDetail(item.id))) return;
    if (photos.current.current.every((entry) => entry.attachment)) {
      photos.reset();
      setMessage('照片已上传。');
    }
  }

  return (
    <section className="appointment-detail-section" id="detail-photo-upload">
      <h2>故障照片与附件</h2>
      <div id="detail-attachments">
        {item.attachments?.map((file) => (
          <button
            key={file.id}
            data-track="student.lookup.button.10"
            className="text-btn"
            type="button"
            data-attachment-id={file.id}
            disabled={loading.has(file.id)}
            onClick={() => void attachment(file)}
          >
            {file.filename +
              ' · ' +
              attachmentSize(file.size) +
              (file.purpose === 'intake_front'
                ? ' · 接待正面照片'
                : file.purpose === 'intake_back'
                  ? ' · 接待背面照片'
                  : '')}
          </button>
        ))}
      </div>
      <div className="detail-upload-actions">
        <PhotoCollection id="detail-photos" photos={photos} />
        <button
          data-track="student.lookup.button.9"
          className="primary-btn"
          id="detail-upload"
          type="button"
          hidden={!photos.entries.length}
          disabled={uploading}
          onClick={() => void upload()}
        >
          {uploading ? '正在上传…' : '上传所选照片'}
        </button>
      </div>
      <p id="detail-upload-message" role="status">
        {issue || message}
      </p>
    </section>
  );
}

function Operations({
  item,
  lookup,
  rebook,
  hasDraft,
  hasPending
}: {
  item: Appointment;
  lookup: Lookup;
  rebook: () => void;
  hasDraft: () => boolean;
  hasPending: () => boolean;
}) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [rebookOpen, setRebookOpen] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null),
    confirm = useRef<HTMLButtonElement>(null);
  const clicked = useRef(false);
  useLayoutEffect(() => {
    if (clicked.current) (cancelOpen ? confirm : launcher).current?.focus();
  }, [cancelOpen]);
  const historic = terminalStatuses.some(status => status === item.status);
  return (
    <div id="detail-operations">
      {item.status === 'booked' && !item.receivedAt ? (
        <>
          <button
            ref={launcher}
            data-track="student.lookup.button.11"
            type="button"
            className="secondary-btn danger-btn"
            data-cancel-open=""
            aria-expanded={cancelOpen}
            aria-controls="cancel-confirmation"
            onClick={() => {
              clicked.current = true;
              setCancelOpen(true);
            }}
          >
            取消预约
          </button>
          <div
            className="notice cancel-confirm"
            id="cancel-confirmation"
            role="region"
            aria-label="取消预约二次确认"
            hidden={!cancelOpen}
          >
            <p>{item.campus + ' · ' + formatDate(item.date) + ' · ' + (timeLabel(item) || '')}</p>
            <p id="cancel-explanation">取消后本次预约将失效。如仍需维修，请重新预约。</p>
            <div className="actions">
              <button
                data-track="student.lookup.button.12"
                className="secondary-btn"
                type="button"
                data-cancel-keep=""
                onClick={() => setCancelOpen(false)}
              >
                保留预约
              </button>
              <button
                ref={confirm}
                data-track="student.lookup.button.13"
                className="secondary-btn danger-btn"
                type="button"
                data-cancel-confirm=""
                aria-describedby="cancel-explanation"
                disabled={lookup.cancelling}
                onClick={() => void lookup.cancel()}
              >
                确认取消
              </button>
            </div>
            <p className="field-error" id="cancel-message" role="alert">
              {lookup.cancelMessage}
            </p>
          </div>
        </>
      ) : historic ? (
        <>
          <button
            data-track="student.lookup.button.14"
            className="primary-btn"
            type="button"
            data-rebook=""
            onClick={() => {
              if (hasPending())
                lookup.setDetailNotice('另一次提交结果尚未核实，请先返回预约维修核实原请求。');
              else if (hasDraft()) setRebookOpen(true);
              else rebook();
            }}
          >
            重新预约
          </button>
          <div className="notice" id="rebook-confirm" hidden={!rebookOpen}>
            <p>重新预约将舍弃当前未提交草稿，开始空白预约。是否继续？</p>
            <div className="actions">
              <button
                data-track="student.lookup.button.15"
                className="secondary-btn"
                type="button"
                data-rebook-keep=""
                onClick={() => setRebookOpen(false)}
              >
                保留草稿
              </button>
              <button
                data-track="student.lookup.button.16"
                className="primary-btn"
                type="button"
                data-rebook-confirm=""
                onClick={rebook}
              >
                舍弃草稿并重新预约
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function AppointmentDetail({
  item,
  lookup,
  active,
  rebook,
  hasDraft,
  hasPending,
  toast
}: {
  item: Appointment;
  lookup: Lookup;
  active: boolean;
  rebook: () => void;
  hasDraft: () => boolean;
  hasPending: () => boolean;
  toast: (message: string) => void;
}) {
  const image = useRef<HTMLImageElement>(null);
  const [qrReady, setQrReady] = useState(false);
  const arrived = isAwaitingArrival(item) && !item.servicePaused;
  const historic = terminalStatuses.some(status => status === item.status);
  const explanation = statusExplanation(item);
  function save() {
    try {
      download(appointmentTicketImage(item, image.current), '预约单-' + item.id + '.png');
    } catch {
      toast('预约单暂时无法保存，请稍后重试。');
    }
  }
  return (
    <>
      <div className="detail-ticket">
        <div className="detail-overview">
          <div id="detail-summary" aria-live="polite" aria-atomic="true">
            <LookupSchedule item={item} />
          </div>
          <p className="detail-arrival-note" id="detail-arrival-note" hidden={!explanation}>
            {explanation}
          </p>
          <p className="detail-credential-number">
            预约编号 <strong>{item.id}</strong>
          </p>
          {item.repairNumber && (
            <p className="detail-credential-number">
              历史维修编号 <strong>{item.repairNumber}</strong>
            </p>
          )}
        </div>
        <div className="detail-ticket-credential">
          <figure className="detail-ticket-code">
            <div className="repair-qr detail-qr-content" id="detail-current-qr">
              <RepairQr
                item={item}
                cache={lookup.qrImages}
                imageRef={image}
                onReady={() => setQrReady(true)}
              />
            </div>
            <figcaption>
              <p className="detail-qr-caption" id="detail-qr-caption">
                {arrived ? '到场需核销二维码' : historic ? '历史二维码，仅供查询' : '预约二维码'}
              </p>
              <p className="detail-qr-caption" id="detail-save-hint" hidden={!arrived}>
                建议
                <button
                  data-track="student.lookup.button.save-qr"
                  className="text-btn"
                  id="detail-save-qr"
                  type="button"
                  disabled={!qrReady}
                  onClick={save}
                >
                  保存
                </button>
              </p>
            </figcaption>
          </figure>
        </div>
      </div>
      <div id="detail-repair-record">
        <RepairRecord item={item} />
      </div>
      <div id="detail-information">
        <InformationGroups item={item} photos={false} contacts={false} detail />
      </div>
      <div id="detail-contacts">
        <InformationGroups item={item} device={false} detail />
      </div>
      <DetailAttachments item={item} lookup={lookup} active={active} toast={toast} />
      <RepairHistory item={item} />
      <Operations
        item={item}
        lookup={lookup}
        rebook={rebook}
        hasDraft={hasDraft}
        hasPending={hasPending}
      />
    </>
  );
}
