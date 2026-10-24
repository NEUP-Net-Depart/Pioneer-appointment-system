import { DataFields } from './DataValue';
import React, { useContext, useEffect, useState } from 'react';
import { apiFetch } from '../../shared/api.js';
import { statusLabels, TIME_SLOTS, outcomeLabels } from '../../shared/constants.js';
import { receptionStatus } from '../../shared/reception.js';
import { addDays, dateKey, serviceDay } from '../../shared/time.js';
import { request } from './request.js';
import { ActivityContext, Modal, Notice, Status } from './field/ui';
import { Repair } from './field/Repair';
import { WorkspaceHeader } from './WorkspaceHeader';
import { staffPermission } from '../../shared/staff-access.js';

import { useWorkspaceQuery } from './useWorkspaceQuery.js';

const cleanFilters = {
  q: '',
  campus: 'all',
  date: '',
  timeSlot: '',
  status: 'all',
  dateFrom: '',
  dateTo: ''
};
const columns = { createdAt: '预约信息', date: '预约时间', status: '状态', campus: '校区' };
const dayLabel = (date) =>
  `${date.slice(5).replace('-', '/')} ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(`${date}T00:00:00Z`).getUTCDay()]}`;

export function Records({ user }) {
  const active = useContext(ActivityContext);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [filters, setFilters] = useState(cleanFilters),
    [search, setSearch] = useState(''),
    [sorts, setSorts] = useState([]),
    [revision, setRevision] = useState(0),
    [menu, setMenu] = useState(''),
    [selected, setSelected] = useState(''),
    [message, setMessage] = useState('');
  useEffect(() => {
    const timer = setTimeout(
      () =>
        setFilters((current) =>
          current.q === search.trim() ? current : { ...current, q: search.trim() }
        ),
      200
    );
    return () => clearTimeout(timer);
  }, [search]);
  const query = new URLSearchParams({
    ...filters,
    limit: '100',
    sorts: sorts.map((item) => `${item.key}:${item.direction}`).join(',')
  });
  const list = useWorkspaceQuery(`/api/appointments?${query}`, active, revision);
  const overview = useWorkspaceQuery(
    '/api/appointments/overview',
    active && overviewOpen,
    revision
  );
  const refresh = () => setRevision((value) => value + 1);
  const update = (patch) => setFilters((current) => ({ ...current, ...patch }));
  const reset = () => {
    setSearch('');
    setFilters(cleanFilters);
    setSorts([]);
  };
  function cycle(key) {
    setSorts((current) => {
      const index = current.findIndex((item) => item.key === key);
      return index < 0
        ? [...current, { key, direction: 'asc' }]
        : current[index].direction === 'asc'
          ? current.map((item) => (item.key === key ? { ...item, direction: 'desc' } : item))
          : current.filter((item) => item.key !== key);
    });
  }
  async function exportRecords() {
    try {
      const response = await apiFetch('/api/export/appointments.csv');
      if (!response.ok) throw new Error((await response.json()).error || '导出失败');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = '先锋维修预约记录.csv';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (failure) {
      setMessage(failure.message);
    }
  }
  const data = list.data,
    counts = data?.filteredCounts || data?.counts || {};
  const statusText =
    filters.status === 'all'
      ? '全部状态'
      : filters.status === 'pending'
        ? '待处理'
        : statusLabels[filters.status] || '其他状态';
  const period = filters.dateFrom
    ? `本周 ${filters.dateFrom.slice(5)}–${filters.dateTo.slice(5)}`
    : filters.date
      ? dayLabel(filters.date)
      : '全部日期';
  const summaries = {
    createdAt: '姓名、学号与预约编号',
    date: [period, filters.timeSlot].filter(Boolean).join(' · '),
    status: statusText,
    campus: filters.campus === 'all' ? '全部校区' : `${filters.campus}校区`
  };
  const sortButton = (key) => {
    const index = sorts.findIndex((item) => item.key === key),
      value = sorts[index];
    return (
      <button
        className="record-sort"
        aria-label={`${columns[key]}${value ? `，第${index + 1}排序，${value.direction === 'asc' ? '升序' : '降序'}` : '，未排序'}；点击${!value ? '升序' : value.direction === 'asc' ? '降序' : '清除排序'}`}
        onClick={() => cycle(key)}
      >
        <strong>
          {columns[key]}{' '}
          {value && (
            <small>
              {value.direction === 'asc' ? '↑' : '↓'}
              {index + 1}
            </small>
          )}
        </strong>
        <span>{summaries[key]}</span>
      </button>
    );
  };
  return (
    <section className="records-workspace">
      <WorkspaceHeader group="今日工作" title="预约记录">
        <button disabled={list.loading || overview.loading} onClick={refresh}>
          刷新记录
        </button>
        {staffPermission(user, 'statistics.read') && (
          <button onClick={exportRecords}>导出全部可见记录</button>
        )}
      </WorkspaceHeader>
      <Notice>{message}</Notice>
      <RecordOverview
        result={overview}
        onOpen={setOverviewOpen}
        onFilter={(patch) => {
          setSearch('');
          update({ ...patch, q: '' });
        }}
      />
      <section className="records-panel" aria-label="预约查询">
        <div className="records-toolbar">
          <label>
            查找预约
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="预约编号、历史维修编号、姓名或学号"
            />
          </label>
          <div className="records-filter-actions">
            <button onClick={() => setMenu('date')}>
              {period}
              {filters.timeSlot ? ` · ${filters.timeSlot}` : ''}
            </button>
            <button onClick={() => setMenu('campus')}>{summaries.campus}</button>
            <button onClick={() => setMenu('status')}>{statusText}</button>
            <button onClick={reset}>重置</button>
          </div>
        </div>
        <div className="records-result-meta" role="status">
          <span>
            {data ? `${data.items?.length || 0} 条记录` : '正在读取记录…'}
            {list.loading && data ? ' · 更新中' : ''}
            {!list.current && data ? ' · 当前显示上次结果' : ''}
          </span>
          <span className={sorts.length ? '' : 'records-sort-hint'}>
            {sorts.length
              ? `排序：${sorts.map((item, index) => `${index + 1}. ${columns[item.key]}${item.direction === 'asc' ? '↑' : '↓'}`).join(' → ')}`
              : '点击表头：升序 → 降序 → 清除，支持组合排序'}
          </span>
        </div>
        <Notice>{list.error}</Notice>
        {list.error && <button onClick={refresh}>重试读取</button>}
        <details className="records-mobile-sort">
          <summary>排序与优先级</summary>
          <div>
            <label>
              组合排序
              <select value="" onChange={(event) => cycle(event.target.value)}>
                <option value="" disabled>
                  选择排序字段
                </option>
                {Object.entries(columns).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {sorts.length > 0 && <button onClick={() => setSorts([])}>清除排序</button>}
          </div>
        </details>
        <div className="records-table-wrap" aria-busy={list.loading}>
          <table className="records-table">
            <thead>
              <tr>
                {Object.keys(columns).map((key) => {
                  const index = sorts.findIndex((item) => item.key === key);
                  return (
                    <th
                      key={key}
                      aria-sort={
                        index < 0
                          ? 'none'
                          : index
                            ? 'other'
                            : sorts[index].direction === 'asc'
                              ? 'ascending'
                              : 'descending'
                      }
                    >
                      {sortButton(key)}
                    </th>
                  );
                })}
                <th>设备与处理说明</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items || []).map((item) => (
                <tr data-motion-item={item.id} key={item.id}>
                  <td data-label="预约信息">
                    <strong>{item.name || '等待到场核验'}</strong>
                    <span>{[item.studentId, item.id].filter(Boolean).join(' · ')}</span>
                    {item.repairNumber && <span>历史维修编号：{item.repairNumber}</span>}
                  </td>
                  <td data-label="预约时间">
                    <strong>{dayLabel(item.date)}</strong>
                    <span>{item.timeSlot}</span>
                  </td>
                  <td data-label="状态">
                    <Status value={receptionStatus(item)} />
                    {item.outcome && <span>{outcomeLabels[item.outcome] || '结果已记录'}</span>}
                  </td>
                  <td data-label="校区">{item.campus}</td>
                  <td data-label="设备">
                    <strong>
                      {[item.brand, item.deviceModel || item.deviceType].filter(Boolean).join(' ')}
                    </strong>
                    <span>{item.repairNote || item.faultType || '等待现场核验'}</span>
                  </td>
                  <td>
                    <button onClick={() => setSelected(item.id)}>查看详情</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.nextCursor && (
          <div className="field-actions">
            <button
              onClick={list.loadMore}
              disabled={list.loadingMore || list.loading || !list.current}
            >
              {list.loadingMore ? '正在加载…' : '加载更多预约'}
            </button>
          </div>
        )}
        {!data?.items?.length && !list.loading && !list.error && (
          <div className="field-empty">
            <strong>没有符合条件的预约</strong>
            <p>可以调整校区、时间和状态，或清除筛选重新查找。</p>
            <button onClick={reset}>清除筛选</button>
          </div>
        )}
      </section>
      {menu && (
        <RecordFilter
          menu={menu}
          filters={filters}
          counts={counts}
          campuses={user.authorizedCampuses}
          slots={[
            ...new Set([
              ...TIME_SLOTS,
              ...(overview.data?.items || []).map((item) => item.timeSlot)
            ])
          ]}
          onChange={update}
          onClose={() => setMenu('')}
        />
      )}
      {selected && (
        <Repair
          key={selected}
          id={selected}
          summary={data?.items?.find((item) => item.id === selected)}
          memberId={user.memberId || user.account}
          people={[]}
          onClose={() => setSelected('')}
          onChanged={refresh}
          returnLabel="返回预约记录"
          sidePanel
        />
      )}
    </section>
  );
}

function RecordFilter({ menu, filters, counts, campuses, slots, onChange, onClose }) {
  const today = dateKey();
  const dates = Array.from({ length: 4 }, (_, index) => addDays(today, index)).filter(serviceDay);
  return (
    <Modal
      title={{ date: '预约时间筛选', campus: '校区筛选', status: '状态筛选' }[menu]}
      onClose={onClose}
      initialFocus={
        menu === 'date' ? '[aria-current="date"], .record-options button' : '.record-options button'
      }
    >
      <div className="record-filter-panel">
        {menu === 'campus' && (
          <div className="record-options">
            {['all', ...campuses].map((value) => (
              <button
                key={value}
                aria-pressed={filters.campus === value}
                onClick={() => onChange({ campus: value === filters.campus ? 'all' : value })}
              >
                {value === 'all' ? '全部校区' : `${value}校区`}
              </button>
            ))}
          </div>
        )}
        {menu === 'status' && (
          <div className="record-options">
            {[['all', '全部状态'], ['pending', '待处理'], ...Object.entries(statusLabels)].map(
              ([value, label]) => (
                <button
                  key={value}
                  aria-pressed={filters.status === value}
                  onClick={() => onChange({ status: filters.status === value ? 'all' : value })}
                >
                  {label}
                  <small>
                    {value === 'pending'
                      ? (counts.booked || 0) + (counts.in_progress || 0)
                      : counts[value] || 0}
                  </small>
                </button>
              )
            )}
          </div>
        )}
        {menu === 'date' && (
          <>
            <div className="record-options">
              {dates.map((date) => (
                <button
                  key={date}
                  aria-current={date === today ? 'date' : undefined}
                  aria-pressed={filters.date === date}
                  onClick={() =>
                    onChange({ date: filters.date === date ? '' : date, dateFrom: '', dateTo: '' })
                  }
                >
                  {dayLabel(date)}
                </button>
              ))}
            </div>
            {!dates.length && (
              <p className="field-muted">预约窗口内没有工作日，可以查看历史记录。</p>
            )}
            <label>
              预约时段
              <select
                value={filters.timeSlot}
                onChange={(event) => onChange({ timeSlot: event.target.value })}
              >
                <option value="">全部时段</option>
                {slots.map((slot) => (
                  <option key={slot}>{slot}</option>
                ))}
              </select>
            </label>
            <details className="field-details">
              <summary>查找历史记录</summary>
              <label>
                历史日期
                <input
                  type="date"
                  max={today}
                  value={filters.date <= today ? filters.date : ''}
                  onChange={(event) =>
                    onChange({ date: event.target.value, dateFrom: '', dateTo: '' })
                  }
                />
              </label>
            </details>
            <button onClick={() => onChange({ date: '', dateFrom: '', dateTo: '', timeSlot: '' })}>
              清除时间筛选
            </button>
          </>
        )}
        <div className="field-actions">
          <button className="field-primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RecordOverview({ result, onFilter, onOpen }) {
  const data = result.data;
  const [selected, setSelected] = useState('');
  const selectionExists = selected === 'week' ? !!data?.week : data?.dates.includes(selected);
  const date = selectionExists ? selected : data?.dates[0] || '';
  const weekly = date === 'week';
  const period = weekly
    ? { date: '', dateFrom: data.week.start, dateTo: data.week.end }
    : { date, dateFrom: '', dateTo: '' };
  function select(patch = {}) {
    onFilter({ campus: 'all', timeSlot: '', status: 'all', ...period, ...patch });
  }
  return (
    <section className="records-overview" aria-label="近期预约概览">
      <details
        className="records-overview-disclosure"
        onToggle={(event) => onOpen(event.currentTarget.open)}
      >
        <summary>
          <div>
            <h2>近期预约概览</h2>
          </div>
          <span className="records-overview-toggle">
            <span className="when-closed">查看概览 ＋</span>
            <span className="when-open">收起概览 −</span>
          </span>
        </summary>
        <div className="records-overview-body">
          <span className="workspace-update" role="status">
            {result.loading
              ? '正在更新…'
              : data
                ? `更新于 ${new Date(data.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' })}`
                : '读取预约概览'}
          </span>
          <Notice>{result.error}</Notice>
          {!data && result.loading && !result.error && (
            <DataFields fields={[['预约日期'], ['校区'], ['名额与占用']]} />
          )}
          {data && (
            <>
              <div className="records-periods">
                {[...(data.week ? ['week'] : []), ...data.dates].map((value) => (
                  <button
                    key={value}
                    aria-pressed={date === value}
                    onClick={() => {
                      setSelected(value);
                      onFilter({
                        campus: 'all',
                        timeSlot: '',
                        status: 'all',
                        q: '',
                        ...(value === 'week'
                          ? { date: '', dateFrom: data.week.start, dateTo: data.week.end }
                          : { date: value, dateFrom: '', dateTo: '' })
                      });
                    }}
                  >
                    {value === 'week' ? '本周' : dayLabel(value)}
                  </button>
                ))}
              </div>
              <div className="records-campus-grid">
                {data.campuses.map((campus) => {
                  let items = (weekly ? data.week.items : data.items).filter(
                    (item) => item.campus === campus && (weekly || item.date === date)
                  );
                  if (weekly)
                    items = [...new Set(items.map((item) => item.timeSlot))].map((timeSlot) => {
                      const rows = items.filter((item) => item.timeSlot === timeSlot);
                      const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
                      return {
                        timeSlot,
                        capacity: sum('capacity'),
                        occupied: sum('occupied'),
                        booked: sum('booked'),
                        inProgress: sum('inProgress'),
                        remaining: rows.reduce(
                          (total, row) => total + (row.ended ? 0 : row.remaining),
                          0
                        ),
                        ended: rows.every((row) => row.ended)
                      };
                    });
                  return (
                    <article className="field-card records-campus" key={campus}>
                      <h3>
                        <button onClick={() => select({ campus })}>{campus}校区</button>
                      </h3>
                      {items.map((item) => (
                        <div className="records-slot" key={item.timeSlot}>
                          <button
                            className="records-slot-main"
                            onClick={() => select({ campus, timeSlot: item.timeSlot })}
                          >
                            <strong>{item.timeSlot}</strong>
                            <span>
                              {item.ended
                                ? '时段已结束'
                                : !item.capacity
                                  ? '暂停预约'
                                  : item.occupied > item.capacity
                                    ? '超出当前上限'
                                    : !item.remaining
                                      ? '名额已满'
                                      : `剩余 ${item.remaining} 名`}
                            </span>
                          </button>
                          <div className="records-slot-status">
                            <span>
                              已占 {item.occupied} / {item.capacity}
                            </span>
                            <button
                              onClick={() =>
                                select({ campus, timeSlot: item.timeSlot, status: 'booked' })
                              }
                            >
                              待签到 {item.booked}
                            </button>
                            <button
                              onClick={() =>
                                select({ campus, timeSlot: item.timeSlot, status: 'in_progress' })
                              }
                            >
                              维修中 {item.inProgress}
                            </button>
                          </div>
                        </div>
                      ))}
                      {!items.length && <p className="field-muted">该日期没有预约时段。</p>}
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </details>
    </section>
  );
}
