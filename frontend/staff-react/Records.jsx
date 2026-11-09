import { DataValue } from './DataValue';
import { recordServiceDate } from '../../shared/record-filters.js';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../shared/api.js';
import { statusLabels, TIME_SLOTS, outcomeLabels } from '../../shared/constants.js';
import { addDays, dateKey, serviceDay, weekRange } from '../../shared/time.js';
import { request } from './request.js';
import { ActivityContext, Modal, Notice, Status } from './field/ui';
import { Repair } from './field/Repair';
import { WorkspaceHeader } from './WorkspaceHeader';
import { WorkspaceSections } from './WorkspaceSections';
import { WorkspaceMoreActions } from './WorkspaceMoreActions';
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
  const today = dateKey(),
    week = weekRange(today);
  const [defaultDate, setDefaultDate] = useState(null);
  const [filters, setFilters] = useState(cleanFilters),
    [search, setSearch] = useState(''),
    [sorts, setSorts] = useState([]),
    [revision, setRevision] = useState(0),
    [menu, setMenu] = useState(''),
    [selected, setSelected] = useState(''),
    [message, setMessage] = useState('');
  const loadMoreSentinel = useRef(null);
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
    limit: '30',
    deferCounts: '1',
    sorts: sorts.map((item) => `${item.key}:${item.direction}`).join(',')
  });
  const list = useWorkspaceQuery(
    `/api/appointments?${query}`,
    active && defaultDate !== null,
    revision
  );
  const countsQuery = new URLSearchParams({
    ...filters,
    limit: '1',
    sorts: sorts.map((item) => `${item.key}:${item.direction}`).join(',')
  });
  const countsResult = useWorkspaceQuery(
    `/api/appointments/counts?${countsQuery}`,
    active && defaultDate !== null && list.current && !!list.data && menu === 'status',
    revision
  );
  const overview = useWorkspaceQuery('/api/appointments/overview', active, revision);
  useEffect(() => {
    if (!overview.data && (!overview.error || defaultDate !== null)) return;
    const date = recordServiceDate(overview.data, today) || today;
    if (defaultDate === date) return;
    setDefaultDate(date);
    setFilters((current) =>
      defaultDate === null || (current.date === defaultDate && !current.dateFrom)
        ? { ...current, date, dateFrom: '', dateTo: '' }
        : current
    );
  }, [overview.data, overview.error, defaultDate, today]);
  useEffect(() => {
    const node = loadMoreSentinel.current;
    if (!active || !node || !list.nextCursor || !list.current || list.error) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !list.loading && !list.loadingMore)
          list.loadMore();
      },
      { rootMargin: `${Math.round(window.innerHeight * 2)}px 0px` }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [active, list.nextCursor, list.current, list.loading, list.loadingMore, list.error]);
  const refresh = () => setRevision((value) => value + 1);
  const update = (patch) => setFilters((current) => ({ ...current, ...patch }));
  const reset = () => {
    setSearch('');
    setFilters({ ...cleanFilters, date: defaultDate || today });
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
    counts = countsResult.current ? countsResult.data?.filteredCounts || {} : {};
  const searchCapabilities = data?.searchCapabilities;
  const searchPlaceholder = [
    '编号',
    '设备',
    searchCapabilities?.identity && '姓名、完整学号',
    searchCapabilities?.contact && '完整联系方式'
  ]
    .filter(Boolean)
    .join('、');
  const ownCustomerSearch =
    searchCapabilities?.identityScope === 'own' && searchCapabilities?.contactScope === 'own';
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
  const datePreset =
    filters.date === defaultDate && !filters.dateFrom
      ? 'today'
      : filters.dateFrom === week.start && filters.dateTo === week.end
        ? 'week'
        : !filters.date && !filters.dateFrom && !filters.dateTo
          ? 'all'
          : '';
  const statusItems = [
    { id: 'all', label: '全部预约' },
    { id: 'pending', label: '待处理' },
    { id: 'in_progress', label: '维修中' },
    { id: 'completed', label: '已完成' }
  ];
  const summaries = {
    createdAt: '预约编号',
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
        <strong data-motion-value="text">
          {columns[key]} {!value && <span aria-hidden="true"> ↕</span>}
          {value && (
            <small data-motion-value="text">
              {value.direction === 'asc' ? '↑' : '↓'}
              {index + 1}
            </small>
          )}
        </strong>
      </button>
    );
  };
  return (
    <section className="records-workspace">
      <WorkspaceHeader group="现场工作" title="预约记录">
        <button onClick={refresh}>刷新记录</button>
        {staffPermission(user, 'statistics.read') && (
          <WorkspaceMoreActions>
            <button onClick={exportRecords}>导出全部可见记录</button>
          </WorkspaceMoreActions>
        )}
      </WorkspaceHeader>
      <Notice>{message}</Notice>
      <RecordOverview
        result={overview}
        filters={filters}
        campuses={user.authorizedCampuses}
        onFilter={(patch) => {
          setSearch('');
          update({ ...patch, q: '' });
        }}
      />
      <section className="records-panel" aria-label="预约查询">
        <WorkspaceSections
          label="预约处理状态"
          items={statusItems}
          value={filters.status}
          onChange={(status) => update({ status })}
        />
        <div className="records-toolbar">
          <label>
            查找预约
            <input
              type="search"
              aria-label="查找预约"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={searchPlaceholder}
            />
          </label>
          <div className="records-filter-actions">
            <button onClick={() => setMenu('date')}>
              {period}
              {filters.timeSlot ? ` · ${filters.timeSlot}` : ''}
            </button>
            <button onClick={() => setMenu('campus')}>{summaries.campus}</button>
            <button
              aria-label="更多预约状态"
              aria-haspopup="dialog"
              onClick={() => setMenu('status')}
            >
              {statusItems.some((item) => item.id === filters.status) ? '更多状态' : statusText}
            </button>
            <button onClick={reset}>重置</button>
          </div>
        </div>
        <div className="records-result-tools">
          <div className="records-quick-dates" role="group" aria-label="快捷预约日期">
            {[
              ['today', '当期预约'],
              ['week', '本周预约'],
              ['all', '不限日期']
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={datePreset === id}
                onClick={() =>
                  update({
                    date: id === 'today' ? defaultDate || today : '',
                    dateFrom: id === 'week' ? week.start : '',
                    dateTo: id === 'week' ? week.end : ''
                  })
                }
              >
                {label}
              </button>
            ))}
          </div>
          <div className="records-result-meta" role="status">
            <span>
              已加载{' '}
              <DataValue label="已加载记录数">
                {data ? data.items?.length || 0 : undefined}
              </DataValue>{' '}
              条{list.refreshing ? ' · 后台更新中' : ''}
              {!list.current && data ? ' · 当前显示上次结果' : ''}
            </span>
            {sorts.length > 0 && (
              <span>
                {`排序：${sorts.map((item, index) => `${index + 1}. ${columns[item.key]}${item.direction === 'asc' ? '↑' : '↓'}`).join(' → ')}`}
              </span>
            )}
          </div>
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
        <div data-motion-list="reveal" className="records-table-wrap" aria-busy={list.loading}>
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
                    <strong data-motion-value="text">{item.name || item.id}</strong>
                    {item.name && (
                      <span data-motion-value="text">
                        {[item.studentId, item.id].filter(Boolean).join(' · ')}
                      </span>
                    )}
                    {item.repairNumber && (
                      <span data-motion-value="text">历史维修编号：{item.repairNumber}</span>
                    )}
                  </td>
                  <td data-label="预约时间">
                    <strong data-motion-value="text">{dayLabel(item.date)}</strong>
                    <span data-motion-value="text">{item.timeSlot}</span>
                  </td>
                  <td data-label="状态">
                    <Status value={item.status} />
                    {item.outcome && (
                      <span data-motion-value="text">
                        {outcomeLabels[item.outcome] || '结果已记录'}
                      </span>
                    )}
                  </td>
                  <td data-label="校区">{item.campus}</td>
                  <td data-label="设备">
                    <strong data-motion-value="text">
                      {[item.brand, item.deviceModel || item.deviceType].filter(Boolean).join(' ')}
                    </strong>
                    <span data-motion-value="text">
                      {item.repairNote || item.faultType || '等待现场核验'}
                    </span>
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
        <div ref={loadMoreSentinel} className="records-load-sentinel" aria-hidden="true" />
        {!data?.items?.length && defaultDate !== null && !list.loading && !list.error && (
          <div className="field-empty">
            <strong>没有符合条件的预约</strong>
            <p>
              {filters.q
                ? '核查输入是否正确，并检查日期、校区和状态筛选。'
                : '调整日期、校区和状态筛选。'}
              {filters.q && ownCustomerSearch && '仅由你处理的工单可查姓名、学号和联系方式。'}
            </p>
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
          onClose={() => setSelected('')}
          onChanged={refresh}
          sidePanel
          hideWarrantyLookup
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
                  <small data-motion-value="text">
                    <DataValue label={`${label}数量`}>
                      {value === 'pending'
                        ? counts.booked === undefined
                          ? undefined
                          : counts.booked + counts.in_progress
                        : counts[value]}
                    </DataValue>
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

function RecordOverview({ result, filters, campuses, onFilter }) {
  const data = result.data;
  const date = filters.dateFrom || !filters.date ? 'week' : filters.date;
  const weekly = date === 'week';
  const period = weekly
    ? { date: '', dateFrom: data?.week.start || '', dateTo: data?.week.end || '' }
    : { date, dateFrom: '', dateTo: '' };
  function select(patch = {}) {
    onFilter({ ...filters, ...period, ...patch });
  }
  return (
    <section className="records-overview" aria-label="近期预约概览">
      <details className="records-overview-disclosure" open>
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
          <span data-motion-value="text" className="workspace-update" role="status">
            {result.loading
              ? '正在更新…'
              : data
                ? `更新于 ${new Date(data.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' })}`
                : '读取预约概览'}
          </span>
          <Notice>{result.error}</Notice>
          {
            <>
              <div className="records-periods">
                {[
                  'week',
                  ...(data?.dates ||
                    Array.from({ length: 7 }, (_, index) => addDays(dateKey(), index)).filter(
                      serviceDay
                    ))
                ].map((value) => (
                  <button
                    key={value}
                    disabled={!data}
                    aria-pressed={
                      value === 'week'
                        ? filters.dateFrom === data?.week.start && !!filters.dateFrom
                        : filters.date === value
                    }
                    onClick={() => {
                      onFilter({
                        campus: 'all',
                        timeSlot: '',
                        status: 'all',
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
                {(data?.campuses || campuses).map((campus) => {
                  let items = (
                    data
                      ? weekly
                        ? data.week.items
                        : data.items
                      : TIME_SLOTS.map((timeSlot) => ({ campus, date, timeSlot }))
                  ).filter((item) => item.campus === campus && (weekly || item.date === date));
                  if (weekly && data)
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
                    <article className="field-card records-campus" key={campus} aria-busy={!data}>
                      <h3>
                        <button
                          aria-pressed={filters.campus === campus}
                          onClick={() => select({ campus })}
                        >
                          {campus}校区
                        </button>
                      </h3>
                      {items.map((item) => (
                        <div
                          className="records-slot"
                          key={item.timeSlot}
                          data-selected={
                            (filters.campus === 'all' || filters.campus === campus) &&
                            filters.timeSlot === item.timeSlot
                          }
                        >
                          <button
                            className="records-slot-main"
                            disabled={!data}
                            aria-pressed={
                              (filters.campus === 'all' || filters.campus === campus) &&
                              filters.timeSlot === item.timeSlot
                            }
                            onClick={() => select({ campus, timeSlot: item.timeSlot })}
                          >
                            <strong data-motion-value="text">{item.timeSlot}</strong>
                            <span data-motion-value="text">
                              {!data ? (
                                <DataValue label="剩余名额" />
                              ) : item.paused ? (
                                '暂停服务'
                              ) : item.ended ? (
                                '时段已结束'
                              ) : !item.capacity ? (
                                '暂停预约'
                              ) : item.occupied > item.capacity ? (
                                '超出当前上限'
                              ) : !item.remaining ? (
                                '名额已满'
                              ) : (
                                <>
                                  剩余 <DataValue label="剩余名额">{item.remaining}</DataValue> 名
                                </>
                              )}
                            </span>
                          </button>
                          <div className="records-slot-status">
                            <span data-motion-value="text">
                              已占 <DataValue label="已占名额">{item.occupied}</DataValue> /{' '}
                              <DataValue label="容量">{item.capacity}</DataValue>
                            </span>
                            <button
                              disabled={!data}
                              aria-pressed={
                                filters.campus === campus &&
                                filters.timeSlot === item.timeSlot &&
                                filters.status === 'booked'
                              }
                              onClick={() =>
                                select({ campus, timeSlot: item.timeSlot, status: 'booked' })
                              }
                            >
                              待接收 <DataValue label="待接收">{item.booked}</DataValue>
                            </button>
                            <button
                              disabled={!data}
                              aria-pressed={
                                filters.campus === campus &&
                                filters.timeSlot === item.timeSlot &&
                                filters.status === 'in_progress'
                              }
                              onClick={() =>
                                select({ campus, timeSlot: item.timeSlot, status: 'in_progress' })
                              }
                            >
                              维修中 <DataValue label="维修中">{item.inProgress}</DataValue>
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
          }
        </div>
      </details>
    </section>
  );
}
