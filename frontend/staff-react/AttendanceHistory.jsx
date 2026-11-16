import React, { useState } from 'react';
import { DataValue } from './DataValue';
import { time } from './field/ui';
import { dutyTypeLabels } from '../../shared/duty.js';
import { Search, Download, ChevronDown, ArrowUpRight, Users } from 'lucide-react';
import './attendance-history.css';

const labels = {
  arrived: '已签到',
  absent: '缺勤',
  leave: '已请假',
  upcoming: '待签到',
  paused: '暂停服务'
};
const metrics = [
  ['expected', '应到'],
  ['arrived', '已签到'],
  ['absent', '缺勤'],
  ['leave', '请假'],
  ['support', '临时支援'],
  ['upcoming', '待签到']
];

function sourceText(record) {
  const source = record?.checkinSource;
  if (!source) return '';
  if (source.kind === 'qr') return `签到码：${source.issuerName || '历史记录未保存出码人'}`;
  if (source.kind === 'direct') return '本人直接签到';
  if (source.kind === 'correction')
    return `补录：${source.operatorName || source.operatorAccount || '历史记录未保存操作人'}${source.timeBasis === 'duty_start' ? ' · 按班次开始时间记账' : ''}`;
  return '历史记录未保存签到来源';
}

export function AttendanceHistory({ report, onOpenDay, onExport, downloading }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState(null);
  const rows = report?.rows || [];
  const term = search.trim().toLowerCase();
  const matched = rows.filter((row) =>
    `${row.name} ${row.studentId} ${row.department}`.toLowerCase().includes(term)
  );
  const visible = matched.filter((row) => filter === 'all' || row.summary[filter] > 0);
  const filters = metrics.filter(([key]) => key !== 'expected');
  const totals = Object.fromEntries(
    filters.map(([key]) => [key, matched.filter((row) => row.summary[key] > 0).length])
  );
  return (
    <div className="attendance-history-browser" aria-busy={!report}>
      <div className="history-tools">
        <div className="history-search">
          <Search size={17} aria-hidden="true" />
          <input
            data-track="staff.history.search"
            type="search"
            aria-label="搜索考勤人员"
            placeholder="姓名 / 学号 / 部门"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <button
          data-track="staff.history.export"
          aria-label={downloading ? '正在生成…' : '导出当前结果'}
          title="导出当前结果"
          disabled={!report || !visible.length || downloading}
          onClick={() => onExport(visible)}
        >
          <Download size={16} aria-hidden="true" />
          <span>{downloading ? '正在生成…' : '导出当前结果'}</span>
        </button>
      </div>
      <div className="history-filters" role="group" aria-label="考勤状态筛选">
        <button
          data-track="staff.history.all"
          aria-pressed={filter === 'all'}
          onClick={() => setFilter('all')}
        >
          全部人员
        </button>
        {filters.map(([key, label]) => (
          <button
            data-track="staff.history.filter"
            key={key}
            aria-pressed={filter === key}
            onClick={() => setFilter(filter === key ? 'all' : key)}
          >
            {label}
            <DataValue label={`${label}人员记录数`} digits={2}>
              {report ? totals[key] : undefined}
            </DataValue>
          </button>
        ))}
        <span className="history-result-count" aria-live="polite">
          {report ? `${visible.length} 条人员记录` : ''}
        </span>
      </div>
      <div className="history-columns" aria-hidden="true">
        <span>人员</span>
        <span>应到</span>
        <span>已签到</span>
        <span>缺勤</span>
        <span>请假</span>
        <span>支援</span>
        <span />
      </div>
      {visible.map((row) => {
        const key = `${row.campusId}:${row.memberId}`;
        const open = expanded === key;
        return (
          <section className="history-person" key={key}>
            <button
              data-track="staff.history.person"
              className="history-person-toggle"
              aria-expanded={open}
              aria-controls={`history-${key}`}
              onClick={() => setExpanded(open ? null : key)}
            >
              <span className="history-identity">
                <strong>{row.name}</strong>
                <span>
                  {row.studentId} · {row.campus}
                  {row.department ? ` · ${row.department}` : ''}
                </span>
              </span>
              {metrics.slice(0, 5).map(([metric, label]) => (
                <span
                  className="history-number"
                  key={metric}
                  data-metric={metric}
                  data-zero={row.summary[metric] === 0}
                >
                  <span>{label}</span>
                  <DataValue label={label} digits={2}>
                    {row.summary[metric]}
                  </DataValue>
                </span>
              ))}
              <span className="history-chevron" aria-hidden="true">
                <ChevronDown size={17} />
              </span>
            </button>
            <div
              id={`history-${key}`}
              className="history-disclosure"
              data-open={open}
              aria-hidden={!open}
              inert={!open}
            >
              <div className="history-disclosure-inner">
                <div className="history-entries">
                  {row.entries.map((entry) => (
                    <article className="history-entry" key={entry.businessDate}>
                      <div>
                        <strong>{entry.businessDate.slice(5).replace('-', '/')}</strong>
                        <span className="history-entry-status" data-status={entry.status}>
                          {entry.support ? '临时支援' : labels[entry.status]}
                        </span>
                      </div>
                      <div className="history-entry-facts">
                        <span>
                          {entry.assignments
                            .map(
                              (item) =>
                                `${dutyTypeLabels[item.dutyType]} ${item.startAt}–${item.endAt}${item.leaveStatus === 'recorded' ? '（已请假）' : ''}`
                            )
                            .join('、') || '无排班'}
                        </span>
                        {entry.record && (
                          <span>
                            签到 {time(entry.record.occurredAt)}
                            {sourceText(entry.record) ? ` · ${sourceText(entry.record)}` : ''}
                          </span>
                        )}
                      </div>
                      {row.canManage && onOpenDay && (
                        <button
                          data-track="staff.history.open-day"
                          onClick={() =>
                            onOpenDay({
                              campusId: row.campusId,
                              businessDate: entry.businessDate,
                              memberId: row.memberId
                            })
                          }
                        >
                          查看当日考勤
                          <ArrowUpRight size={14} aria-hidden="true" />
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </section>
        );
      })}
      {report && !visible.length && (
        <div className="history-empty">
          <Users size={26} aria-hidden="true" />
          {rows.length ? '没有符合筛选条件的人员' : '本月暂无排班或签到记录'}
          {rows.length > 0 && (
            <button
              data-track="staff.history.reset"
              onClick={() => {
                setSearch('');
                setFilter('all');
              }}
            >
              重置筛选
            </button>
          )}
        </div>
      )}
    </div>
  );
}
