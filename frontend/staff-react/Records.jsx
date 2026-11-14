import { DatePicker } from './SelectionControls.jsx';
import { RefreshButton } from './WorkspaceToolbar.jsx';
import { DataValue } from './DataValue';
import { recordServiceDate } from '../../shared/record-filters.js';
import React, { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { apiFetch } from '../../shared/api.js';
import { statusLabels, TIME_SLOTS } from '../../shared/constants.js';
import { addDays, dateKey, serviceDay, calendarWeekRange as weekRange } from '../../shared/time.js';
import { ActivityContext, Notice, Status } from './field/ui';
import { Repair } from './field/Repair';
import { WorkspaceHeader } from './WorkspaceHeader';
import { WorkspaceMoreActions } from './WorkspaceMoreActions';
import { staffPermission } from '../../shared/staff-access.js';
import './records-workspace.css';

import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';

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
  const client = useQueryClient();
  const today = dateKey(),
    week = weekRange(today);
  const [defaultDate, setDefaultDate] = useState(null);
  const [filters, setFilters] = useState(cleanFilters),
    [search, setSearch] = useState(''),
    [sorts, setSorts] = useState([]),
    [menu, setMenu] = useState(''),
    [selected, setSelected] = useState(''),
    [message, setMessage] = useState('');
  const loadMoreSentinel = useRef(null);
  const filterTrigger = useRef(null);
  const [overflowStatuses, setOverflowStatuses] = useState([]);
  const browseFilters = useRef(null);
  function changeSearch(value) {
    if (value.trim() && !browseFilters.current) {
      browseFilters.current = filters;
      setFilters({ ...cleanFilters });
    } else if (!value.trim() && browseFilters.current) {
      setFilters({ ...browseFilters.current, q: '' });
      browseFilters.current = null;
    }
    setSearch(value);
  }
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
  const list = useInfiniteQuery({
    queryKey: ['/api/appointments', Object.fromEntries(query)],
    enabled: active && defaultDate !== null,
    initialPageParam: '',
    getNextPageParam: (page) => page.nextCursor || undefined,
    staleTime: (query) => (query.state.data?.pages.length > 1 ? 120000 : 30000),
    refetchInterval: (query) => (query.state.data?.pages.length > 1 ? 120000 : 30000)
  });
  const items = [
    ...new Map(
      (list.data?.pages.flatMap((page) => page.items) || []).map((item) => [item.id, item])
    ).values()
  ];
  const countsQuery = new URLSearchParams({
    ...filters,
    limit: '1',
    sorts: sorts.map((item) => `${item.key}:${item.direction}`).join(',')
  });
  const countsResult = useQuery({
    queryKey: ['/api/appointments/counts', Object.fromEntries(countsQuery)],
    enabled: active && defaultDate !== null && !!list.data && menu === 'status'
  });
  const overview = useQuery({ queryKey: ['/api/appointments/overview'], enabled: active });
  useEffect(() => {
    if (!overview.data && (!overview.error || defaultDate !== null)) return;
    const date = recordServiceDate(overview.data, today) || today;
    if (defaultDate === date) return;
    setDefaultDate(date);
    setFilters((current) =>
      !browseFilters.current &&
      (defaultDate === null || (current.date === defaultDate && !current.dateFrom))
        ? { ...current, date, dateFrom: '', dateTo: '' }
        : current
    );
  }, [overview.data, overview.error, defaultDate, today]);
  useLayoutEffect(() => {
    const node = loadMoreSentinel.current;
    if (!active || !node || !list.hasNextPage || !list.data || list.error) return undefined;
    let observing = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          observing &&
          entries.some((entry) => entry.isIntersecting) &&
          node.getBoundingClientRect().top <= window.innerHeight * 3 &&
          !list.isFetching
        )
          list.fetchNextPage({ cancelRefetch: false });
      },
      { rootMargin: `${Math.round(window.innerHeight * 2)}px 0px` }
    );
    observer.observe(node);
    return () => {
      observing = false;
      observer.disconnect();
    };
  }, [active, list.hasNextPage, list.data, list.isFetching, list.error]);
  const refresh = (throwOnError = false) =>
    Promise.all(
      ['/api/appointments', '/api/appointments/counts', '/api/appointments/overview'].map((path) =>
        client.invalidateQueries({ queryKey: [path] }, { throwOnError })
      )
    );
  const update = (patch) => setFilters((current) => ({ ...current, ...patch }));
  const updateOverview = (patch) =>
    setFilters((current) => {
      const descendants =
        Object.hasOwn(patch, 'date') || Object.hasOwn(patch, 'dateFrom')
          ? { campus: 'all', timeSlot: '', status: 'all' }
          : Object.hasOwn(patch, 'campus')
            ? { timeSlot: '', status: 'all' }
            : Object.hasOwn(patch, 'timeSlot')
              ? { status: 'all' }
              : {};
      return { ...current, ...descendants, ...patch };
    });
  const reset = () => {
    browseFilters.current = null;
    setSearch('');
    setFilters({ ...cleanFilters, date: defaultDate || today });
    setSorts([]);
  };
  function cycle(key) {
    setSorts((current) => {
      const index = current.findIndex((item) => item.key === key);
      return index < 0
        ? [{ key, direction: 'asc' }]
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
  const data = list.data ? { ...list.data.pages.at(-1), ...list.data.pages[0], items } : undefined,
    counts = countsResult.data ? countsResult.data?.filteredCounts || {} : {};
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
    { id: 'all', label: '全部' },
    { id: 'booked', label: '待接单' },
    { id: 'in_progress', label: '维修中' },
    { id: 'completed', label: '已结束' },
    { id: 'cancelled', label: '已取消' },
    { id: 'expired', label: '已逾期' }
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
        aria-label={`${columns[key]}${value ? `，${value.direction === 'asc' ? '升序' : '降序'}` : '，未排序'}；点击${!value ? '升序' : value.direction === 'asc' ? '降序' : '清除排序'}`}
        onClick={() => cycle(key)}
      >
        <strong data-motion-value="text">
          {columns[key]} {!value && <span aria-hidden="true"> ↕</span>}
          {value && <small data-motion-value="text">{value.direction === 'asc' ? '↑' : '↓'}</small>}
        </strong>
      </button>
    );
  };
  return (
    <section className="records-workspace">
      <WorkspaceHeader group="现场工作" title="预约记录">
        <RefreshButton
          key={JSON.stringify([filters, sorts])}
          onRefresh={() => refresh(true)}
          label="刷新记录"
        />
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
          updateOverview(patch);
        }}
      />
      <section className="records-panel" aria-label="预约查询">
        <div className="records-query-context">
          <div className="records-active-filters" aria-label="当前筛选条件">
            {(search ||
              datePreset !== 'today' ||
              filters.campus !== 'all' ||
              filters.status !== 'all' ||
              filters.timeSlot ||
              sorts.length > 0) && (
              <button className="records-reset" onClick={reset}>
                重置
              </button>
            )}
            {filters.campus === 'all' ? (
              <span>
                {user.authorizedCampuses.length === 1
                  ? `${user.authorizedCampuses[0]}校区`
                  : '全部校区'}
              </span>
            ) : (
              <button aria-label="移除校区筛选" onClick={() => update({ campus: 'all' })}>
                {summaries.campus} ×
              </button>
            )}
            {filters.timeSlot && (
              <button aria-label="移除时段筛选" onClick={() => update({ timeSlot: '' })}>
                {filters.timeSlot} ×
              </button>
            )}
            {filters.status !== 'all' && (
              <button aria-label="移除状态筛选" onClick={() => update({ status: 'all' })}>
                {statusText} ×
              </button>
            )}
            {search && (
              <button aria-label="清除搜索" onClick={() => changeSearch('')}>
                搜索：{search} ×
              </button>
            )}
          </div>
          <div className="records-result-meta" role="status">
            <span>
              已加载{' '}
              <DataValue label="已加载记录数">
                {data ? data.items?.length || 0 : undefined}
              </DataValue>{' '}
              条
            </span>
          </div>
        </div>
        <div className="records-toolbar">
          <label>
            <input
              type="search"
              aria-label="查找预约"
              value={search}
              onChange={(event) => changeSearch(event.target.value)}
              placeholder={searchPlaceholder}
            />
          </label>
          <div className="records-filter-actions">
            <button
              aria-haspopup="dialog"
              aria-expanded={menu === 'date'}
              onClick={(event) => {
                event.currentTarget.focus({ preventScroll: true });
                filterTrigger.current = event.currentTarget;
                setMenu('date');
              }}
            >
              {datePreset === 'today' ? `当期 · ${period}` : period}
            </button>
            <button
              aria-label="筛选预约时段"
              aria-haspopup="dialog"
              aria-expanded={menu === 'slots'}
              onClick={(event) => {
                event.currentTarget.focus({ preventScroll: true });
                filterTrigger.current = event.currentTarget;
                setMenu('slots');
              }}
            >
              {filters.timeSlot || '全部时段'}
            </button>
          </div>
        </div>
        {sorts.length > 0 && (
          <div className="records-result-tools">
            <div className="records-result-meta" role="status">
              <span>{`排序：${columns[sorts[0].key]}${sorts[0].direction === 'asc' ? '↑' : '↓'}`}</span>
            </div>
          </div>
        )}
        <RecordStatusNavigation
          items={statusItems}
          value={filters.status}
          onChange={(status) => update({ status })}
          onOverflow={(items, anchor) => {
            setOverflowStatuses(items);
            filterTrigger.current = anchor;
            setMenu('status');
          }}
        />
        <div className="records-results" aria-busy={list.isPending}>
          <Notice>{list.error?.message}</Notice>
          {list.error && <button onClick={() => refresh()}>重试读取</button>}
          <div data-motion-list="reveal" className="records-table-wrap" aria-busy={list.isPending}>
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
                      <Status value={item.status} outcome={item.outcome} />
                    </td>
                    <td data-label="校区">{item.campus}</td>
                    <td data-label="设备">
                      <strong data-motion-value="text">
                        {[item.brand, item.deviceModel || item.deviceType]
                          .filter(Boolean)
                          .join(' ')}
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
          {list.hasNextPage && (
            <div className="field-actions">
              <button
                onClick={() => list.fetchNextPage({ cancelRefetch: false })}
                disabled={list.isFetchingNextPage || list.isPending || !list.data}
              >
                加载更多预约
              </button>
            </div>
          )}
          <div ref={loadMoreSentinel} className="records-load-sentinel" aria-hidden="true" />
          {!data?.items?.length && defaultDate !== null && !list.isPending && !list.error && (
            <div className="field-empty">
              <strong>没有符合条件的预约</strong>
              <p>
                {filters.q
                  ? '核查输入是否正确，并检查日期、校区和状态筛选。'
                  : '调整日期、校区和状态筛选。'}
                {filters.q && ownCustomerSearch && '仅由你处理的工单可查姓名、学号和联系方式。'}
              </p>
            </div>
          )}
        </div>
      </section>
      {menu && (
        <RecordFilter
          menu={menu}
          anchor={filterTrigger.current}
          filters={filters}
          defaultDate={defaultDate || today}
          counts={counts}
          statusOptions={overflowStatuses}
          slots={[
            ...new Set([
              ...TIME_SLOTS,
              ...(overview.data?.items || []).map((item) => item.timeSlot)
            ])
          ]}
          onChange={(patch) => {
            update(patch);
            setMenu('');
            filterTrigger.current?.focus({ preventScroll: true });
          }}
          onClose={() => setMenu('')}
        />
      )}
      {selected && (
        <Repair
          key={selected}
          id={selected}
          onClose={() => setSelected('')}
          sidePanel
          hideWarrantyLookup
        />
      )}
    </section>
  );
}

