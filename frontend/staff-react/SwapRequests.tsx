import React, { useContext, useEffect, useRef, useState } from 'react';
import { ActivityContext, Modal } from './field/ui';
import { useWorkspaceQuery } from './useWorkspaceQuery.js';
import { request } from './request.js';
import { requestStatusLabel } from '../../shared/staff-request-status.js';
import './swap-requests.css';

type Shift = {
  id: string;
  memberId: string;
  memberName?: string;
  businessDate: string;
  campusId: string;
  campusName: string;
  dutyType: string;
  startAt: string;
  endAt: string;
  revision: number;
  leaveStatus?: string;
  roleKind?: string;
};
type Preview = {
  allowed: boolean;
  errors: string[];
  fromAssignment: Shift;
  toAssignment: Shift;
  after: Shift[];
  coverage: {
    campusId: string;
    businessDate: string;
    startAt: string;
    endAt: string;
    expected: number;
    leaders: number;
  }[];
};
type Invitation = {
  id: string;
  note: string;
  revision: number;
  status: string;
  fromMemberId: string;
  fromAssignment: Shift;
  toAssignment: Shift;
  createdAt: string;
  actions: { respond: boolean };
};
const campusName = (shift: { campusName?: string; campusId: string }) =>
  shift.campusName || { 'campus-nanhu': '南湖', 'campus-hunnan': '浑南' }[shift.campusId] || '校区';
const shiftText = (shift: Shift) =>
  `${shift.businessDate} · ${shift.startAt}–${shift.endAt} · ${campusName(shift)}`;

function SwapResult({ value }: { value: Preview }) {
  return (
    <section className="swap-result" aria-label="交换后的班次">
      <h3>交换后的班次</h3>
      <div className="swap-result-members">
        {value.after.map((shift, index) => (
          <div className="swap-result-member" key={index}>
            <strong>{shift.memberName}</strong>
            <span>{shiftText(shift)}</span>
            <small>
              {shift.dutyType === 'office' ? '办公接待' : '维修值班'}
              {shift.roleKind === 'repair_lead'
                ? ' · 值班负责人'
                : shift.roleKind === 'coordinator'
                  ? ' · 当日协调人'
                  : ''}
            </small>
          </div>
        ))}
      </div>
      {value.allowed ? (
        <p className="swap-check" role="status">
          时间与资格校验通过
          {value.fromAssignment.dutyType === 'repair' ? '，维修负责人覆盖完整' : ''}
          。确认时会再次校验。
        </p>
      ) : (
        <div className="react-error" role="alert">
          <strong>目前无法交换</strong>
          <ul>
            {value.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
          <p>可重新选择班次，或联系值班负责人协调。</p>
        </div>
      )}
      {value.coverage.length > 0 && (
        <details className="swap-coverage">
          <summary>查看交换后人员覆盖</summary>
          {value.coverage.map((slot, index) => (
            <p key={index}>
              {slot.businessDate} · {campusName(slot)} · {slot.startAt}–{slot.endAt}：
              {slot.expected} 人
              {value.fromAssignment.dutyType === 'repair' ? `，负责人 ${slot.leaders} 人` : ''}
            </p>
          ))}
        </details>
      )}
    </section>
  );
}

export function SwapComposer({
  assignments,
  initialAssignmentId,
  onChanged,
  onMessage
}: {
  assignments: Shift[];
  initialAssignmentId: string;
  onChanged: () => Promise<void>;
  onMessage: (message: string) => void;
}) {
  const active = useContext(ActivityContext);
  const [fromId, setFromId] = useState(initialAssignmentId || ''),
    [toId, setToId] = useState(''),
    [note, setNote] = useState('');
  const [preview, setPreview] = useState<{ key: string; value: Preview } | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false);
  const command = useRef<{ key: string; requestId: string } | null>(null),
    lock = useRef(false);
  useEffect(() => {
    setFromId(initialAssignmentId || '');
    setToId('');
  }, [initialAssignmentId]);
  const candidates = useWorkspaceQuery(
    fromId ? `/api/swaps/candidates?assignmentId=${encodeURIComponent(fromId)}` : '',
    active && !!fromId,
    0
  );
  const source = assignments.find((item) => item.id === fromId),
    targets: Shift[] = candidates.current ? candidates.data?.items || [] : [],
    target = targets.find((item) => item.id === toId);
  useEffect(() => {
    if (fromId && !assignments.some((item) => item.id === fromId)) {
      setFromId('');
      setToId('');
    }
  }, [assignments, fromId]);
  const key = JSON.stringify([fromId, toId, source?.revision, target?.revision]);
  const result = preview?.key === key ? preview.value : null;
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setPreview(null);
    if (!active || !fromId || !toId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    request('/api/swaps/preview', {
      method: 'POST',
      body: { fromAssignmentId: fromId, toAssignmentId: toId },
      signal: controller.signal
    })
      .then((value) => {
        if (!controller.signal.aborted) setPreview({ key, value });
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [active, key, fromId, toId]);
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current || !source || !target || !result?.allowed) return;
    const body = {
      fromAssignmentId: source.id,
      toAssignmentId: target.id,
      toMemberId: target.memberId,
      fromRevision: source.revision,
      toRevision: target.revision,
      note
    };
    const identity = JSON.stringify(body);
    if (command.current?.key !== identity)
      command.current = { key: identity, requestId: crypto.randomUUID() };
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await request('/api/swaps', {
        method: 'POST',
        body: { ...body, requestId: command.current.requestId }
      });
      command.current = null;
      setToId('');
      setNote('');
      onMessage('换班申请已发送，等待对方查看并确认');
      await onChanged();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <form className="roster-form swap-composer" onSubmit={send}>
      <h3>发起换班</h3>
      <p className="react-muted">先选择班次，查看双方交换后的安排，再发送邀请。</p>
      <fieldset disabled={busy}>
        <label>
          我的班次
          <select
            required
            value={fromId}
            onChange={(event) => {
              setFromId(event.target.value);
              setToId('');
            }}
          >
            <option value="">选择需要调换的班次</option>
            {assignments.map((item) => (
              <option key={item.id} value={item.id} disabled={!!item.leaveStatus}>
                {shiftText(item)}
              </option>
            ))}
          </select>
        </label>
        <label>
          希望调换到
          <select
            required
            disabled={!fromId || candidates.loading}
            value={toId}
            onChange={(event) => setToId(event.target.value)}
          >
            <option value="">
              {candidates.loading ? '正在查询班次…' : '选择同校区、同岗位的本周班次'}
            </option>
            {targets.map((item) => (
              <option key={item.id} value={item.id}>
                {shiftText(item)} · {item.memberName}
              </option>
            ))}
          </select>
        </label>
        {fromId && candidates.current && !targets.length && (
          <p className="react-muted">本周暂无可选班次，请联系值班负责人协调。</p>
        )}
        {candidates.error && (
          <p className="react-error" role="alert">
            {candidates.error}
          </p>
        )}
        {loading && <p role="status">正在校验交换后的安排…</p>}
        {result && <SwapResult value={result} />}
        <label>
          换班说明<span className="react-muted">选填</span>
          <textarea
            value={note}
            maxLength={500}
            rows={2}
            onChange={(event) => setNote(event.target.value)}
            placeholder="告诉对方需要换班的原因"
          />
        </label>
        {error && (
          <p className="react-error" role="alert">
            {error}
          </p>
        )}
        <button className="react-primary" disabled={busy || loading || !target || !result?.allowed}>
          {busy ? '正在发送…' : '发送换班邀请'}
        </button>
      </fieldset>
    </form>
  );
}

