import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { reportClientError, trackPage } from '../../shared/telemetry-client.js';
import { parsePrivateLink } from './credentials';
import { AgreementDialog } from './AgreementDialog';
import { BookingNoticeDialog } from './BookingNotices';
import { BookingView } from './BookingView';
import { DialogContext, useDialogs, useDialogState } from './dialogs';
import { LookupView } from './LookupView';
import { PhotoDialog } from './PhotoDialog';
import { SignatureDialog } from './SignatureDialog';
import type { Route } from './types';
import { useBooking } from './use-booking';
import { useLookup } from './use-lookup';

function StudentApp() {
  const { close } = useDialogs();
  const [route, setRoute] = useState<Route>({ kind: 'booking' });
  const [activation, setActivation] = useState(0);
  const [toast, setToast] = useState({ message: '', shown: false });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastHandled = useRef<string | undefined>(undefined);
  const ready = activation > 0;
  const bookingActive = route.kind === 'booking';
  const lookup = useLookup((id) => activate({ kind: 'detail', id }), showToast);
  const booking = useBooking(bookingActive, lookup.add, activation);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  function showToast(message: string) {
    setToast({ message, shown: true });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast({ message, shown: false }), 2400);
  }
  function activate(target: Route, record = true) {
    const fragment =
      target.kind === 'detail' ? '#detail=' + encodeURIComponent(target.id) : '#' + target.kind;
    if (record && location.hash !== fragment) history.pushState(null, '', fragment);
    lastHandled.current = location.hash;
    trackPage('student.' + target.kind);
    close();
    lookup.setActive(target.kind !== 'booking');
    setRoute(target);
    setActivation((count) => count + 1);
  }
  function navigate(target: Route, record = true) {
    activate(target, record);
    lookup.setImportNotice('');
    if (target.kind === 'lookup') void lookup.showList();
    else if (target.kind === 'detail') void lookup.showDetail(target.id);
  }
  function importPrivateLink() {
    const entry = parsePrivateLink(location.href);
    history.replaceState(null, '', location.pathname + '#lookup');
    navigate({ kind: 'lookup' }, false);
    if (entry) void lookup.importPrivateLink(entry);
    else lookup.setImportNotice('预约链接格式不正确，请使用完整私人查询链接。');
  }

  const navigation = useRef({ navigate, importPrivateLink });
  useLayoutEffect(() => {
    navigation.current = { navigate, importPrivateLink };
  });
  useLayoutEffect(() => {
    if (activation) window.scrollTo({ top: 0, behavior: 'auto' });
  }, [activation]);
  useEffect(() => {
    function readHash() {
      const fragment = location.hash;
      if (fragment === lastHandled.current) return;
      if (fragment.includes('appointment=') || fragment.includes('access=')) {
        navigation.current.importPrivateLink();
        return;
      }
      if (fragment.startsWith('#detail=')) {
        let id: string;
        try {
          id = decodeURIComponent(fragment.slice(8));
        } catch {
          history.replaceState(null, '', '#lookup');
          navigation.current.navigate({ kind: 'lookup' }, false);
          return;
        }
        navigation.current.navigate({ kind: 'detail', id }, false);
      } else if (fragment === '#lookup') navigation.current.navigate({ kind: 'lookup' }, false);
      else {
        if (fragment && fragment !== '#booking')
          history.replaceState(null, '', location.pathname + location.search);
        navigation.current.navigate({ kind: 'booking' }, false);
      }
    }
    window.addEventListener('popstate', readHash);
    window.addEventListener('hashchange', readHash);
    // Only the surviving effect should start a request when StrictMode replays setup.
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) readHash();
    });
    return () => {
      disposed = true;
      window.removeEventListener('popstate', readHash);
      window.removeEventListener('hashchange', readHash);
    };
  }, []);
  const openBooking = () => navigate({ kind: 'booking' });
  const openList = () => navigate({ kind: 'lookup' });
  const openDetail = (id: string) => navigate({ kind: 'detail', id });
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <a data-track="student.index.a.1" className="brand" href="/">
            <img
              className="organization-logo"
              src="/assets/organization-logo.jpg"
              alt="先锋网络中心"
            />
            <span>
              <strong>先锋网络中心硬件部</strong>
            </span>
          </a>
          <nav className="main-nav" aria-label="学生预约导航">
            <button
              data-track="student.index.button.2"
              className={'nav-link' + (ready && bookingActive ? ' is-active' : '')}
              type="button"
              data-view-link="booking"
              aria-current={ready && bookingActive ? 'page' : undefined}
              onClick={openBooking}
            >
              预约维修
            </button>
            <button
              data-track="student.index.button.3"
              className={'nav-link' + (ready && !bookingActive ? ' is-active' : '')}
              type="button"
              data-view-link="lookup"
              aria-current={ready && !bookingActive ? 'page' : undefined}
              onClick={openList}
            >
              我的预约
            </button>
          </nav>
        </div>
      </header>
      <main className="student-shell">
        <p id="student-loading" className="notice" role="status" hidden={ready}>
          正在打开页面…
        </p>
        {ready && (
          <>
            <BookingView
              booking={booking}
              active={bookingActive}
              list={openList}
              detail={(item) => openDetail(item.id)}
            />
            <LookupView
              lookup={lookup}
              active={!bookingActive}
              activation={activation}
              openBooking={openBooking}
              openList={openList}
              openDetail={openDetail}
              hasDraft={booking.hasDraft}
              hasPending={booking.hasPending}
              toast={showToast}
              rebook={() => {
                if (booking.reset()) openBooking();
              }}
            />
          </>
        )}
      </main>
      {ready && (
        <>
          <BookingNoticeDialog notices={booking.announcements} />
          <SignatureDialog onConfirm={booking.confirmSignature} />
          <AgreementDialog />
          <PhotoDialog />
          <div className={'toast' + (toast.shown ? ' show' : '')} id="toast" role="status">
            {toast.message}
          </div>
        </>
      )}
    </>
  );
}
function StudentRoot() {
  const dialogs = useDialogState();
  return (
    <DialogContext.Provider value={dialogs}>
      <StudentApp />
    </DialogContext.Provider>
  );
}

const root = document.getElementById('student-react-root');
if (!root) throw new Error('Missing student entry');
hydrateRoot(
  root,
  <StrictMode>
    <StudentRoot />
  </StrictMode>,
  {
    onUncaughtError: (error) => reportClientError(error, 'REACT_RENDER_ERROR'),
    onRecoverableError: (error) => reportClientError(error, 'REACT_RENDER_ERROR')
  }
);
