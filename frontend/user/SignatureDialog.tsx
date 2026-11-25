import { useLayoutEffect, useRef, useState } from 'react';
import { validSignature } from '../../shared/signature.ts';
import { createSignaturePad, createSignaturePreview } from '../../shared/signature-pad.ts';
import { DialogLayer, useDialogs } from './dialogs';
import type { Signature } from './types';

export function SignatureDialog({ onConfirm }: { onConfirm: (value: Signature) => void }) {
  const { dialog, close } = useDialogs();
  const canvas = useRef<HTMLCanvasElement>(null);
  const pad = useRef<ReturnType<typeof createSignaturePad> | null>(null);
  const [error, setError] = useState('');
  const open = dialog?.kind === 'signature';
  useLayoutEffect(() => {
    if (!open || !canvas.current) return;
    setError('');
    const editor = createSignaturePad(canvas.current, { onError: setError });
    pad.current = editor;
    return () => {
      editor.dispose();
      pad.current = null;
    };
  }, [open]);
  function confirm() {
    const value: Signature | null | undefined = pad.current?.value();
    if (!value || !validSignature(value)) {
      setError('请完整手写本人姓名，不能留白或只点一下。');
      return;
    }
    onConfirm(value);
    close();
  }
  return (
    <DialogLayer kind="signature" id="signature-modal" layer="signature-layer">
      <section
        data-track="student.index.section.50"
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signature-title"
      >
        <h2 id="signature-title">手写本人姓名</h2>
        <div className="signature-surface">
          <canvas ref={canvas} id="signature-canvas" aria-label="手写签名区域" />
        </div>
        <p id="signature-error" className="field-error" role="alert">
          {error}
        </p>
        <div className="modal-actions">
          <button
            data-track="student.signature.undo"
            id="undo-signature"
            type="button"
            className="secondary-btn"
            onClick={() => pad.current?.undo()}
          >
            撤销上一笔
          </button>
          <button
            data-track="student.index.button.51"
            id="clear-signature"
            type="button"
            className="secondary-btn"
            onClick={() => pad.current?.clear()}
          >
            清空全部
          </button>
          <button
            data-track="student.index.button.52"
            id="cancel-signature"
            type="button"
            className="secondary-btn"
            onClick={close}
          >
            取消
          </button>
          <button
            data-track="student.index.button.53"
            id="confirm-signature"
            type="button"
            className="primary-btn"
            onClick={confirm}
          >
            确认签名
          </button>
        </div>
      </section>
    </DialogLayer>
  );
}

export function ConfirmedSignature({ value }: { value: Signature | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (!value || !canvas.current) return;
    const preview = createSignaturePreview(canvas.current, value);
    return () => preview.dispose();
  }, [value]);
  return <canvas ref={canvas} id="confirmed-signature" aria-label="已确认的签名" hidden={!value} />;
}