export function SwapInvitations({
  items,
  onChanged,
  onMessage
}: {
  items: Invitation[];
  onChanged: () => Promise<void>;
  onMessage: (message: string) => void;
}) {
  const active = useContext(ActivityContext),
    [selected, setSelected] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const detail = useWorkspaceQuery(
    selected ? `/api/swaps/${encodeURIComponent(selected)}` : '',
    active && !!selected,
    revision
  );
  const value: (Invitation & Preview & { applied: Shift[] }) | null = detail.current
    ? detail.data
    : null;
  const commands = useRef(new Map<string, string>()),
    lock = useRef(false);
  async function decide(decision: 'accept' | 'decline') {
    if (lock.current || !value) return;
    const key = `${value.id}:${value.revision}:${decision}`;
    if (!commands.current.has(key)) commands.current.set(key, crypto.randomUUID());
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await request(`/api/swaps/${encodeURIComponent(value.id)}/decision`, {
        method: 'POST',
        body: { decision, revision: value.revision, requestId: commands.current.get(key) }
      });
      commands.current.delete(key);
      setSelected('');
      onMessage(
        decision === 'accept' ? '换班已生效，双方班次已更新' : '已拒绝换班，原班次保持不变'
      );
      await onChanged();
    } catch (failure) {
      setError((failure as Error).message);
      setRevision((current) => current + 1);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      {items.map((item) => (
        <div className="request-row swap-invitation" key={item.id}>
          <div>
            <strong>
              {item.fromAssignment?.memberName} 与 {item.toAssignment?.memberName}的换班
            </strong>
            <span>{item.fromAssignment && shiftText(item.fromAssignment)}</span>
            <span>{item.toAssignment && shiftText(item.toAssignment)}</span>
          </div>
          <span className="account-state" data-state={item.status}>
            {requestStatusLabel(item.status)}
          </span>
          <button
            type="button"
            onClick={() => {
              setSelected(item.id);
              setError('');
            }}
          >
            {item.actions.respond ? '查看并确认' : '查看详情'}
          </button>
        </div>
      ))}
      {selected && (
        <Modal
          title="换班详情"
          onClose={() => {
            if (!busy) setSelected('');
          }}
          dismissible={!busy}
        >
          {detail.error && (
            <p className="react-error" role="alert">
              {detail.error}
            </p>
          )}
          {!value && !detail.error && <p role="status">正在读取换班安排…</p>}
          {value && (
            <div className="swap-confirmation">
              <p>
                <strong>{value.fromAssignment.memberName}</strong> 邀请{' '}
                <strong>{value.toAssignment.memberName}</strong> 交换班次
              </p>
              {value.note && <blockquote>{value.note}</blockquote>}
              {value.status === 'pending' ? (
                <SwapResult value={value} />
              ) : (
                <>
                  <span className="account-state" data-state={value.status}>
                    {requestStatusLabel(value.status)}
                  </span>
                  {value.applied?.map((shift, index) => (
                    <div className="swap-result-member" key={shift.id}>
                      <strong>
                        {index === 0
                          ? value.toAssignment.memberName
                          : value.fromAssignment.memberName}
                      </strong>
                      <span>{shiftText(shift)}</span>
                    </div>
                  ))}
                </>
              )}
              {error && (
                <p className="react-error" role="alert">
                  {error}
                </p>
              )}
              {value.actions.respond && (
                <div className="swap-confirm-actions">
                  <button disabled={busy} type="button" onClick={() => decide('decline')}>
                    拒绝换班
                  </button>
                  <button
                    className="react-primary"
                    disabled={busy || !value.allowed || detail.loading}
                    type="button"
                    onClick={() => decide('accept')}
                  >
                    {busy ? '正在处理…' : '确认并同意换班'}
                  </button>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
