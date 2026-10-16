import React, { useContext, useEffect, useState } from 'react';
import { ActivityContext, api, Notice, time } from './field/ui';

type Record = { id: string; businessDate: string; occurredAt: string; campusId?: string; type: string; nonScheduled: boolean };
const campusNames: { [key: string]: string } = { 'campus-nanhu': '南湖校区', 'campus-hunnan': '浑南校区' };

export function Attendance({ onNavigate }: { onNavigate: (route: string) => void }) {
  const routeActive = useContext(ActivityContext);
  const [items, setItems] = useState<Record[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    if (!routeActive) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    api<{ items: Record[] }>('/api/me/attendance', { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setItems(data.items); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refreshKey, routeActive]);
  return <section className="attendance-history">
    <header className="field-top"><div><p className="field-kicker">我的</p><h1>本人签到记录</h1><p className="field-muted">查看已完成的签到。当前是否在岗，以今日工作台为准。</p></div><button type="button" onClick={() => onNavigate('scene:mine')}>返回个人中心</button></header>
    <Notice>{error}</Notice>
    <section className="field-card" aria-busy={loading}>
      <div className="field-section-heading"><h2>签到历史</h2><button type="button" disabled={loading} onClick={() => setRefreshKey(value => value + 1)}>{loading ? '正在更新…' : '刷新记录'}</button></div>
      {!items.length && <p className="field-muted">{loading ? '正在读取签到记录…' : error ? '暂时无法读取，请重试。' : '还没有签到记录。到岗后，请使用扫一扫识别工作人员签到码。'}</p>}
      <ul className="attendance-history-list">{items.map(item => <li key={item.id}><div><strong>{item.businessDate}</strong><span>{item.type === 'duty' ? '值班签到' : item.type === 'meeting' ? '活动签到' : '签到记录'} · {item.campusId ? campusNames[item.campusId] || '指定校区' : '场次指定地点'}</span></div><div><time dateTime={item.occurredAt}>{time(item.occurredAt)}</time><small>{item.nonScheduled ? '非排班到岗' : '已记录'}</small></div></li>)}</ul>
    </section>
  </section>;
}
