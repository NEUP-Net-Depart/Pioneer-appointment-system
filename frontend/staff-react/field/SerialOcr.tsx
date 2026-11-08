import { useContext, useEffect, useRef, useState } from 'react';
import { deviceSerialCandidatesFromText } from '../../../shared/warranty.js';
import { ActivityContext, Notice, Scanner } from './ui';

export function SerialOcr({
  mode,
  onSerial,
  onBusy,
  onAlbumImage
}: {
  mode: 'scan' | 'ocr';
  onSerial: (value: string) => void;
  onBusy: (value: boolean) => void;
  onAlbumImage: (file: File) => Promise<boolean>;
}) {
  const active = useContext(ActivityContext);
  const job = useRef<AbortController | null>(null);
  const copyResult = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [candidates, setCandidates] = useState<string[]>([]);
  const [raw, setRaw] = useState('');
  const [copyFailed, setCopyFailed] = useState(false);
  useEffect(() => {
    if (mode !== 'scan' || !raw) return;
    copyResult.current?.scrollIntoView({
      block: 'nearest',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    });
  }, [mode, raw]);
  useEffect(
    () => () => {
      job.current?.abort();
      onBusy(false);
    },
    [onBusy]
  );
  useEffect(() => {
    if (!active) {
      job.current?.abort();
      job.current = null;
      setBusy(false);
      onBusy(false);
      setRaw('');
      setCandidates([]);
    }
  }, [active, onBusy]);
  function cancel() {
    job.current?.abort();
    job.current = null;
    setBusy(false);
    onBusy(false);
    setMessage('文字识别已取消。');
  }
  async function read(file?: File, automatic = false) {
    if (!file) return;
    if (automatic && job.current) return;
    job.current?.abort();
    const controller = new AbortController();
    job.current = controller;
    if (!automatic) {
      setBusy(true);
      onBusy(true);
      setCandidates([]);
      setRaw('');
      setMessage('正在读取标签照片…');
    }
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const { recognizeSerialPhoto } = await import('./serial-ocr.js');
      if (controller.signal.aborted) throw new DOMException('Canceled', 'AbortError');
      const result = await recognizeSerialPhoto(file, {
        signal: controller.signal,
        onProgress: (value) => {
          if (!automatic && job.current === controller) setMessage(value);
        }
      });
      if (job.current !== controller || controller.signal.aborted) return;
      const values = deviceSerialCandidatesFromText(result.text);
      if (automatic && !result.text.trim()) return;
      setCandidates(values);
      setRaw(result.text);
      setCopyFailed(false);
      setMessage(
        values.length
          ? result.labelled
            ? '识别到序号候选，请核对易混淆字符后采用。'
            : '识别到可能的编号，请对照机身“序号 / S/N”后采用。'
          : result.text.trim()
            ? '识别到文字，但未确定序号。可复制文字后手动填写。'
            : '未识别到文字，请靠近序号标签重新拍摄。'
      );
    } catch (error) {
      if (!automatic && job.current === controller)
        setMessage(
          controller.signal.aborted
            ? '文字识别已取消或超时，请重试。'
            : error instanceof Error
              ? error.message
              : '文字识别失败，请重拍或手动输入。'
        );
    } finally {
      clearTimeout(timer);
      if (job.current === controller) {
        job.current = null;
        if (!automatic) {
          setBusy(false);
          onBusy(false);
        }
      }
    }
  }
  return (
    <section
      className="warranty-ocr"
      aria-label={mode === 'scan' ? '序列号二维码扫描' : '序列号文字识别'}
      aria-busy={busy}
    >
      <fieldset className="warranty-camera-controls" disabled={busy}>
        <Scanner
          mode={mode === 'scan' ? 'device' : 'photo'}
          cameraLayout="warranty"
          onAutoImage={mode === 'ocr' ? (file) => read(file, true) : undefined}
          onAlbumImage={onAlbumImage}
          onCode={onSerial}
          onCandidates={(values) => {
            setCandidates(values);
            setRaw('');
            setMessage('识别到多个编号，请核对机身 S/N 后选择。');
          }}
          onUnrecognized={(values) => {
            setRaw(values.join('\n'));
            setCopyFailed(false);
            setMessage('');
          }}
          onImage={(file) => read(file)}
        />
      </fieldset>
      <div role="status" aria-live="polite">
        <Notice>{message}</Notice>
      </div>
      {busy && (
        <button type="button" onClick={cancel}>
          取消识别
        </button>
      )}
      {candidates.length > 0 && (
        <div className="warranty-ocr-actions">
          {candidates.map((value) => (
            <button key={value} type="button" onClick={() => onSerial(value)}>
              采用 {value}
            </button>
          ))}
        </div>
      )}
      {raw && (
        <div
          className="warranty-scan-result"
          aria-label={mode === 'scan' ? '扫码结果' : 'OCR 识别文字'}
        >
          <strong>{mode === 'scan' ? '扫码结果' : '识别文字'}</strong>
          <span>{mode === 'scan' ? '未识别为 S/N' : '请核对机身序号'}</span>
          <pre>{raw}</pre>
          <button
            ref={copyResult}
            type="button"
            className="field-primary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(raw);
                setCopyFailed(false);
                setMessage(mode === 'scan' ? '扫码内容已复制。' : '识别文字已复制。');
              } catch {
                setCopyFailed(true);
                setMessage('浏览器未允许复制，请长按上方内容手动复制。');
              }
            }}
          >
            {copyFailed ? '重试复制' : mode === 'scan' ? '复制扫码内容' : '复制识别文字'}
          </button>
        </div>
      )}
    </section>
  );
}
