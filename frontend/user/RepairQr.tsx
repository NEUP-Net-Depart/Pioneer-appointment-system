import { useEffect, useRef, useState, type Ref } from 'react';
import { qrImage } from '../../shared/zxing.js';
import { appointmentPath, studentJson } from './api';
import { credentialHeaders } from './credentials';
import type { Credential } from './types';

export type QrCache = Map<string, Promise<Blob>>;

async function loadRepairQrImage(endpoint: string, accessToken: string) {
  const { code } = await studentJson<{ code: string }>(endpoint, {
    headers: credentialHeaders({ id: '', accessToken })
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      qrImage(code),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('二维码生成超时')), 15000);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function RepairQr({
  item,
  parentId,
  cache: sharedCache,
  imageRef,
  onReady
}: {
  item: Credential;
  parentId?: string;
  cache?: QrCache;
  imageRef?: Ref<HTMLImageElement>;
  onReady?: () => void;
}) {
  const localCache = useRef<QrCache>(new Map());
  const cache = sharedCache ?? localCache.current;
  const { id, accessToken } = item;
  const endpoint = parentId
    ? appointmentPath(parentId) + '/related/' + encodeURIComponent(id) + '/scan-code'
    : appointmentPath(id) + '/scan-code';
  const key = endpoint + '/' + accessToken;
  const [retry, setRetry] = useState(0);
  const [image, setImage] = useState<{
    key: string;
    retry: number;
    src?: string;
    failed?: boolean;
  } | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let disposed = false,
      url: string | undefined;
    setReady(false);
    let pending = cache?.get(key);
    if (!pending) {
      pending = loadRepairQrImage(endpoint, accessToken);
      cache?.set(key, pending);
    }
    void pending.then(
      (blob) => {
        if (disposed) return;
        url = URL.createObjectURL(blob);
        setImage({ key, retry, src: url });
      },
      () => {
        if (cache?.get(key) === pending) cache?.delete(key);
        if (!disposed) setImage({ key, retry, failed: true });
      }
    );
    return () => {
      disposed = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [accessToken, cache, endpoint, key, retry]);

  const previous = image?.key === key ? image : null;
  const view = previous?.retry === retry ? previous : null;
  return (
    <>
      <img
        ref={imageRef}
        alt={id + ' 维修二维码'}
        width={240}
        height={240}
        hidden={!ready}
        src={view?.src}
        onLoad={() => {
          setReady(true);
          if (view?.src) URL.revokeObjectURL(view.src);
          onReady?.();
        }}
        onError={() => {
          cache?.delete(key);
          setReady(false);
          setImage({ key, retry, failed: true });
        }}
      />
      <p className="repair-qr-status" role="status">
        {ready
          ? ''
          : view?.failed
            ? '二维码暂不可用，可向工作人员报预约编号。'
            : '正在生成维修二维码…'}
      </p>
      <button
        data-track="student.repair-qr.dynamic.button"
        type="button"
        className="secondary-btn"
        hidden={ready || !previous?.failed}
        disabled={previous?.retry !== retry}
        onClick={() => setRetry((value) => value + 1)}
      >
        重新生成二维码
      </button>
    </>
  );
}
