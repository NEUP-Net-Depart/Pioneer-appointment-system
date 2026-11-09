import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useId,
  type ReactNode
} from 'react';
import { Camera, Images, SwitchCamera } from 'lucide-react';

// A hidden route remains mounted for draft continuity, but its dialogs must
// leave the browser top layer until the route is visible again.
export const ActivityContext = createContext(true);
import { appointmentStatusLabel, statusClass } from '../../../shared/constants.js';
import { qrImage } from '../../../shared/zxing.js';
import { createScanner } from './scanner.js';
import { request } from '../request.js';
import { useDataMotion } from '../useDataMotion';

export const api = <T,>(
  url: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<T> => request(url, options);
export const time = (value: string) =>
  new Date(value).toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit'
  });
export function Status({ value, outcome }: { value: string; outcome?: string }) {
  return (
    <span data-motion-value="status" className={`field-status ${statusClass[value] || ''}`}>
      {appointmentStatusLabel(value, outcome) || '状态已更新'}
    </span>
  );
}
export function Notice({ children }: { children: ReactNode }) {
  return children ? (
    <p data-motion-value="text" className="field-notice" role="status">
      {children}
    </p>
  ) : null;
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="field-empty">
      <strong data-motion-value="text">{title}</strong>
      {children && <p data-motion-value="text">{children}</p>}
    </div>
  );
}
let openModalCount = 0,
  previousRootOverflow = '';
