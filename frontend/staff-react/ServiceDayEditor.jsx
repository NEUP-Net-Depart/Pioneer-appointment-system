import React, { useContext, useEffect, useRef, useState } from 'react';
import { ActivityContext, Modal, Notice } from './field/ui';
import { request } from './request.js';
import { dateKey } from '../../shared/time.js';

export function ServiceDayEditor({ campus, onNavigate }) {
  const active = useContext(ActivityContext),
    [date, setDate] = useState(dateKey()),
    [data, setData] = useState(null),
    [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirm, setConfirm] = useState(false),
    [notice, setNotice] = useState('');
  const command = useRef(null);
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    setData(null);
    setError('');
    request('/api/service-days?' + new URLSearchParams({ date, campus }), { signal: abort.signal })
      .then((result) => {
        setData(result);
        setReason(result.item?.reason || '');
      })
      .catch((failure) => {
        if (!abort.signal.aborted) setError(failure.message);
      });
    return () => abort.abort();
  }, [active, campus, date]);
  async function save() {
    if (busy) return;
    setBusy(true);
    setError('');
    const body = {
      businessDate: date,
      campusId: campus === '南湖' ? 'campus-nanhu' : 'campus-hunnan',
      paused: !data.item?.paused,
      reason,
      revision: data.item?.revision ?? -1
    };
    const signature = JSON.stringify(body);
    if (command.current?.signature !== signature)
      command.current = { signature, id: crypto.randomUUID() };
    try {
      const item = await request('/api/service-days', {
        method: 'PATCH',
        body: { ...body, requestId: command.current.id }
      });
      setData({ ...data, item });
      setConfirm(false);
      setNotice(
        item.paused
          ? '已暂停。已有预约与班表保留，请联系受影响机主。'
          : '已恢复。原容量配置继续使用，班表调整仍需负责人确认。'
      );
      command.current = null;
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="react-card">
      <h2>指定日期暂停维修</h2>
      <p className="react-muted">
        该校区当天停止新预约、现场登记、接单与所有人员签到。办公和维修排班同时跳过；已有预约、班表和考勤保留。
      </p>
      <label>
        维修日期
        <input
          aria-label="暂停维修日期"
          type="date"
          min={dateKey()}
          value={date}
          disabled={busy}
          onChange={(event) => {
            setDate(event.target.value);
            setNotice('');
          }}
        />
      </label>
      {data && (
        <>
          <p role="status">
            <strong>{data.item?.paused ? '暂停维修' : '正常维修'}</strong> · {campus}校区 · {date}
          </p>
          <label>
            对外说明（可选）
            <textarea
              maxLength={200}
              value={reason}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {!!data.affected.length && (
            <div className="react-message">
              <strong>有 {data.affected.length} 个预约需要联系机主</strong>
              <p>订单会保留。联系方式仍按预约记录页权限显示。</p>
              <button onClick={() => onNavigate?.('records')}>前往预约记录</button>
              <ul>
                {data.affected.map((item) => (
                  <li key={item.id}>
                    {item.id} · {item.timeSlot}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button className="field-primary" disabled={busy} onClick={() => setConfirm(true)}>
            {data.item?.paused ? '恢复当天维修' : '暂停当天维修'}
          </button>
        </>
      )}
      <Notice>{error || notice}</Notice>
      {confirm && (
        <Modal
          compact
          title={data.item?.paused ? '恢复维修' : '确认暂停维修'}
          onClose={() => {
            if (!busy) setConfirm(false);
          }}
        >
          <p>
            {campus}校区 · {date}
          </p>
          <p>
            {data.item?.paused
              ? '恢复原容量，已有班表不会自动改写。'
              : '已有预约不会取消，请联系机主。当天所有岗位停止签到，已有签到不计入本周有效考勤。'}
          </p>
          <Notice>{error}</Notice>
          <div className="field-actions">
            <button disabled={busy} onClick={() => setConfirm(false)}>
              返回
            </button>
            <button className="field-primary" disabled={busy} onClick={save}>
              确认{data.item?.paused ? '恢复' : '暂停'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
