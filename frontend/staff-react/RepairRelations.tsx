import { useId, useState } from 'react';
import { Select } from './SelectionControls.jsx';
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
  const historyId = useId();
  const [historyOpen, setHistoryOpen] = useState(false);
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
          <button
            data-track="staff.repairrelations.button.1"
            onClick={() => onOpen(item.parentAppointmentId!)}
          >
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
        <div className="repair-history">
          <button
            data-track="staff.repairrelations.button.2"
            type="button"
            aria-expanded={historyOpen}
            aria-controls={historyId}
            onClick={() => setHistoryOpen((value) => !value)}
          >
            {historyOpen ? '收起历史维修' : '查看历史维修'}（{historical.length}）
          </button>
          {historyOpen && (
            <ul id={historyId} className="repair-history-list">
              {historical.map((row) => (
                <li key={row.id}>
                  <button
                    data-track="staff.repairrelations.button.3"
                    type="button"
                    onClick={() => onOpen(row.id)}
                  >
                    {row.id}
                  </button>
                  <span>
                    {row.date} · {row.brand} {row.deviceModel}
                  </span>
                  <span>
                    {row.faultType} · {outcomeLabels[row.outcome]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {item.canEdit &&
        !item.parentAppointmentId &&
        ['booked', 'in_progress'].includes(item.status) && (
          <label>
            选择原工单
            <Select
              data-track="staff.repairrelations.select.4"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">普通新故障不关联</option>
              {historical.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.id} · {row.faultType}
                </option>
              ))}
            </Select>
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
              <Select
                data-track="staff.repairrelations.select.5"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="continuation">原故障继续处理</option>
                <option value="recurrence">原故障复发</option>
              </Select>
            </label>
            <label className="field-check">
              <input
                data-track="staff.repairrelations.input.6"
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>已核对为同一设备的原故障；全新故障不关联</span>
            </label>
            {item.status === 'completed' && (
              <label>
                本次已预约的工单编号
                <input
                  data-track="staff.repairrelations.input.7"
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value.trim())}
                />
              </label>
            )}
            <button
              data-track="staff.repairrelations.button.8"
              disabled={busy || !confirmed || (item.status === 'completed' && !targetId)}
              onClick={link}
            >
              关联现有工单
            </button>
            {item.status === 'completed' && (
              <button
                data-track="staff.repairrelations.button.9"
                disabled={busy || !confirmed}
                onClick={() => setOnsite(true)}
              >
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