function RecordStatusNavigation({ items, value, onChange, onOverflow }) {
  const container = useRef(null);
  const measure = useRef(null);
  const [visibleCount, setVisibleCount] = useState(items.length);
  useLayoutEffect(() => {
    const calculate = () => {
      const element = container.current;
      const sizes = [...measure.current.children].map((node) => node.getBoundingClientRect().width);
      const style = getComputedStyle(element);
      const available =
        element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const widths = sizes.slice(0, items.length);
      if (widths.reduce((total, width) => total + width, 0) <= available) {
        setVisibleCount(items.length);
        return;
      }
      let used = sizes.at(-1);
      let count = 0;
      for (const width of widths) {
        if (used + width > available) break;
        used += width;
        count++;
      }
      setVisibleCount(count);
    };
    const observer = new ResizeObserver(calculate);
    observer.observe(container.current);
    observer.observe(measure.current);
    calculate();
    return () => observer.disconnect();
  }, [value, items.length]);
  const overflow = items.slice(visibleCount);
  const selected = overflow.find((item) => item.id === value);
  return (
    <div ref={container} className="records-status-navigation">
      <div ref={measure} className="records-status-measure" aria-hidden="true">
        {items.map((item) => (
          <span key={item.id}>{item.label}</span>
        ))}
        <span>
          {items.find((item) => item.id === value)?.label.length > 2
            ? items.find((item) => item.id === value).label
            : '其他'}{' '}
          ▾
        </span>
      </div>
      <nav aria-label="预约处理状态" className="records-status-items">
        {items.slice(0, visibleCount).map((item) => (
          <button key={item.id} aria-pressed={item.id === value} onClick={() => onChange(item.id)}>
            {item.label}
          </button>
        ))}
        {overflow.length > 0 && (
          <button
            aria-label="更多预约状态"
            aria-haspopup="dialog"
            aria-pressed={!!selected}
            onClick={(event) => onOverflow(overflow, event.currentTarget)}
          >
            {selected?.label || '其他'} ▾
          </button>
        )}
      </nav>
    </div>
  );
}

