import { useState } from 'react';
import { api, Notice, Modal } from './field/ui';
import type { Appointment } from './field/types';
import { outcomeLabels, statusLabels } from '../../shared/constants.js';
import { formatInstant } from '../../shared/time.js';

const fields = {
  name: '姓名',
  brand: '品牌',
  deviceModel: '型号（未知可留空）',
  faultType: '故障类型',
  issue: '故障描述',
  social: 'QQ / 微信',
  phone: '电话',
  email: '邮箱',
  contactValue: '预约联系方式'
};
export function RepairInformation({
  item,
  onChanged
}: {
  item: Appointment;
  onChanged: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.keys(fields).map((key) => [key, item[key] || '']))
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <details data-track="staff.repairdetails.details.1" className="field-details">
      <summary data-track="staff.repairdetails.summary.2">更正客户与设备资料</summary>
      <Notice>{error}</Notice>
      <form
        data-track="staff.repairdetails.form.3"
        className="field-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            await api(`/api/appointments/${encodeURIComponent(item.id)}/information`, {
              method: 'PATCH',
              body: { ...values, revision: item.revision, requestId: crypto.randomUUID() }
            });
            onChanged();
          } catch (failure) {
            setError((failure as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {Object.entries(fields).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              data-track="staff.repairdetails.input.4"
              required={['name', 'brand', 'faultType'].includes(key)}
              value={values[key]}
              onChange={(event) => setValues({ ...values, [key]: event.target.value })}
            />
          </label>
        ))}
        <button data-track="staff.repairdetails.button.5" disabled={busy}>
          保存资料更正
        </button>
      </form>
    </details>
  );
}
export function RepairCredential({
  item,
  onIssued
}: {
  item: Appointment;
  onIssued: (token: string) => void;
}) {
  const [reason, setReason] = useState(''),
    [verified, setVerified] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  if (!item.canRecoverCredential) return null;
  return (
    <details data-track="staff.repairdetails.details.6" className="field-details">
      <summary data-track="staff.repairdetails.summary.7">补发客户私人查询链接</summary>
      <Notice>{error}</Notice>
      <p>核验客户身份后补发，原链接立即失效。</p>
      <form
        data-track="staff.repairdetails.form.8"
        className="field-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            const result = await api<{ accessToken: string }>(
              `/api/appointments/${encodeURIComponent(item.id)}/credential`,
              { method: 'POST', body: { identityVerified: verified, reason } }
            );
            onIssued(result.accessToken);
          } catch (failure) {
            setError((failure as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field-check">
          <input
            data-track="staff.repairdetails.input.9"
            type="checkbox"
            required
            checked={verified}
            onChange={(event) => setVerified(event.target.checked)}
          />
          <span>已人工核验机主身份</span>
        </label>
        <label>
          核验说明（勿录入完整联系方式）
          <textarea
            data-track="staff.repairdetails.textarea.10"
            required
            minLength={8}
            maxLength={300}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <button data-track="staff.repairdetails.button.11" disabled={busy || !verified}>
          签发私人链接
        </button>
      </form>
    </details>
  );
}
const actions = {
  'repairs.started': '接单',
  'repairs.received': '首次接收',
  'repairs.transferred': '设备交接',
  'repairs.completed': '结束服务',
  'repairs.corrected': '更正结果',
  'repairs.information.updated': '更正资料',
  'repairs.photos.supplemented': '补传首次接收照片',
  'repairs.linked': '关联返修',
  'repairs.workflow.archived': '旧流程迁移存档',
  'repairs.followup.migrated': '旧返修申请存档'
};
const historyFields = {
  status: '服务状态',
  outcome: '维修结果',
  repairNote: '处理说明',
  assignedTo: '主修账号',
  brand: '品牌',
  deviceModel: '型号',
  faultType: '故障类型',
  issue: '故障描述',
  parentAppointmentId: '关联原单',
  photoDeferredBy: '照片待传经办人'
};
export function RepairHistory({ history }: { history: Appointment['repairHistory'] }) {
  const [open, setOpen] = useState(false);
  if (!history?.events) return null;
  return (
    <>
      <button
        data-track="staff.repairdetails.button.12"
        type="button"
        onClick={() => setOpen(true)}
      >
        查看维修与交接记录
      </button>
      {open && (
        <Modal title="维修与交接历史" onClose={() => setOpen(false)}>
          {!history.events.length && <p className="field-muted">暂无操作记录。</p>}
          <div className="repair-history-list">
            {history?.events?.map((event, index) => {
              const before = (event.before || {}) as Record<string, unknown>,
                after = (event.after || {}) as Record<string, unknown>;
              const display = (key: string, value: unknown) =>
                String(
                  (key === 'outcome'
                    ? outcomeLabels[String(value)]
                    : key === 'status'
                      ? statusLabels[String(value)]
                      : value) || '—'
                );
              return (
                <article key={index} className="repair-history-event">
                  <p>
                    {formatInstant(event.occurredAt)} · {actions[event.action] || event.action} ·{' '}
                    {event.actorName || ''} {event.reason}
                  </p>
                  {Object.entries(historyFields)
                    .filter(([key]) => key in after && before[key] !== after[key])
                    .map(([key, label]) => (
                      <p key={key}>
                        {label}：{display(key, before[key])} → {display(key, after[key])}
                      </p>
                    ))}
                  {['phone', 'email', 'social', 'contactValue'].some(
                    (key) => key in after && before[key] !== after[key]
                  ) && <p>联系方式已更正（访问详情可查看当前值）</p>}
                </article>
              );
            })}
          </div>
        </Modal>
      )}
    </>
  );
}
