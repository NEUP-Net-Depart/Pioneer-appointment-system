import { useContext, useEffect, useRef, useState } from 'react';
import { deviceSerialCandidatesFromText } from '../../../shared/warranty.js';
import { ActivityContext, Notice } from './ui';

export function SerialOcr({
  onSerial,
  onBusy
}: {
  onSerial: (value: string) => void;
  onBusy: (value: boolean) => void;
}) {
  const active = useContext(ActivityContext);
  const job = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [candidates, setCandidates] = useState<string[]>([]);
  const [raw, setRaw] = useState('');
  const photo = useRef<HTMLInputElement>(null);
  const album = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      job.current?.abort();
    },
    []
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
  async function read(file?: File) {
    if (!file) return;
    job.current?.abort();
    const controller = new AbortController();
    job.current = controller;
    setBusy(true);
    onBusy(true);
    setCandidates([]);
    setRaw('');
    setMessage('正在读取标签照片…');
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const { recognizeSerialPhoto } = await import('./serial-ocr.js');
      if (controller.signal.aborted) throw new DOMException('Canceled', 'AbortError');
      const result = await recognizeSerialPhoto(file, {
        signal: controller.signal,
        onProgress: (value) => {
          if (job.current === controller) setMessage(value);
        }
      });
      if (job.current !== controller || controller.signal.aborted) return;
      const values = deviceSerialCandidatesFromText(result.text);
      setCandidates(values);
      setRaw(result.text);
      if (values.length === 1) {
        onSerial(values[0]);
        setMessage('已填入候选序列号，请核对 O / 0、I / 1 后再查询或复制。');
      } else
        setMessage(
          values.length
            ? '识别到多个候选，请选择机身 S/N 对应的一项并核对。'
            : '未找到明确序列号，请靠近 S/N 文字重新拍摄，或手动输入。'
        );
    } catch (error) {
      if (job.current === controller)
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
        setBusy(false);
        onBusy(false);
      }
    }
  }
  return (
    <section className="warranty-ocr" aria-label="序列号文字识别">
      <div className="warranty-ocr-actions">
        <button type="button" disabled={busy} onClick={() => photo.current?.click()}>
          拍照识别文字（OCR）
        </button>
        <button type="button" disabled={busy} onClick={() => album.current?.click()}>
          相册文字识别
        </button>
        {busy && (
          <button type="button" onClick={cancel}>
            取消文字识别
          </button>
        )}
      </div>
      <input
        ref={photo}
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="拍摄序列号标签"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          void read(file);
        }}
      />
      <input
        ref={album}
        type="file"
        accept="image/*"
        aria-label="选择序列号文字照片"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          void read(file);
        }}
      />
      <small>请拍清楚机身 S/N 文字，尽量只包含该标签。照片在本机识别，不上传。</small>
      <Notice>{message}</Notice>
      {candidates.length > 1 && (
        <div className="warranty-ocr-actions">
          {candidates.map((value) => (
            <button key={value} type="button" onClick={() => onSerial(value)}>
              采用 {value}
            </button>
          ))}
        </div>
      )}
      {raw && (
        <details>
          <summary>查看识别文字</summary>
          <pre>{raw}</pre>
        </details>
      )}
    </section>
  );
}
