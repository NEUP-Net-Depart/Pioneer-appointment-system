import { DataValue } from './DataValue';
import { TIME_SLOTS } from '../../shared/constants.js';
import React, { useContext, useEffect, useState } from 'react';
import { addDays, dateKey } from '../../shared/time.js';
import { ActivityContext, Notice } from './field/ui';
import { request } from './request.js';

export function ActualDayCapacity({ campus, revision, onNavigate }) {
  const active = useContext(ActivityContext);
  const [date, setDate] = useState(dateKey()),
    [snapshot, setSnapshot] = useState(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!active || !date) return;
    let controller,
      stopped = false;
    async function read() {
      controller?.abort();
      if (document.hidden) return;
      controller = new AbortController();
      const current = controller;
      setLoading(true);
      setError('');
      try {
        const data = await request(
          `/api/slot-capacities/actual?${new URLSearchParams({ campus, date })}`,
          { signal: current.signal }
        );
        if (!stopped && !current.signal.aborted) setSnapshot(data);
      } catch (failure) {
        if (!stopped && !current.signal.aborted) {
          if ([401, 403].includes(failure.status)) setSnapshot(null);
          setError(failure.message);
        }
      } finally {
        if (!stopped && !current.signal.aborted) setLoading(false);
      }
    }
    read();
    const visibility = () => {
      if (document.hidden) {
        controller?.abort();
        setLoading(false);
      } else read();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      stopped = true;
      controller?.abort();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [campus, date, active, revision, retry]);
  const data = snapshot?.campus === campus && snapshot?.date === date ? snapshot : null;
  return (
    <section className="field-card capacity-actual" aria-busy={loading}>
      <div className="capacity-section-heading">
        <div>
          <h2>日期实际容量</h2>
        </div>
        <button disabled={loading || !date} onClick={() => setRetry((value) => value + 1)}>
          {loading ? '正在更新…' : '更新实际数据'}
        </button>
      </div>
      <div className="capacity-actual-date">
        <label>
          查看日期
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <div className="capacity-date-shortcuts" role="group" aria-label="快捷查看日期">
          {[0, 1, 2, 3].map((offset) => {
            const day = addDays(dateKey(), offset);
            return (
              <button key={day} aria-pressed={date === day} onClick={() => setDate(day)}>
                {offset === 0 ? '今天' : day.slice(5).replace('-', '/')}
              </button>
            );
          })}
        </div>
      </div>
      <Notice>{error}</Notice>
      {error && <button onClick={() => setRetry((value) => value + 1)}>重试</button>}
      {!date && <p className="workspace-update">请选择日期。</p>}
      {date && (
        <>
          <div className="capacity-source">
            <span>
              容量来源：
              <DataValue label="容量来源" pending={loading}>
                {data ? (data.source === 'snapshot' ? '已形成当日容量快照' : '使用每周模板') : null}
              </DataValue>
            </span>
            <p>
              {!data
                ? '实际名额由当日容量与预约占用共同决定。'
                : data.source === 'snapshot'
                  ? '当天容量已固定，后续模板调整不影响此日期。'
                  : '尚无固定快照；首次预约前，容量随对应星期的模板更新。'}
            </p>
          </div>
          <div className="capacity-actual-layout">
            <div>
              <h3>预约名额</h3>
              {!data || data.items.length ? (
                <table className="capacity-actual-slots" aria-label="各时段预约名额">
                  <thead>
                    <tr>
                      <th scope="col">到场时段</th>
                      <th scope="col">名额</th>
                      <th scope="col">已占用</th>
                      <th scope="col">剩余</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.items || TIME_SLOTS.map((timeSlot) => ({ timeSlot }))).map((item) => (
                      <tr key={item.timeSlot}>
                        <th scope="row">{item.timeSlot}</th>
                        <td>
                          <DataValue label={`${item.timeSlot}名额`} pending={loading}>
                            {item.capacity}
                          </DataValue>
                        </td>
                        <td>
                          <DataValue label={`${item.timeSlot}已占用`} pending={loading}>
                            {item.occupied}
                          </DataValue>
                        </td>
                        <td>
                          <strong>
                            <DataValue label={`${item.timeSlot}剩余`} pending={loading}>
                              {data ? Math.max(0, item.capacity - item.occupied) : null}
                            </DataValue>
                          </strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="field-muted">此日期没有配置预约时段。</p>
              )}
              <p className="field-muted">
                已占用名额包含已完成、已过期预约；取消预约释放名额。现场临时登记不占用预约名额。
              </p>
            </div>
            <div className="capacity-staffing">
              <h3>工作人员</h3>
              {!data ? (
                <>
                  <p className="field-muted">{campus}校区 · 当日预计出勤</p>
                  <div className="capacity-staffing-list">
                    {['维修排班', '办公排班'].map((label) => (
                      <div className="capacity-staffing-row" key={label}>
                        <span>{label}</span>
                        <DataValue label={label} pending={loading} />
                      </div>
                    ))}
                  </div>
                </>
              ) : data.staffing ? (
                <>
                  <p className="field-muted">{campus}校区 · 当日预计出勤</p>
                  <div className="capacity-staffing-list">
                    {Object.entries(data.staffing).map(([type, count]) => (
                      <div className="capacity-staffing-row" key={type}>
                        <span>{type === 'repair' ? '维修排班' : '办公排班'}</span>
                        <strong>{count} 人</strong>
                        {onNavigate && (
                          <button
                            onClick={() =>
                              onNavigate(type === 'repair' ? 'roster-manage' : 'office-roster')
                            }
                          >
                            {type === 'repair' ? '查看维修排班' : '查看办公排班'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="field-muted">
                    预计出勤按已发布班次去重，并扣除已批准请假；实际到岗以签到记录为准。
                  </p>
                </>
              ) : (
                <p className="field-muted">人员安排请在有权限的排班管理页查看。</p>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
