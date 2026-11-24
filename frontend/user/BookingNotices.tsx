import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useCurrent } from './use-current';
import { DialogLayer, useDialogs } from './dialogs';
import type { Notice } from './types';

const bookingNotices = (notices: Notice[]) => notices.filter((item) => item.type !== 'suspension');
const versionKey = (campus: string, item: Notice) => campus + '/' + item.id + '/' + item.revision;

export function useBookingNotices(
  campus: string,
  notices: Notice[],
  home: boolean,
  active: boolean
) {
  const { dialog, open, close } = useDialogs();
  const [read, setRead, currentRead] = useCurrent(new Set<string>());
  const [error, setError] = useState(false);
  const shown = useRef(new Set<string>());
  const items = bookingNotices(notices);
  const fingerprint = JSON.stringify([campus, items]);
  const last = useRef(fingerprint);
  const inline = useRef<HTMLElement>(null),
    modal = useRef<HTMLDivElement>(null);
  const target = useRef<string | undefined>(undefined);
  const pending = useRef<{ id: string; fingerprint: string } | null>(null);
  const visible = () => home && active && !document.hidden;
  const accepted = (item: Notice) => read.has(versionKey(campus, item));
  const findMissing = (items: Notice[], campus: string) =>
    items.find((item) => item.important && !currentRead.current.has(versionKey(campus, item)));
  function focusNotice(parent: HTMLElement | null, id: string) {
    const button = [
      ...(parent?.querySelectorAll<HTMLButtonElement>('[data-read-notice]') || [])
    ].find((node) => node.dataset.readNotice === id);
    button?.focus({ preventScroll: true });
    button?.scrollIntoView({ block: 'center', behavior: 'auto' });
  }
  function openNotice(item?: Notice) {
    if (!visible()) return;
    for (const notice of items)
      if (notice.displayMode === 'modal') shown.current.add(versionKey(campus, notice));
    if (item && dialog?.kind === 'notice') focusNotice(modal.current, item.id);
    else {
      target.current = item?.id;
      open({ kind: 'notice' });
    }
  }
  function autoOpen() {
    if (
      visible() &&
      items.some(
        (item) => item.displayMode === 'modal' && !shown.current.has(versionKey(campus, item))
      )
    )
      openNotice();
  }
  useLayoutEffect(() => {
    if (last.current !== fingerprint) {
      last.current = fingerprint;
      setError(false);
      if (dialog?.kind === 'notice') close();
    }
    if (!visible() && dialog?.kind === 'notice') close();
    if (pending.current && pending.current.fingerprint === fingerprint && visible()) {
      const item = items.find((notice) => notice.id === pending.current?.id);
      pending.current = null;
      if (item) {
        setError(true);
        if (item.displayMode === 'modal') openNotice(item);
        else focusNotice(inline.current, item.id);
        return;
      }
    }
    autoOpen();
  }, [fingerprint, home, active]);
  useLayoutEffect(() => {
    if (dialog?.kind === 'notice' && target.current) {
      focusNotice(modal.current, target.current);
      target.current = undefined;
    }
  }, [dialog]);
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) {
        if (dialog?.kind === 'notice') close();
      } else autoOpen();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, [dialog, fingerprint, home, active]);

  return {
    inline,
    modal,
    items,
    accepted,
    openNotice,
    error,
    read(item: Notice) {
      setRead(new Set(currentRead.current).add(versionKey(campus, item)));
      if (items.every((notice) => !notice.important || accepted(notice) || notice.id === item.id))
        setError(false);
    },
    missing: (values: Notice[], at: string) => !!findMissing(bookingNotices(values), at),
    confirmed: (values: Notice[], at: string) =>
      bookingNotices(values)
        .filter((item) => item.important && currentRead.current.has(versionKey(at, item)))
        .map(({ id, revision }) => ({ id, revision })),
    confirm(values: Notice[], at: string, show = visible()) {
      const available = bookingNotices(values);
      const item = findMissing(available, at);
      if (!item) return true;
      if (!show) return false;
      const nextFingerprint = JSON.stringify([at, available]);
      if (fingerprint !== nextFingerprint || !home) {
        pending.current = { id: item.id, fingerprint: nextFingerprint };
      } else {
        setError(true);
        if (item.displayMode === 'modal') openNotice(item);
        else focusNotice(inline.current, item.id);
      }
      return false;
    },
    reset() {
      if (dialog?.kind === 'notice') close();
      setRead(new Set());
      shown.current.clear();
      pending.current = null;
      setError(false);
    }
  };
}

export type BookingAnnouncements = ReturnType<typeof useBookingNotices>;

function NoticeArticle({ item, notices }: { item: Notice; notices: BookingAnnouncements }) {
  const read = notices.accepted(item);
  return (
    <article
      className={'booking-notice' + (item.important ? ' is-important' : '')}
      data-announcement={item.id}
    >
      <h3>
        {item.important ? '必读 · ' : ''}
        {item.title}
      </h3>
      <p>{item.content}</p>
      {item.important && (
        <button
          data-track="student.booking-notices.button.1"
          type="button"
          className="secondary-btn booking-notice-read"
          data-read-notice={item.id}
          aria-pressed={read}
          onClick={() => notices.read(item)}
        >
          {read ? '已阅读并确认' : '我已阅读并确认此公告'}
        </button>
      )}
    </article>
  );
}
export function BookingNotices({ notices }: { notices: BookingAnnouncements }) {
  return (
    <section
      ref={notices.inline}
      id="booking-notices"
      className="booking-notices"
      aria-label="校区预约公告"
      hidden={!notices.items.length}
    >
      <p id="booking-notice-error" className="field-error" role="alert" hidden={!notices.error}>
        请先点击阅读按钮，确认已阅读必读公告后再继续。
      </p>
      {notices.items.map((item) =>
        item.displayMode === 'modal' ? (
          <article key={item.id} className="booking-notice booking-notice-preview">
            <div>
              <h3>
                {item.important ? '必读 · ' : ''}
                {item.title}
              </h3>
              <span>
                {item.important
                  ? notices.accepted(item)
                    ? '已阅读并确认'
                    : '阅读确认后可继续预约'
                  : '校区公告'}
              </span>
            </div>
            <button
              data-track="student.booking-notices.button.2"
              type="button"
              className="secondary-btn"
              data-open-notices={item.id}
              onClick={() => notices.openNotice(item)}
            >
              查看公告
            </button>
          </article>
        ) : (
          <NoticeArticle key={item.id} item={item} notices={notices} />
        )
      )}
    </section>
  );
}
export function BookingNoticeDialog({ notices }: { notices: BookingAnnouncements }) {
  const { close } = useDialogs();
  return (
    <DialogLayer kind="notice" id="booking-notice-modal">
      <section
        data-track="student.index.section.48"
        className="modal booking-notice-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-notice-title"
      >
        <h2 id="booking-notice-title">校区预约公告</h2>
        <div ref={notices.modal} id="booking-notice-body" className="booking-notices">
          {notices.items
            .filter((item) => item.displayMode === 'modal')
            .map((item) => (
              <NoticeArticle key={item.id} item={item} notices={notices} />
            ))}
        </div>
        <div className="modal-actions">
          <button
            data-track="student.index.button.49"
            id="close-booking-notices"
            type="button"
            className="primary-btn"
            onClick={close}
          >
            返回预约
          </button>
        </div>
      </section>
    </DialogLayer>
  );
}