function RecordFilter({
  menu,
  filters,
  counts,
  slots,
  onChange,
  onClose,
  defaultDate,
  anchor,
  statusOptions
}) {
  const today = dateKey();
  const week = weekRange(today);
  const panel = useRef(null);
  const [position, setPosition] = useState({});
  useLayoutEffect(() => {
    const place = () => {
      const bounds = anchor?.getBoundingClientRect();
      if (!bounds || !panel.current) return;
      const width = Math.min(menu === 'status' ? 176 : 320, window.innerWidth - 24);
      const height = panel.current.offsetHeight;
      setPosition({
        width,
        left: Math.max(12, Math.min(bounds.right - width, window.innerWidth - width - 12)),
        top: Math.max(
          12,
          bounds.bottom + height + 8 <= window.innerHeight
            ? bounds.bottom + 8
            : bounds.top - height - 8
        )
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    panel.current?.querySelector('button')?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, menu]);
  useEffect(() => {
    const outside = (event) => {
      if (
        !panel.current?.contains(event.target) &&
        !anchor?.contains(event.target) &&
        !event.target.closest('.workspace-control-popover')
      )
        onClose();
    };
    const escape = (event) => {
      if (event.key === 'Escape' && !document.querySelector('.workspace-control-popover')) {
        onClose();
        anchor?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [anchor, onClose]);
  return (
    <div
      ref={panel}
      className="records-filter-popover"
      data-kind={menu}
      style={position}
      role="dialog"
      aria-label={{ date: '预约日期', status: '状态筛选', slots: '预约时段筛选' }[menu]}
    >
      <div className="record-filter-panel">
        {menu === 'status' && (
          <div className="record-options">
            {statusOptions.map(({ id: value, label }) => (
              <button
                key={value}
                aria-pressed={filters.status === value}
                onClick={() => onChange({ status: filters.status === value ? 'all' : value })}
              >
                {label}：<DataValue label={`${label}数量`}>{counts[value]}</DataValue>
              </button>
            ))}
          </div>
        )}
        {menu === 'date' && (
          <>
            <div className="record-options" role="group" aria-label="快捷预约日期">
              {['当期预约', '本周预约', '不限日期'].map((label, index) => (
                <button
                  key={label}
                  aria-pressed={
                    index === 0
                      ? filters.date === defaultDate
                      : index === 1
                        ? filters.dateFrom === week.start
                        : !filters.date && !filters.dateFrom
                  }
                  onClick={() => {
                    onChange({
                      date: index === 0 ? defaultDate : '',
                      dateFrom: index === 1 ? week.start : '',
                      dateTo: index === 1 ? week.end : ''
                    });
                    onClose();
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <label>
              指定日期
              <DatePicker
                value={filters.date}
                onChange={(event) =>
                  onChange({ date: event.target.value, dateFrom: '', dateTo: '' })
                }
              />
            </label>
          </>
        )}
        {menu === 'slots' && (
          <div className="record-options">
            {['', ...slots].map((slot) => (
              <button
                key={slot}
                aria-pressed={filters.timeSlot === slot}
                onClick={() => onChange({ timeSlot: slot })}
              >
                {slot || '全部时段'}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RecordOverview({ result, filters, campuses, onFilter }) {
  const data = result.data;
  const date = filters.dateFrom || !filters.date ? 'week' : filters.date;
  const weekly = date === 'week';
  function select(patch = {}) {
    onFilter(patch);
  }
  return (
    <section className="records-overview" aria-label="近期预约概览">
      <details className="records-overview-disclosure" open>
        <summary>
          <div>
            <h2>{weekly ? '本周预约概览' : '预约概览'}</h2>
          </div>
          <span className="records-overview-toggle">
            <span className="when-closed">查看概览 ＋</span>
            <span className="when-open">收起概览 −</span>
          </span>
        </summary>
        <div className="records-overview-body">
          <Notice>{result.error?.message}</Notice>
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
        </div>
      </details>
    </section>
  );
}
