import React, { useContext, useEffect, useState } from 'react';
import { addDays, dateKey } from '../../shared/time.js';
import { ActivityContext, Notice } from './field/ui';
import { request } from './request.js';

export function ActualDayCapacity({ campus, revision, onNavigate }) {
  const active = useContext(ActivityContext);
  const [date, setDate] = useState(dateKey()), [snapshot, setSnapshot] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!active || !date) return;
    let controller, stopped = false;
    async function read() {
      controller?.abort(); if (document.hidden) return;
      controller = new AbortController(); const current = controller;
      setLoading(true); setError('');
      try {
        const data = await request(`/api/slot-capacities/actual?${new URLSearchParams({ campus, date })}`, { signal: current.signal });
        if (!stopped && !current.signal.aborted) setSnapshot(data);
      } catch (failure) { if (!stopped && !current.signal.aborted) { if ([401, 403].includes(failure.status)) setSnapshot(null); setError(failure.message); } }
      finally { if (!stopped && !current.signal.aborted) setLoading(false); }
    }
    read();
    const visibility = () => { if (document.hidden) { controller?.abort(); setLoading(false); } else read(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { stopped = true; controller?.abort(); document.removeEventListener('visibilitychange', visibility); };
  }, [campus, date, active, revision, retry]);
  const data = snapshot?.campus === campus && snapshot?.date === date ? snapshot : null;
  return <section className="field-card capacity-actual">
    <div className="capacity-section-heading"><div><h2>日期实际容量</h2><p className="field-muted">核对当天实际生效的名额和工作人员安排。</p></div><button disabled={loading || !date} onClick={() => setRetry(value => value + 1)}>更新实际数据</button></div>
    <div className="capacity-actual-date"><label>查看日期<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><div className="field-actions">{[0, 1, 2, 3].map(offset => { const day = addDays(dateKey(), offset); return <button key={day} aria-pressed={date === day} onClick={() => setDate(day)}>{offset === 0 ? '今天' : day.slice(5).replace('-', '/')}</button>; })}</div></div>
    <Notice>{error}</Notice>{error && <button onClick={() => setRetry(value => value + 1)}>重试</button>}
    <p className="workspace-update" role="status">{loading ? '正在更新实际数据…' : !date ? '请选择日期。' : ''}</p>
    {data && <>
      <div className="capacity-source"><span>{data.source === 'snapshot' ? '已形成当日容量快照' : '使用每周模板'}</span><p>{data.source === 'snapshot' ? '当天容量已固定，后续模板调整不影响此日期。' : '尚无固定快照；首次预约前，容量随对应星期的模板更新。'}</p></div>
      <div className="capacity-actual-layout"><div><h3>预约人数</h3>{data.items.length ? <div className="capacity-actual-slots">{data.items.map(item => <article key={item.timeSlot}><strong>{item.timeSlot}</strong><div><span>名额 <b>{item.capacity}</b></span><span>已占用 <b>{item.occupied}</b></span><span>剩余 <b>{Math.max(0, item.capacity - item.occupied)}</b></span></div></article>)}</div> : <p className="field-muted">此日期没有配置预约时段。</p>}<p className="field-muted">已占用名额包含已完成、已过期预约；取消预约释放名额。现场临时登记不占用预约名额。</p></div>
      <div className="capacity-staffing"><h3>工作人员</h3>{data.staffing ? <><dl>{Object.entries(data.staffing).map(([type, count]) => <div key={type}><dt>{type === 'repair' ? '维修排班' : '办公排班'}</dt><dd>{count} 人</dd></div>)}</dl><p className="field-muted">预计出勤按已发布班次去重，并扣除已批准请假；实际到岗以签到记录为准。</p></> : <p className="field-muted">人员安排请在有权限的排班管理页查看。</p>}{onNavigate && <button onClick={() => onNavigate('roster')}>查看我的班次</button>}</div></div>
    </>}
  </section>;
}
