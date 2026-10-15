import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { statusLabels, statusClass } from "../../../shared/constants.js";
import { qrImage } from "../../../shared/zxing.js";
import { createScanner } from "../../staff/scanner.js";
import { request } from "../request.js";

export const api = <T,>(
  url: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> => request(url, options);
export const time = (value: string) =>
  new Date(value).toLocaleTimeString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
  });
export function Status({ value }: { value: string }) {
  return (
    <span className={`field-status ${statusClass[value] || ""}`}>
      {statusLabels[value] ||
        {
          available: "空闲",
          repairing: "维修中",
          unsigned: "待签到",
          away: "暂时离岗",
          off_duty: "已结束",
          closed: "非工作时间",
        }[value] ||
        "状态已更新"}
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
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="field-empty">
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  sidePanel = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  sidePanel?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement;
    dialog.showModal();
    return () => {
      dialog.close();
      previous?.focus?.();
    };
  }, []);
  return (
    <dialog
      className={`field-modal${sidePanel ? ' field-side-panel' : ''}`}
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button type="button" onClick={onClose} aria-label="关闭">
          关闭
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Qr({ code, label }: { code: string; label: string }) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true,
      objectUrl = "";
    setUrl("");
    qrImage(code)
      .then((blob) => {
        if (active) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      })
      .catch(() => setError("二维码生成失败，请关闭后重试"));
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
        <p>{error || "正在生成二维码…"}</p>
      )}
      <p>{label}</p>
    </div>
  );
}
export function Scanner({ onCode }: { onCode: (code: string) => void }) {
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
      onCode: (code) => callback.current(code),
      onState: (state) =>
        setRunning(state === "running" || state === "opening"),
    });
    scanner.current = instance;
    const hide = () => {
        if (document.hidden) instance.stop();
      },
      stop = () => instance.stop();
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", stop);
    return () => {
      instance.stop();
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", stop);
    };
  }, []);
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
          onClick={() =>
            running ? scanner.current?.stop() : scanner.current?.start()
          }
        >
          {running ? "关闭摄像头" : "开启摄像头"}
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
              event.target.value = "";
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
