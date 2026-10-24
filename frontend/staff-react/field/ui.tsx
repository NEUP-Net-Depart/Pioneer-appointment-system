import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useId,
  type ReactNode
} from 'react';

// A hidden route remains mounted for draft continuity, but its dialogs must
// leave the browser top layer until the route is visible again.
export const ActivityContext = createContext(true);
import { statusLabels, statusClass } from '../../../shared/constants.js';
import { receptionLabels } from '../../../shared/reception.js';
import { qrImage } from '../../../shared/zxing.js';
import { createScanner } from './scanner.js';
import { request } from '../request.js';

export const api = <T,>(
  url: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {}
): Promise<T> => request(url, options);
export const time = (value: string) =>
  new Date(value).toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit'
  });
export function Status({ value }: { value: string }) {
  return (
    <span className={`field-status ${statusClass[value] || ''}`}>
      {statusLabels[value] ||
        receptionLabels[value] ||
        {
          pending: '待接手',
          available: '空闲',
          repairing: '维修中',
          unsigned: '待签到',
          on_leave: '已请假',
          away: '暂时离岗',
          off_duty: '已结束',
          closed: '非工作时间'
        }[value] ||
        '状态已更新'}
    </span>
  );
}
export function Notice({ children }: { children: ReactNode }) {
  return children ? (
    <p className="field-notice" role="status">
      {children}
    </p>
  ) : null;
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="field-empty">
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}
let openModalCount = 0,
  previousRootOverflow = '';
export function Modal({
  title,
  children,
  onClose,
  sidePanel = false,
  initialFocus,
  dismissible = true,
  compact = false,
  footer
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  sidePanel?: boolean;
  initialFocus?: string;
  dismissible?: boolean;
  compact?: boolean;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const active = useContext(ActivityContext);
  useEffect(() => {
    if (!active) {
      ref.current?.close();
      return;
    }
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement;
    dialog.showModal();
    if (openModalCount++ === 0) {
      previousRootOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
    }
    if (initialFocus) dialog.querySelector<HTMLElement>(initialFocus)?.focus();
    return () => {
      dialog.close();
      if (--openModalCount === 0) document.documentElement.style.overflow = previousRootOverflow;
      if (previous && !previous.closest('[hidden]')) previous.focus?.();
    };
  }, [active, initialFocus]);
  return (
    <dialog
      className={`field-modal${sidePanel ? ' field-side-panel' : ''}${compact ? ' workspace-confirm-dialog' : ''}`}
      ref={ref}
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        event.stopPropagation();
        const controls = [
          ...ref.current!.querySelectorAll<HTMLElement>(
            'button,input,select,textarea,a[href],summary,[tabindex]'
          )
        ].filter(
          (node) => node.tabIndex >= 0 && !node.matches(':disabled') && node.getClientRects().length
        );
        const first = controls[0],
          last = controls.at(-1);
        if (!first) {
          event.preventDefault();
          return;
        }
        if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === ref.current)
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (dismissible) onClose();
      }}
    >
      <header>
        <h2 id={titleId} className={title === '现场核验' ? 'field-state-title' : undefined}>
          {title}
        </h2>
        <button type="button" disabled={!dismissible} onClick={onClose} aria-label="关闭">
          关闭
        </button>
      </header>
      <div className="workspace-dialog-body">{children}</div>
      {footer && <footer className="workspace-dialog-footer">{footer}</footer>}
    </dialog>
  );
}
export function Qr({ code, label }: { code: string; label: string }) {
  const [url, setUrl] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true,
      objectUrl = '';
    setUrl('');
    qrImage(code)
      .then((blob) => {
        if (active) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      })
      .catch(() => setError('二维码生成失败，请关闭后重试'));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [code]);
  return (
    <div className="field-qr">
      {url ? (
        <img src={url} alt={label} width="240" height="240" />
      ) : (
        <p>{error || '正在生成二维码…'}</p>
      )}
    </div>
  );
}
export function CredentialCard({
  kind,
  code,
  context,
  detail
}: {
  kind: 'repair' | 'attendance';
  code: string;
  context: string;
  detail?: string;
}) {
  const repair = kind === 'repair';
  const title = repair ? '客户维修码' : '工作人员到岗签到码';
  return (
    <section className={`field-credential field-credential--${kind}`} aria-label={title}>
      <header>
        <span className="field-credential-kind">
          {repair ? '客户 · 设备交接' : '工作人员 · 到岗考勤'}
        </span>
        <h3>{title}</h3>
        <p>{context}</p>
        {detail && <p>{detail}</p>}
      </header>
      <Qr code={code} label={title} />
      <p className="field-credential-instruction">
        {repair
          ? '请维修人员扫描，核对客户与设备后确认接单。'
          : '请工作人员使用本人账号扫描，核对校区与场次后确认签到。'}
      </p>
      <small>
        {repair ? '确认接单后才绑定维修人员。' : '记录本人到岗，不创建或绑定客户工单。'}
      </small>
    </section>
  );
}

export function Scanner({
  onCode,
  autoStart = true
}: {
  onCode: (code: string) => void;
  autoStart?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null),
    status = useRef<HTMLParagraphElement>(null),
    torch = useRef<HTMLButtonElement>(null),
    switcher = useRef<HTMLButtonElement>(null);
  const scanner = useRef<ReturnType<typeof createScanner> | null>(null),
    callback = useRef(onCode);
  callback.current = onCode;
  const [running, setRunning] = useState(false);
  useEffect(() => {
    const instance = createScanner({
      video: video.current!,
      status: status.current!,
      torch: torch.current!,
      switchCamera: switcher.current!,
      onCode: (code) => {
        instance.stop();
        callback.current(code);
      },
      onState: (state) => setRunning(state === 'running' || state === 'opening')
    });
    scanner.current = instance;
    if (autoStart && !document.hidden) void instance.start();
    const hide = () => {
        if (document.hidden) instance.stop();
      },
      stop = () => instance.stop();
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', stop);
    return () => {
      instance.stop();
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', stop);
    };
  }, [autoStart]);
  return (
    <div className="field-scanner">
      <div className="field-camera">
        <video ref={video} playsInline muted />
        <span aria-hidden="true">
          ┌<span>将二维码放入框内</span>┘
        </span>
      </div>
      <p ref={status} role="status">
        点击开启摄像头，也可以从相册识别
      </p>
      <div className="field-actions">
        <button
          className="field-primary"
          onClick={() => (running ? scanner.current?.stop() : scanner.current?.start())}
        >
          {running ? '关闭摄像头' : '开启摄像头'}
        </button>
        <label className="field-file-button">
          相册识别
          <input
            type="file"
            accept="image/*"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (file)
                try {
                  await scanner.current?.image(file);
                } catch (error) {
                  status.current!.textContent = (error as Error).message;
                }
              event.target.value = '';
            }}
          />
        </label>
        <button ref={switcher}>切换镜头</button>
        <button ref={torch} disabled>
          补光
        </button>
      </div>
    </div>
  );
}
