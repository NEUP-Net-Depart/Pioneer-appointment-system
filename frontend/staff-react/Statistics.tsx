import { useQuery } from '@tanstack/react-query';
import { MotionMeter } from './MotionMeter';
import { DataValue } from './DataValue';
import React, { useContext, useState } from 'react';
import { ActivityContext, Notice } from './field/ui';
import { WorkspaceHeader } from './WorkspaceHeader';
import { AnimatedValue } from './AnimatedValue';
import { Select, DatePicker } from './SelectionControls.jsx';
import { RefreshButton } from './WorkspaceToolbar.jsx';
import { dateKey } from '../../shared/time.js';
import { HelpHint } from './HelpHint';

type Summary = {
  total: number;
  completed: number;
  cancelled: number;
  expired: number;
  repairSuccessRate: number;
  linkedRepairs: number;
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
              <DataValue label={`${label}数量`}>{count}</DataValue>
              <small data-motion-value="number">
                {' '}
                ·{' '}
                <DataValue
                  label={`${label}占比`}
                >{`${total ? Math.round((count / total) * 100) : 0}%`}</DataValue>
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
  const result = useQuery<Summary>({
    queryKey: ['/api/stats/summary', { range, day }],
    enabled: active
  });
  const data = result.data;
  const loading = result.isPending;
  const error = result.error?.message;
  const metrics: [string, number | string | undefined][] = [
    ['预约总数', data?.total],
    ['已完成维修', data?.completed],
    ['关联返修', data?.linkedRepairs],
    ['修复成功率', data ? `${data.repairSuccessRate}%` : undefined],
    ['已取消', data?.cancelled],
    ['已逾期', data?.expired]
  ];
  return (
    <section className="report-workspace">
      <WorkspaceHeader group="现场工作" title="统计分析">
        <HelpHint data-track="staff.statistics.helphint.6" label="统计口径">
          每日服务按预约日期统计；故障分类按已完成维修统计；校区分布按预约总数统计。维修人员工作量为实际开始与完成记录，不代表值班考勤。
        </HelpHint>
        <RefreshButton
          data-track="staff.statistics.button.1"
          key={`${range}:${day}`}
          onRefresh={() => result.refetch({ throwOnError: true })}
          label="刷新统计"
        />
      </WorkspaceHeader>
      <section className="field-card report-filters" aria-label="统计范围">
        <label>
          统计范围
          <Select
            data-track="staff.statistics.select.2"
            value={day ? 'day' : range}
            onChange={(event) => {
              if (event.target.value === 'day') setDay(dateKey());
              else {
                setRange(event.target.value);
                setDay('');
              }
            }}
          >
            <option value="7">最近 7 天</option>
            <option value="30">最近 30 天</option>
            <option value="all">全部记录</option>
            <option value="day">指定日期</option>
          </Select>
        </label>
        <label>
          查看单日
          <DatePicker
            data-track="staff.statistics.input.3"
            value={day}
            onChange={(event) => setDay(event.target.value)}
          />
        </label>
        {day && (
          <button data-track="staff.statistics.button.4" onClick={() => setDay('')}>
            清除日期
          </button>
        )}
      </section>
      <Notice>{error}</Notice>
      <div aria-busy={loading}>
        <div className="report-metrics">
          {metrics.map(([name, count]) => (
            <article data-motion-item="" className="field-card" key={name}>
              <span data-motion-value="text">{name}</span>
              <strong>
                <DataValue label={name} preset="metric" digits={6} pending={loading}>
                  {count}
                </DataValue>
              </strong>
            </article>
          ))}
        </div>

        <div className="report-grid">
          <section className="field-card report-wide">
            <h2>每日服务</h2>
            {data && Object.keys(data.daily).length ? (
              <div className="report-daily">
                {Object.entries(data.daily).map(([date, counts]) => (
                  <article data-motion-item={date} key={date}>
                    <time dateTime={date}>{date.slice(5).replace('-', '/')}</time>
                    <strong>
                      <AnimatedValue value={counts.total} />
                      <small> 条预约</small>
                    </strong>
                    <span data-motion-value="text">完成 {counts.completed} 条</span>
                  </article>
                ))}
              </div>
            ) : data ? (
              <p className="field-muted">当前范围没有预约。</p>
            ) : null}
          </section>
          <section className="field-card">
            <h2>故障分类</h2>
            {data && <Distribution values={data.faults} total={data.completed} />}
          </section>
          <section className="field-card">
            <h2>校区分布</h2>
            {data && <Distribution values={data.campuses} total={data.total} />}
          </section>
          <section className="field-card report-wide">
            <h2>维修人员工作量</h2>
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
            {data && !Object.keys(data.technicians).length && (
              <p className="field-muted">当前范围没有已分配维修。</p>
            )}
          </section>
        </div>
        {!data && !loading && error && (
          <button data-track="staff.statistics.button.5" onClick={() => result.refetch()}>
            重新读取统计
          </button>
        )}
      </div>
    </section>
  );
}
