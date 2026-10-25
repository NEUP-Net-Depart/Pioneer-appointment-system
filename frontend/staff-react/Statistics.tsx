import { MotionMeter } from './MotionMeter';
import { DataValue } from './DataValue';
import React, { useContext, useEffect, useState } from 'react';
import { ActivityContext, api, Notice } from './field/ui';
import { WorkspaceHeader } from './WorkspaceHeader';
import { AnimatedValue } from './AnimatedValue';

type Summary = {
  total: number;
  completed: number;
  cancelled: number;
  expired: number;
  repairSuccessRate: number;
  completionRate: number;
  daily: Record<string, { total: number; completed: number }>;
  faults: Record<string, number>;
  campuses: Record<string, number>;
  technicians: Record<string, { assignedToName?: string; started: number; completed: number }>;
};

function Distribution({ values, total }: { values: Record<string, number>; total: number }) {
  const entries = Object.entries(values).sort((a, b) => b[1] - a[1]);
  const maximum = Math.max(1, ...entries.map(([, count]) => count));
  return entries.length ? (
    <ul className="report-distribution">
      {entries.map(([label, count]) => (
        <li data-motion-item="" key={label}>
          <div>
            <span data-motion-value="text">{label}</span>
            <strong>
              <span data-motion-value="number">{count}</span>
              <small data-motion-value="number">
                {' '}
                · {total ? Math.round((count / total) * 100) : 0}%
              </small>
            </strong>
          </div>
          <MotionMeter max={maximum} value={count} label={`${label} ${count} 条`} />
        </li>
      ))}
    </ul>
  ) : (
    <p className="field-muted">当前范围没有记录。</p>
  );
}

export function Statistics() {
  const active = useContext(ActivityContext);
  const [range, setRange] = useState('7'),
    [day, setDay] = useState('');
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<{ data: Summary; label: string } | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const label = day || (range === 'all' ? '全部记录' : `最近 ${range} 天`);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api<Summary>(`/api/stats/summary?${new URLSearchParams({ range, day })}`, {
      signal: controller.signal
    })
      .then((data) => {
        if (!controller.signal.aborted) setSnapshot({ data, label });
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          if ([401, 403].includes(failure.status)) setSnapshot(null);
          setError(failure.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [active, range, day, revision, label]);
  const data = snapshot?.data;
  const metrics = data
    ? [
        ['预约总数', data.total],
        ['已完成维修', data.completed],
        ['修复成功率', `${data.repairSuccessRate}%`],
        ['已取消', data.cancelled],
        ['已逾期', data.expired]
      ]
    : ['预约总数', '已完成维修', '修复成功率', '已取消', '已逾期'].map((name) => [name, '—']);
  return (
    <section className="report-workspace">
      <WorkspaceHeader group="数据与审计" title="统计分析">
        <button disabled={loading} onClick={() => setRevision((value) => value + 1)}>
          刷新统计
        </button>
      </WorkspaceHeader>
      <section className="field-card report-filters" aria-label="统计范围">
        <label>
          统计范围
          <select
            value={range}
            onChange={(event) => {
              setRange(event.target.value);
              setDay('');
            }}
          >
            <option value="7">最近 7 天</option>
            <option value="30">最近 30 天</option>
            <option value="all">全部记录</option>
          </select>
        </label>
        <label>
          查看单日
          <input type="date" value={day} onChange={(event) => setDay(event.target.value)} />
        </label>
        {day && <button onClick={() => setDay('')}>清除日期</button>}
        <span data-motion-value="text" role="status">
          {loading ? `正在读取${label}，保留已有结果…` : `当前显示：${snapshot?.label || label}`}
        </span>
      </section>
      <Notice>{error}</Notice>
      <div aria-busy={loading}>
        <div className="report-metrics">
          {metrics.map(([name, count]) => (
            <article data-motion-item="" className="field-card" key={name}>
              <span data-motion-value="text">{name}</span>
              <strong>
                <AnimatedValue value={count} />
              </strong>
            </article>
          ))}
        </div>

        <div className="report-grid">
          <section className="field-card report-wide">
            <h2>每日服务</h2>
            <p className="field-muted">按预约日期统计；完成数包含已结束的维修。</p>
            {!data ? (
              <DataValue label="每日服务记录" pending={loading} />
            ) : Object.keys(data.daily).length ? (
              <div className="report-daily">
                {Object.entries(data.daily).map(([date, counts]) => (
                  <article data-motion-item={date} key={date}>
                    <time dateTime={date}>{date.slice(5).replace('-', '/')}</time>
                    <strong>
                      {counts.total}
                      <small> 条预约</small>
                    </strong>
                    <span data-motion-value="text">完成 {counts.completed} 条</span>
                  </article>
                ))}
              </div>
            ) : (
              <p className="field-muted">当前范围没有预约。</p>
            )}
          </section>
          <section className="field-card">
            <h2>故障分类</h2>
            <p className="field-muted">按已完成维修统计</p>
            {data ? (
              <Distribution values={data.faults} total={data.completed} />
            ) : (
              <DataValue label="故障分类" pending={loading} />
            )}
          </section>
          <section className="field-card">
            <h2>校区分布</h2>
            <p className="field-muted">按预约总数统计</p>
            {data ? (
              <Distribution values={data.campuses} total={data.total} />
            ) : (
              <DataValue label="校区分布" pending={loading} />
            )}
          </section>
          <section className="field-card report-wide">
            <h2>维修人员工作量</h2>
            <p className="field-muted">实际开始与完成记录，不代表值班考勤。</p>
            <div className="report-workload">
              {Object.entries(data?.technicians || {})
                .sort((a, b) => b[1].completed - a[1].completed)
                .map(([account, counts]) => (
                  <article data-motion-item={account} key={account}>
                    <div>
                      <strong data-motion-value="text">{counts.assignedToName || account}</strong>
                      {counts.assignedToName && <small data-motion-value="text">{account}</small>}
                    </div>
                    <span>
                      开始 <b>{counts.started}</b>
                    </span>
                    <span>
                      完成 <b>{counts.completed}</b>
                    </span>
                    <span>
                      完成率{' '}
                      <b>
                        {counts.started ? Math.round((counts.completed / counts.started) * 100) : 0}
                        %
                      </b>
                    </span>
                  </article>
                ))}
            </div>
            {!data && <DataValue label="维修人员工作量" pending={loading} />}
            {data && !Object.keys(data.technicians).length && (
              <p className="field-muted">当前范围没有已分配维修。</p>
            )}
          </section>
        </div>
        {!data && !loading && error && (
          <button onClick={() => setRevision((value) => value + 1)}>重新读取统计</button>
        )}
      </div>
    </section>
  );
}