export function Modal({
  title,
  children,
  onClose,
  className = '',
  sidePanel = false,
  initialFocus,
  dismissible = true,
  compact = false,
  footer
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  sidePanel?: boolean;
  initialFocus?: string;
  dismissible?: boolean;
  compact?: boolean;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const active = useContext(ActivityContext);
  const bodyRef = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const motion = useRef<Animation | null>(null);
  function dismiss() {
    if (!dismissible || closing.current) return;
    const dialog = ref.current;
    if (
      !dialog ||
      document.hidden ||
      matchMedia('(prefers-reduced-motion: reduce)').matches ||
      dialog.querySelector('video,canvas')
    ) {
      onClose();
      return;
    }
    closing.current = true;
    motion.current?.cancel();
    const animation = dialog.animate(
      [
        { opacity: 1, transform: 'none' },
        { opacity: 0.75, transform: 'none' }
      ],
      { duration: 120, easing: 'ease-in', fill: 'forwards' }
    );
    motion.current = animation;
    animation.finished.then(
      () => {
        // The close callback may keep the dialog open for unsaved edits.
        animation.cancel();
        motion.current = null;
        closing.current = false;
        onClose();
      },
      () => {
        closing.current = false;
      }
    );
  }
  useDataMotion(bodyRef, active);
  useEffect(() => {
    if (!active) {
      ref.current?.close();
      return;
    }
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement;
    dialog.showModal();
    closing.current = false;
    if (
      !document.hidden &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches &&
      !dialog.querySelector('video,canvas')
    )
      motion.current = dialog.animate(
        [
          { opacity: 0.75, transform: 'none' },
          { opacity: 1, transform: 'none' }
        ],
        { duration: 180, easing: 'cubic-bezier(.2,.75,.25,1)' }
      );
    if (openModalCount++ === 0) {
      previousRootOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
    }
    if (initialFocus) dialog.querySelector<HTMLElement>(initialFocus)?.focus();
    return () => {
      motion.current?.cancel();
      dialog.close();
      if (--openModalCount === 0) document.documentElement.style.overflow = previousRootOverflow;
      if (previous && !previous.closest('[hidden]')) previous.focus?.();
    };
  }, [active, initialFocus]);
  return (
    <dialog
      className={`field-modal${sidePanel ? ' field-side-panel' : ''}${compact ? ' workspace-confirm-dialog' : ''}${className ? ` ${className}` : ''}`}
      ref={ref}
      aria-labelledby={titleId}
      onClickCapture={(event) => {
        if (closing.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onSubmitCapture={(event) => {
        if (closing.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
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
        dismiss();
      }}
    >
      <header>
        <h2
          data-motion-value="text"
          id={titleId}
          className={title === '现场核验' ? 'field-state-title' : undefined}
        >
          {title}
        </h2>
        <button type="button" disabled={!dismissible} onClick={dismiss} aria-label="关闭">
          关闭
        </button>
      </header>
      <div ref={bodyRef} className="workspace-dialog-body">
        {children}
      </div>
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
        <img
          className="workspace-loaded-media"
          onLoad={(event) => (event.currentTarget.dataset.ready = 'true')}
          src={url}
          alt={label}
          width="240"
          height="240"
        />
      ) : (
        <p data-motion-value="text">{error || '正在生成二维码…'}</p>
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
        <span data-motion-value="text" className="field-credential-kind">
          {repair ? '客户 · 设备交接' : '工作人员 · 到岗考勤'}
        </span>
        <h3 data-motion-value="text">{title}</h3>
        <p data-motion-value="text">{context}</p>
        {detail && <p data-motion-value="text">{detail}</p>}
      </header>
      <Qr code={code} label={title} />
      <p data-motion-value="text" className="field-credential-instruction">
        {repair
          ? '请维修人员扫描，核对客户与设备后确认接单。'
          : '请使用本人账号扫描工作人员签到码，完成到岗签到。'}
      </p>
    </section>
  );
}

export function Scanner({
  onCode,
  onCandidates,
  onUnrecognized,
  onImage,
  onAutoImage,
  onAlbumImage,
  autoStart = true,
  showAlbum = true,
  cameraLayout = 'standard',
  mode = 'qr'
}: {
  onCode?: (code: string) => void;
  onCandidates?: (codes: string[]) => void;
  onUnrecognized?: (codes: string[]) => void;
  onImage?: (file: File) => void | Promise<void>;
  onAutoImage?: (file: File) => void | Promise<void>;
  onAlbumImage?: (file: File) => Promise<boolean>;
  autoStart?: boolean;
  showAlbum?: boolean;
  cameraLayout?: 'standard' | 'warranty';
  mode?: 'qr' | 'device' | 'photo';
}) {
  const active = useContext(ActivityContext);
  const video = useRef<HTMLVideoElement>(null),
    guide = useRef<HTMLSpanElement>(null),
    status = useRef<HTMLParagraphElement>(null),
    torch = useRef<HTMLButtonElement>(null),
    switcher = useRef<HTMLButtonElement>(null),
    mirror = useRef<HTMLButtonElement>(null);
  const scanner = useRef<ReturnType<typeof createScanner> | null>(null),
    callback = useRef(onCode),
    candidatesCallback = useRef(onCandidates),
    unrecognizedCallback = useRef(onUnrecognized),
    imageCallback = useRef(onImage),
    autoImageCallback = useRef(onAutoImage),
    albumImageCallback = useRef(onAlbumImage);
  callback.current = onCode;
  candidatesCallback.current = onCandidates;
  unrecognizedCallback.current = onUnrecognized;
  imageCallback.current = onImage;
  autoImageCallback.current = onAutoImage;
  albumImageCallback.current = onAlbumImage;
  const [cameraState, setCameraState] = useState('idle');
  useEffect(() => {
    const instance = createScanner({
      video: video.current!,
      guide: guide.current,
      status: status.current!,
      torch: torch.current!,
      switchCamera: switcher.current!,
      mirrorCamera: mirror.current,
      mode,
      onImage: (file) => imageCallback.current?.(file),
      canStart: () => active && !document.hidden,
      onCode: (code) => {
        instance.stop();
        callback.current?.(code);
      },
      onCandidates: (codes) => candidatesCallback.current?.(codes),
      onUnrecognized: (codes) => unrecognizedCallback.current?.(codes),
      onState: setCameraState
    });
    scanner.current = instance;
    if (autoStart && active && !document.hidden) void instance.start();
    const hide = () => {
        if (document.hidden) instance.stop();
        else if (mode === 'device' && autoStart && active) void instance.start();
      },
      stop = () => instance.stop();
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', stop);
    return () => {
      instance.dispose();
      scanner.current = null;
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', stop);
    };
  }, [autoStart, active, mode]);
  useEffect(() => {
    if (mode !== 'photo' || cameraState !== 'running' || !onAutoImage || !active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const recognize = async () => {
      if (cancelled || document.hidden) return;
      try {
        const file = await scanner.current?.snapshot();
        if (file && !cancelled) await autoImageCallback.current?.(file);
      } catch {
        // A frame can be unavailable while the camera settles or switches lenses.
      }
      if (!cancelled) timer = setTimeout(recognize, 7000);
    };
    timer = setTimeout(recognize, 2500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, cameraState, mode, !!onAutoImage]);
  return (
    <div className="field-scanner" data-mode={mode} data-layout={cameraLayout}>
      <div className="field-camera">
        <video ref={video} playsInline muted />
        <span ref={guide} className="field-camera-guide" aria-hidden="true">
          <span className="field-camera-hint">
            {mode === 'qr' ? '将二维码放入框内' : '对准机身 S/N 标签'}
          </span>
        </span>
        {cameraLayout === 'warranty' && (
          <div className="warranty-camera-bar">
            <label className="warranty-camera-control" title="从相册选择" aria-label="从相册选择">
              <Images aria-hidden="true" size={22} />
              <input
                type="file"
                accept="image/*"
                aria-label={mode === 'photo' ? '选择设备标签照片' : '选择设备标签图片'}
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;
                  try {
                    if (albumImageCallback.current) {
                      const wasRunning = cameraState === 'running';
                      scanner.current?.stop();
                      const found = await albumImageCallback.current(file);
                      if (!found && wasRunning) await scanner.current?.start();
                    } else await scanner.current?.image(file, true);
                  } catch (error) {
                    if (status.current) status.current.textContent = (error as Error).message;
                    if (cameraState === 'running') await scanner.current?.start();
                  }
                }}
              />
            </label>
            {mode === 'photo' ? (
              <button
                type="button"
                className="warranty-shutter"
                aria-label="拍摄识别"
                title="拍摄识别"
                disabled={cameraState !== 'running'}
                onClick={async () => {
                  try {
                    const file = await scanner.current?.snapshot();
                    if (file) await imageCallback.current?.(file);
                  } catch (error) {
                    if (status.current) status.current.textContent = (error as Error).message;
                  }
                }}
              >
                <Camera aria-hidden="true" size={24} />
              </button>
            ) : (
              <span className="warranty-camera-spacer" aria-hidden="true" />
            )}
            <button type="button" ref={switcher} disabled title="切换摄像头" aria-label="切换镜头">
              <SwitchCamera aria-hidden="true" size={22} />
            </button>
          </div>
        )}
      </div>
      {cameraLayout === 'warranty' && (
        <button type="button" ref={torch} hidden aria-hidden="true" />
      )}
      {cameraLayout !== 'warranty' && mode !== 'qr' && (
        <div className="record-options field-camera-tools">
          <button type="button" ref={mirror} aria-pressed="false">
            镜像预览
          </button>
          <button type="button" ref={switcher} disabled title="正在检测可用镜头">
            切换镜头
          </button>
          <button type="button" ref={torch} disabled>
            补光
          </button>
        </div>
      )}
      <p ref={status} role="status">
        {autoStart ? '正在准备摄像头…' : '点击开启摄像头，也可以从相册识别'}
      </p>
      {cameraLayout !== 'warranty' && (mode !== 'device' || showAlbum) && (
        <div className="field-actions">
          {mode !== 'device' && (
            <button
              type="button"
              className="field-primary"
              disabled={cameraState === 'opening'}
              onClick={async () => {
                if (mode === 'photo' && cameraState === 'running') {
                  try {
                    await scanner.current?.capture();
                  } catch (error) {
                    if (status.current) status.current.textContent = (error as Error).message;
                  }
                } else if (cameraState === 'running') scanner.current?.stop();
                else void scanner.current?.start();
              }}
            >
              {cameraState === 'opening'
                ? '正在开启…'
                : cameraState === 'running'
                  ? mode === 'photo'
                    ? '拍摄识别'
                    : '关闭摄像头'
                  : '开启摄像头'}
            </button>
          )}
          {showAlbum && (
            <label className="field-file-button">
              {mode === 'photo' ? '从相册选照片' : mode === 'device' ? '相册扫码' : '相册识别'}
              <input
                type="file"
                accept="image/*"
                aria-label={
                  mode === 'photo'
                    ? '选择设备标签照片'
                    : mode === 'device'
                      ? '选择设备标签图片'
                      : '相册识别'
                }
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (file)
                    try {
                      await scanner.current?.image(file);
                    } catch (error) {
                      if (status.current) status.current.textContent = (error as Error).message;
                    }
                  event.target.value = '';
                }}
              />
            </label>
          )}
          {mode === 'qr' && (
            <button type="button" ref={switcher} disabled title="正在检测可用镜头">
              切换镜头
            </button>
          )}
          {mode === 'qr' && (
            <button type="button" ref={torch} disabled>
              补光
            </button>
          )}
        </div>
      )}
    </div>
  );
}
