import { useState } from 'react';
import { api, Notice } from './field/ui';
import { Registration } from './field/Registration';
import type { Appointment } from './field/types';
import { outcomeLabels } from '../../shared/constants.js';

export function RepairRelations({
  item,
  onChanged,
  onOpen
}: {
  item: Appointment;
  onChanged: () => void;
  onOpen: (id: string, token?: string) => void;
}) {
  const [parentId, setParentId] = useState(''),
    [targetId, setTargetId] = useState('');
  const [kind, setKind] = useState('continuation'),
    [confirmed, setConfirmed] = useState(false),
    [onsite, setOnsite] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const historical = item.customerHistory || [];
  const parent = historical.find((row) => row.id === (item.parentAppointmentId || parentId));
  async function link() {
    setBusy(true);
    setError('');
    try {
      const child =
        item.status === 'completed'
          ? await api<Appointment>(`/api/field/appointments/${encodeURIComponent(targetId)}`)
          : item;
      await api(`/api/appointments/${encodeURIComponent(child.id)}/link`, {
        method: 'POST',
        body: {
          parentAppointmentId: item.status === 'completed' ? item.id : parentId,
          linkKind: kind,
          sameDeviceAndFault: confirmed,
          revision: child.revision,
          requestId: crypto.randomUUID()
        }
      });
      onChanged();
      onOpen(child.id);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!historical.length && !item.parentAppointmentId && item.status !== 'completed') return null;
  return (
    <section className="field-form">
      <h3>维修历史与返修关联</h3>
      <Notice>{error}</Notice>
      {item.parentAppointmentId && (
        <p>
          本次关联原单{' '}
          <button onClick={() => onOpen(item.parentAppointmentId!)}>
            {item.parentAppointmentId}
          </button>
        </p>
      )}
      {parent && (
        <p>
          原单结果：{outcomeLabels[parent.outcome]} · {parent.repairNote}
        </p>
      )}
      {!!historical.length && (
        <details>
          <summary>该客户有 {historical.length} 条历史维修记录</summary>
          {historical.map((row) => (
            <p key={row.id}>
              <button onClick={() => onOpen(row.id)}>{row.id}</button> · {row.date} · {row.brand}{' '}
              {row.deviceModel} · {row.faultType} · {outcomeLabels[row.outcome]}
            </p>
          ))}
        </details>
      )}
      {item.canEdit &&
        !item.parentAppointmentId &&
        ['booked', 'in_progress'].includes(item.status) && (
          <label>
            选择原工单
            <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">普通新故障不关联</option>
              {historical.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.id} · {row.faultType}
                </option>
              ))}
            </select>
          </label>
        )}
      {item.canEdit &&
        ((!item.parentAppointmentId &&
          ['booked', 'in_progress'].includes(item.status) &&
          parentId) ||
          item.status === 'completed') && (
          <>
            <label>
              关联原因
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="continuation">原故障继续处理</option>
                <option value="recurrence">原故障复发</option>
              </select>
            </label>
            <label className="field-check">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              已核对为同一设备的原故障；全新故障不关联
            </label>
            {item.status === 'completed' && (
              <label>
                本次已预约的工单编号
                <input value={targetId} onChange={(e) => setTargetId(e.target.value.trim())} />
              </label>
            )}
            <button
              disabled={busy || !confirmed || (item.status === 'completed' && !targetId)}
              onClick={link}
            >
              关联现有工单
            </button>
            {item.status === 'completed' && (
              <button disabled={busy || !confirmed} onClick={() => setOnsite(true)}>
                未预约，现场登记关联新单
              </button>
            )}
          </>
        )}
      {onsite && (
        <Registration
          campus={item.campus}
          parent={item}
          linkKind={kind}
          onClose={() => setOnsite(false)}
          onDone={(id, token) => {
            setOnsite(false);
            onChanged();
            onOpen(id, token);
          }}
        />
      )}
    </section>
  );
}
