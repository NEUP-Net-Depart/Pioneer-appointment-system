import { useLayoutEffect, useRef } from 'react';
import { terminalStatuses } from '../../shared/constants.ts';
import { observeDataMotion } from '../../shared/data-motion.ts';
import { formatDate } from '../../shared/time.ts';
import { isAwaitingArrival, statusText, studentStatusClass, timeLabel } from './presentation';
import { AppointmentDetail } from './AppointmentDetail';
import type { Appointment } from './types';
import type { Lookup } from './use-lookup';

function RecordCard({ item, detail }: { item: Appointment; detail: (id: string) => void }) {
  const awaiting = isAwaitingArrival(item);
  const location = item.location || item.locationSnapshot || '维修地点待确认';
  return (
    <button
      data-track="student.lookup.button.1"
      type="button"
      className="student-record"
      data-motion-item="record"
      data-detail-id={item.id}
      onClick={() => detail(item.id)}
    >
      <span className="record-top">
        <strong>{item.deviceType + ' · ' + item.brand}</strong>
        <span className={'status-pill ' + studentStatusClass(item)}>{statusText(item)}</span>
      </span>
      <span className="record-schedule">
        {(awaiting ? (item.servicePaused ? '原预约时间 · ' : '到场时间 · ') : '') +
          formatDate(item.date) +
          ' · ' +
          (timeLabel(item) || '')}
      </span>
      <span className="record-location">
        {item.campus + '校区' + (terminalStatuses.some(status => status === item.status) ? '' : ' · ' + location)}
      </span>
      {awaiting && item.servicePaused && (
        <span className="record-schedule is-error">当天暂停维修</span>
      )}
    </button>
  );
}

export function LookupView({
  lookup,
  active,
  openBooking,
  openList,
  openDetail,
  activation,
  rebook,
  hasDraft,
  hasPending,
  toast
}: {
  lookup: Lookup;
  active: boolean;
  openBooking: () => void;
  openList: () => void;
  openDetail: (id: string) => void;
  activation: number;
  rebook: () => void;
  hasDraft: () => boolean;
  hasPending: () => boolean;
  toast: (message: string) => void;
}) {
  const list = useRef<HTMLDivElement>(null),
    detail = useRef<HTMLDivElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null),
    detailHeading = useRef<HTMLHeadingElement>(null);
  const { entries, item, detailId, detailError, detailNotice, storageError } = lookup;
  const empty = !entries.length && !storageError;
  const current = entries
    .flatMap((row) => (row.item && !terminalStatuses.some(status => status === row.item?.status) ? [row.item] : []))
    .sort((a, b) => (a.date + a.timeSlot).localeCompare(b.date + b.timeSlot));
  const history = entries
    .flatMap((row) => (row.item && terminalStatuses.some(status => status === row.item?.status) ? [row.item] : []))
    .sort((a, b) => (b.date + b.timeSlot).localeCompare(a.date + a.timeSlot));
  const failed = entries.filter((row) => row.message);
  const unknown = entries.filter((row) => !row.item && !row.message);
  const notice = storageError
    ? '此浏览器保存的预约记录暂时无法读取，请重试。'
    : failed.length
      ? '部分预约暂时无法更新，已保留最近确认的信息。'
      : '';
  useLayoutEffect(() => {
    const stopList = list.current && observeDataMotion(list.current);
    const stopDetail = detail.current && observeDataMotion(detail.current);
    return () => {
      stopList?.();
      stopDetail?.();
    };
  }, []);
  useLayoutEffect(() => {
    if (active)
      (detailId === null ? listHeading : detailHeading).current?.focus({ preventScroll: true });
  }, [active, detailId, activation]);
  return (
    <section className={'view' + (active ? ' is-active' : '')} id="lookup-view" data-view="lookup">
      <section id="lookup-list" hidden={detailId !== null}>
        <div className="student-heading title-row">
          <h1 ref={listHeading} tabIndex={-1}>
            我的预约
          </h1>
          <div className="lookup-actions">
            <button
              data-track="student.index.button.46"
              className="text-btn"
              id="refresh-my-appointments"
              type="button"
              hidden={empty}
              onClick={() => void lookup.refresh({ force: true })}
            >
              刷新
            </button>
          </div>
        </div>
        <p id="lookup-notice" className="notice" role="status" hidden={!notice}>
          {notice}
        </p>
        <div ref={list} id="lookup-results" aria-live="polite">
          {empty ? (
            <div className="empty-state">
              <h2>此浏览器暂无预约记录</h2>
              <button
                data-track="student.lookup.button.2"
                type="button"
                className="primary-btn"
                data-book-new=""
                onClick={openBooking}
              >
                去预约
              </button>
            </div>
          ) : (
            <>
              <section className="record-group">
                <h2>当前预约{current.length ? ' · ' + current.length : ''}</h2>
                {current.length ? (
                  current.map((item) => (
                    <RecordCard key={item.id} item={item} detail={openDetail} />
                  ))
                ) : (
                  <p className="field-hint">暂无当前预约。</p>
                )}
              </section>
              <section className="record-group">
                <h2>历史预约{history.length ? ' · ' + history.length : ''}</h2>
                {history.length ? (
                  history.map((item) => (
                    <RecordCard key={item.id} item={item} detail={openDetail} />
                  ))
                ) : (
                  <p className="field-hint">暂无历史预约。</p>
                )}
              </section>
              {unknown.map(({ entry }) => (
                <article key={entry.id} className="notice" aria-busy="true">
                  {entry.id} · 正在读取预约…
                </article>
              ))}
              {failed.map(({ entry, item, message }) => (
                <article key={entry.id} className="notice is-error">
                  <strong>
                    {entry.id} · 暂时无法{item ? '更新' : '读取'}
                  </strong>
                  <p>{message}</p>
                  <button
                    data-track="student.lookup.button.4"
                    className="secondary-btn"
                    type="button"
                    data-retry-id={entry.id}
                    onClick={() => void lookup.refresh({ force: true, onlyId: entry.id })}
                  >
                    重试此预约
                  </button>
                </article>
              ))}
            </>
          )}
        </div>
      </section>
      <section id="lookup-detail" hidden={detailId === null}>
        <div className="detail-page-heading">
          <button
            data-track="student.index.button.47"
            id="back-to-appointments"
            className="text-btn"
            type="button"
            onClick={openList}
          >
            ← 我的预约
          </button>
          <h1 ref={detailHeading} id="appointment-detail-title" tabIndex={-1}>
            预约详情
          </h1>
        </div>
        <p id="detail-notice" className="notice" role="status" hidden={!detailNotice}>
          {detailNotice}
        </p>
        <div ref={detail} id="appointment-detail">
          {item ? (
            <AppointmentDetail
              key={item.id}
              item={item}
              lookup={lookup}
              active={active}
              rebook={rebook}
              hasDraft={hasDraft}
              hasPending={hasPending}
              toast={toast}
            />
          ) : (
            detailId !== null &&
            (detailError ? (
              <section className="detail-section">
                <h2>预约暂时无法读取</h2>
                <p>{detailError}</p>
                <button
                  data-track="student.lookup.button.17"
                  className="secondary-btn"
                  type="button"
                  data-detail-retry=""
                  onClick={() => void lookup.showDetail(detailId, true)}
                >
                  重试
                </button>
              </section>
            ) : (
              <section className="detail-section" aria-busy="true">
                <h2>预约详情</h2>
                <p>正在读取最新预约信息…</p>
              </section>
            ))
          )}
        </div>
      </section>
    </section>
  );
}
