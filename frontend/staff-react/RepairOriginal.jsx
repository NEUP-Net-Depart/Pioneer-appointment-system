import React, { useEffect, useRef, useState } from 'react';
import { drawSignature } from '../../shared/signature.js';
import { formatInstant } from '../../shared/time.js';

export function RepairOriginal({ original }) {
  const [open, setOpen] = useState(false),
    [invalid, setInvalid] = useState(false);
  const canvas = useRef(null);
  useEffect(() => {
    if (!open || !original?.signature || !canvas.current) return;
    try {
      drawSignature(canvas.current, JSON.parse(original.signature));
      setInvalid(false);
    } catch {
      setInvalid(true);
    }
  }, [open, original?.signature]);
  if (!original) return null;
  return (
    <details className="field-details" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>原始登记与协议</summary>
      <dl className="repair-original">
        {[
          ['原填厂商', original.brand],
          ['原填型号', original.deviceModel],
          ['原始故障', original.issue],
          ['原填保修', original.warranty],
          ['原填液金', original.liquidMetal],
          ['Dell G15', original.dellG15],
          ['学院', original.college],
          ['设备序列号', original.serial],
          ['进水情况', original.liquidDrop],
          ['登记备注', original.note]
        ]
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd data-motion-value="text">{value}</dd>
            </div>
          ))}
        <div>
          <dt>协议确认</dt>
          <dd data-motion-value="text">
            {original.agreementAt ? formatInstant(original.agreementAt) : '未记录'}{' '}
            {original.agreementVersion}
          </dd>
        </div>
      </dl>
      {original.signature && (
        <>
          <p className="field-muted">客户本人签名</p>
          <canvas
            className="repair-signature"
            ref={canvas}
            width="560"
            height="200"
            aria-label="客户本人签名"
          />
          {invalid && <p className="field-muted">历史签名格式无法展示。</p>}
        </>
      )}
    </details>
  );
}
