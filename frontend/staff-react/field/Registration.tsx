import React, { useRef, useState } from 'react';
import { drawSignature, validSignature } from '../../../shared/signature.js';
import { api, Modal, Notice } from './ui';

export function Registration({
  campus,
  frontdesk,
  onDone,
  onClose
}: {
  campus: string;
  frontdesk: boolean;
  onDone: (id: string) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({
    campus,
    deviceType: '笔记本电脑',
    warranty: '不清楚',
    liquidDrop: '不清楚',
    faultType: '系统问题'
  });
  const strokes = useRef<number[][][]>([]),
    pointer = useRef<number | null>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    requestId = useRef(crypto.randomUUID());
  const point = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    ];
  };
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!validSignature(strokes.current)) {
      setError('请机主手写本人姓名');
      return;
    }
    setBusy(true);
    try {
      const item = await api<{ id: string }>('/api/scan/onsite', {
        method: 'POST',
        body: {
          ...form,
          agreement: true,
          signature: strokes.current,
          requestId: requestId.current,
          registrationFlow: frontdesk ? 'frontdesk' : 'technician_intake'
        }
      });
      onDone(item.id);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="临时维修登记"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="workspace-flow-context">
        <span>{campus}校区</span>
        <strong>{step === 0 ? '填写机主与设备信息' : '机主确认与签名'}</strong>
        <ol aria-label="登记进度">
          <li aria-current={step === 0 ? 'step' : undefined}>填写信息</li>
          <li aria-current={step === 1 ? 'step' : undefined}>确认与签名</li>
        </ol>
      </div>
      <Notice>{error}</Notice>
      {step === 0 ? (
        <form
          className="field-form"
          onSubmit={(e) => {
            e.preventDefault();
            setStep(1);
          }}
        >
          <div className="field-form-grid">
            {[
              ['name', '姓名', 80],
              ['studentId', '学号', 20],
              ['social', 'QQ / 微信', 120],
              ['brand', '设备厂商', 80],
              ['deviceModel', '设备型号', 120]
            ].map(([key, label, max]) => (
              <label key={key}>
                {label}
                <input
                  required
                  maxLength={Number(max)}
                  value={form[key] || ''}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </label>
            ))}
            <label>
              故障类型
              <select
                value={form.faultType}
                onChange={(e) => setForm({ ...form, faultType: e.target.value })}
              >
                {[
                  '清灰换硅脂',
                  '换硬盘',
                  '换内存',
                  '系统问题',
                  '蓝屏',
                  '黑屏',
                  '网络问题',
                  '其他'
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            故障描述（选填）
            <textarea
              value={form.issue || ''}
              maxLength={10000}
              onChange={(e) => setForm({ ...form, issue: e.target.value })}
            />
          </label>
          <button className="field-primary">下一步：机主确认</button>
        </form>
      ) : (
        <form className="field-form" onSubmit={submit}>
          <div className="field-ticket">
            <strong>
              {form.name} · {form.studentId}
            </strong>
            <p>
              {form.brand} {form.deviceModel} · {form.faultType}
            </p>
          </div>
          <details open>
            <summary>免费维修协议</summary>
            <p>
              本服务为免费、自愿的互助维修，不保证一定修复。请提前备份重要数据，维修方不承担数据丢失责任。
            </p>
            <p>
              配件由机主自行准备；清灰提供免费普通硅脂或自带。在保设备建议优先联系官方售后。请如实描述故障并遵守现场秩序；工作人员不得翻阅个人文件与聊天记录。
            </p>
          </details>
          <label className="field-check">
            <input type="checkbox" required />
            机主已阅读并同意协议，确认重要数据已备份
          </label>
          <label>
            请机主手写姓名
            <canvas
              className="field-signature"
              ref={canvas}
              width={900}
              height={360}
              aria-label="机主签名"
              onPointerDown={(e) => {
                if (pointer.current !== null) return;
                pointer.current = e.pointerId;
                e.currentTarget.setPointerCapture(e.pointerId);
                strokes.current.push([point(e)]);
              }}
              onPointerMove={(e) => {
                if (pointer.current !== e.pointerId) return;
                strokes.current.at(-1)!.push(point(e));
                drawSignature(canvas.current, strokes.current);
              }}
              onPointerUp={() => {
                pointer.current = null;
              }}
              onPointerCancel={() => {
                pointer.current = null;
              }}
            />
          </label>
          <div className="field-actions">
            <button
              type="button"
              onClick={() => {
                strokes.current = [];
                drawSignature(canvas.current, []);
              }}
            >
              清空签名
            </button>
            <button
              type="button"
              onClick={() => {
                strokes.current = [];
                pointer.current = null;
                setStep(0);
              }}
            >
              返回修改
            </button>
            <button className="field-primary" disabled={busy}>
              {busy ? '正在登记…' : '确认登记'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
