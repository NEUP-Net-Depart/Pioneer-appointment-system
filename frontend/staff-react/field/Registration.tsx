import { Select } from '../SelectionControls.jsx';
import { useQueryClient } from '@tanstack/react-query';
import type { Appointment } from './types';
import React, { useEffect, useRef, useState } from 'react';
import { validSignature } from '../../../shared/signature.js';
import { createSignaturePad } from '../../../shared/signature-pad.js';
import { api, Modal, Notice } from './ui';

export function Registration({
  campus,
  parent,
  linkKind,
  onDone,
  onClose
}: {
  campus: string;
  parent?: Appointment;
  linkKind?: string;
  onDone: (id: string, accessToken?: string) => void;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [step, setStep] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({
    campus,
    deviceType: '笔记本电脑',
    warranty: '不清楚',
    liquidDrop: '不清楚',
    faultType: '系统问题',
    ...(parent
      ? Object.fromEntries(
          [
            'name',
            'studentId',
            'social',
            'phone',
            'email',
            'contactType',
            'contactValue',
            'brand',
            'deviceModel',
            'deviceType',
            'faultType',
            'issue',
            'warranty'
          ].map((key) => [key, parent[key] || ''])
        )
      : {})
  });
  const signature = useRef(null),
    pad = useRef<ReturnType<typeof createSignaturePad> | null>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    requestId = useRef(crypto.randomUUID());
  useEffect(() => {
    if (step !== 1 || !canvas.current) return;
    const controller = createSignaturePad(canvas.current, {
      value: signature.current,
      onChange: (value) => {
        signature.current = value;
      },
      onError: setError
    });
    pad.current = controller;
    return () => {
      signature.current = controller.value();
      controller.dispose();
      pad.current = null;
    };
  }, [step]);
  useEffect(() => {
    pad.current?.setEnabled(!busy);
  }, [busy, step]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const signed = pad.current?.value();
    if (!validSignature(signed)) {
      setError('请机主手写本人姓名');
      return;
    }
    setBusy(true);
    try {
      const item = await api<{ id: string; accessToken?: string }>('/api/scan/onsite', {
        method: 'POST',
        body: {
          ...form,
          ...(parent ? { parentAppointmentId: parent.id, linkKind, sameDeviceAndFault: true } : {}),
          agreement: true,
          signature: signed,
          requestId: requestId.current
        }
      });
      const affected = {
        predicate: (query) =>
          [
            '/api/appointments',
            '/api/appointments/counts',
            '/api/appointments/overview',
            '/api/field/home',
            '/api/field/board',
            '/api/stats/summary'
          ].includes(query.queryKey[0] as string)
      };
      await client.cancelQueries(affected);
      await client.invalidateQueries(affected);
      onDone(item.id, item.accessToken);
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
        <span data-motion-value="text">{campus}校区</span>
        <strong data-motion-value="text">
          {step === 0 ? '填写机主与设备信息' : '机主确认与签名'}
        </strong>
        <ol aria-label="登记进度">
          <li aria-current={step === 0 ? 'step' : undefined}>填写信息</li>
          <li aria-current={step === 1 ? 'step' : undefined}>确认与签名</li>
        </ol>
      </div>
      <Notice>{error}</Notice>
      {step === 0 ? (
        <form
          data-track="staff.field.registration.form.1"
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
                  data-track="staff.field.registration.input.2"
                  required={key !== 'deviceModel'}
                  maxLength={Number(max)}
                  value={form[key] || ''}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </label>
            ))}
            <label>
              故障类型
              <Select
                data-track="staff.field.registration.select.3"
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
              </Select>
            </label>
          </div>
          <label>
            故障描述（选填）
            <textarea
              data-track="staff.field.registration.textarea.4"
              value={form.issue || ''}
              maxLength={10000}
              onChange={(e) => setForm({ ...form, issue: e.target.value })}
            />
          </label>
          <button data-track="staff.field.registration.button.5" className="field-primary">
            下一步：机主确认
          </button>
        </form>
      ) : (
        <form data-track="staff.field.registration.form.6" className="field-form" onSubmit={submit}>
          <div className="field-ticket">
            <strong data-motion-value="text">
              {form.name} · {form.studentId}
            </strong>
            <p data-motion-value="text">
              {form.brand} {form.deviceModel} · {form.faultType}
            </p>
          </div>
          <section aria-label="免费维修协议">
            <h3>免费维修协议</h3>
            <p>
              本服务为免费、自愿的互助维修，不保证一定修复。请提前备份重要数据，维修方不承担数据丢失责任。
            </p>
            <p>
              配件由机主自行准备；清灰提供免费普通硅脂或自带。在保设备建议优先联系官方售后。请如实描述故障并遵守现场秩序；工作人员不得翻阅个人文件与聊天记录。
            </p>
          </section>
          <label className="field-check">
            <input data-track="staff.field.registration.input.7" type="checkbox" required />
            <span>机主已阅读并同意协议，确认重要数据已备份</span>
          </label>
          <label>
            请机主手写姓名
            <div className="field-signature">
              <canvas ref={canvas} aria-label="机主签名" aria-disabled={busy} />
            </div>
          </label>
          <div className="field-actions">
            <button
              data-track="staff.field.registration.signature.undo"
              type="button"
              disabled={busy}
              onClick={() => pad.current?.undo()}
            >
              撤销上一笔
            </button>
            <button
              data-track="staff.field.registration.button.8"
              type="button"
              disabled={busy}
              onClick={() => pad.current?.clear()}
            >
              清空签名
            </button>
            <button
              data-track="staff.field.registration.button.9"
              type="button"
              disabled={busy}
              onClick={() => setStep(0)}
            >
              返回修改
            </button>
            <button
              data-track="staff.field.registration.button.10"
              className="field-primary"
              disabled={busy}
            >
              {busy ? '正在登记…' : '确认登记'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
