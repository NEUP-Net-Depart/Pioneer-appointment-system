import { DataValue } from './DataValue';
import React, { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityContext } from './field/ui';
import { MemberEditor } from './MemberEditor.jsx';
import { staffPermission } from '../../shared/staff-access.js';
import { MemberImport } from './MemberImport.jsx';
import { EducationImport } from './EducationImport.jsx';
import { WorkspaceMoreActions } from './WorkspaceMoreActions';
import { StaffIdentity } from './StaffIdentity';
import { MemberCreate } from './MemberCreate.jsx';

export function Members({ user }) {
  const active = useContext(ActivityContext);
  const client = useQueryClient();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [campus, setCampus] = useState('');
  const [status, setStatus] = useState('');
  const allParams = { q: '', homeCampusId: '', status: '' };
  const complete = client.getQueryData(['/api/members', allParams]);
  const localFilters = !search && complete && !complete.pages.at(-1).nextCursor;
  const params = localFilters ? allParams : { q: search, homeCampusId: campus, status };
  const [selected, setSelected] = useState(null);
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [educationImporting, setEducationImporting] = useState(false);
  const list = useInfiniteQuery({
    queryKey: ['/api/members', params],
    enabled: active,
    initialPageParam: '',
    getNextPageParam: (page) => page.nextCursor || undefined,
    staleTime: (query) => (query.state.data?.pages.length > 1 ? 120000 : 30000),
    refetchInterval: (query) => (query.state.data?.pages.length > 1 ? 120000 : 30000)
  });
  const error = list.error?.message;
  const busy = list.isPending;
  const items = [
    ...new Map(
      (list.data?.pages.flatMap((page) => page.items) || []).map((item) => [item.memberId, item])
    ).values()
  ].filter(
    (item) =>
      !localFilters ||
      ((!campus || item.homeCampusId === campus) && (!status || item.status === status))
  );
  const load = async () => {
    const affected = {
      predicate: (query) =>
        String(query.queryKey[0]).startsWith('/api/members') ||
        [
          '/api/users',
          '/api/staff-whitelist',
          '/api/activation-requests',
          '/api/rosters/campus-week',
          '/api/attendance/day',
          '/api/field/home',
          '/api/field/board',
          '/api/attendance/volunteer-report',
          '/api/attendance/matrix'
        ].includes(query.queryKey[0])
    };
    await client.cancelQueries(affected);
    return client.invalidateQueries(affected);
  };
  const sentinel = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(q.trim()), q.trim() ? 250 : 0);
    return () => clearTimeout(timer);
  }, [q]);

  useLayoutEffect(() => {
    if (
      !active ||
      busy ||
      list.isFetching ||
      error ||
      !list.hasNextPage ||
      !list.data ||
      !sentinel.current
    )
      return;
    let observing = true;
    const observer = new IntersectionObserver(
      (entries) => {
        // Recheck live geometry: queued intersections can describe the shorter
        // previous filter, especially when the mobile viewport changes.
        if (
          observing &&
          entries.some((entry) => entry.isIntersecting) &&
          sentinel.current.getBoundingClientRect().top <= window.innerHeight * 3
        )
          void list.fetchNextPage({ cancelRefetch: false });
      },
      { rootMargin: `${window.innerHeight * 2}px 0px` }
    );
    observer.observe(sentinel.current);
    return () => {
      observing = false;
      observer.disconnect();
    };
  }, [
    active,
    busy,
    list.isFetching,
    error,
    list.hasNextPage,
    list.data,
    params.q,
    params.homeCampusId,
    params.status
  ]);

  return (
    <section className="react-members-page">
      {error && (
        <p data-motion-value="text" className="react-error" role="alert">
          {error}
        </p>
      )}
      <div className="members-workspace">
        <div className="react-toolbar members-tools">
          <label>
            查找成员
            <input
              aria-label="搜索成员"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="姓名、学号或部门"
            />
          </label>
          <label>
            所属校区
            <select
              aria-label="筛选成员校区"
              value={campus}
              onChange={(event) => setCampus(event.target.value)}
            >
              <option value="">全部校区</option>
              <option value="campus-nanhu">南湖</option>
              <option value="campus-hunnan">浑南</option>
            </select>
          </label>
          <label>
            成员状态
            <select
              aria-label="筛选成员状态"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">全部状态</option>
              <option value="active">正常</option>
              <option value="inactive">停用</option>
            </select>
          </label>
          <div className="members-list-actions">
            {staffPermission(user, 'members.manage') && (
              <>
                <button className="react-primary" onClick={() => setCreating(true)}>
                  新增人员
                </button>
                <button onClick={() => setImporting(true)}>批量导入</button>
                <WorkspaceMoreActions>
                  <button onClick={() => setEducationImporting(true)}>批量补学院</button>
                </WorkspaceMoreActions>
              </>
            )}
            <button
              onClick={() => client.invalidateQueries({ queryKey: ['/api/members'] })}
              disabled={busy}
            >
              刷新
            </button>
          </div>
          <span className="members-result-count" role="status">
            已显示{' '}
            <DataValue label="已显示成员数量">{list.data ? items.length : undefined}</DataValue>{' '}
            名成员
          </span>
        </div>
        <div className="react-table members-results" aria-busy={busy}>
          <div className="react-row react-row-head">
            <span>成员</span>
            <span>校区</span>
            <span>状态</span>
            <span>部门 / 学院</span>
            <span>操作</span>
          </div>
          {items.map((item) => (
            <div data-motion-item={item.memberId} className="react-row" key={item.memberId}>
              <span className="react-member-identity">
                <strong data-motion-value="text">{item.name}</strong>
                <StaffIdentity identities={item.identities} />
                <small data-motion-value="text">
                  {item.studentId || item.account || '未关联登录账号'}
                </small>
              </span>
              <span data-motion-value="text" data-label="所属校区">
                {item.homeCampusId === 'campus-hunnan'
                  ? '浑南'
                  : item.homeCampusId === 'campus-nanhu'
                    ? '南湖'
                    : '未设校区'}
              </span>
              <span data-label="状态">
                <span
                  data-motion-value="text"
                  className={`react-member-status ${item.status === 'active' ? 'is-active' : ''}`}
                >
                  {item.status === 'active' ? '正常' : '停用'}
                </span>
              </span>
              <span className="member-organization" data-label="部门 / 学院">
                <span data-motion-value="text">{item.primaryDepartment || '未设部门'}</span>
                {item.college && <small data-motion-value="text">{item.college}</small>}
              </span>
              <span className="members-row-action">
                <button onClick={() => setSelected(item)}>人员详情</button>
              </span>
            </div>
          ))}
          {!busy && !items.length && !error && (
            <div className="members-empty">
              <h2>没有找到成员</h2>
              {(q || campus || status) && (
                <button
                  onClick={() => {
                    setQ('');
                    setCampus('');
                    setStatus('');
                  }}
                >
                  清除筛选
                </button>
              )}
            </div>
          )}
        </div>
        <footer ref={sentinel} className="members-list-footer" aria-busy={list.isFetchingNextPage}>
          {list.hasNextPage && (
            <button
              disabled={list.isFetching}
              onClick={() => list.fetchNextPage({ cancelRefetch: false })}
            >
              加载更多
            </button>
          )}
        </footer>
      </div>
      {selected && (
        <MemberEditor
          user={user}
          member={selected}
          canManageRoles={
            staffPermission(user, 'roles.manage') &&
            selected.memberId !== user.memberId &&
            selected.role !== 'superadmin'
          }
          onClose={() => setSelected(null)}
          onSaved={() => load()}
        />
      )}
      {creating && (
        <MemberCreate
          user={user}
          onClose={() => setCreating(false)}
          onSaved={() => load()}
          onExisting={setSelected}
        />
      )}
      {importing && (
        <MemberImport user={user} onClose={() => setImporting(false)} onSaved={() => load()} />
      )}
      {educationImporting && (
        <EducationImport onClose={() => setEducationImporting(false)} onSaved={() => load()} />
      )}
    </section>
  );
}
