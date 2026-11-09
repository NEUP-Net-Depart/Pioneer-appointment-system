import { DataValue } from './DataValue';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { useWorkspaceQuery } from './useWorkspaceQuery.js';
import { ActivityContext } from './field/ui';
import { readWorkspaceState, writeWorkspaceState } from './workspace-state.js';
import { MemberEditor } from './MemberEditor.jsx';
import { staffPermission } from '../../shared/staff-access.js';
import { MemberImport } from './MemberImport.jsx';
import { EducationImport } from './EducationImport.jsx';
import { WorkspaceMoreActions } from './WorkspaceMoreActions';
import { StaffIdentity } from './StaffIdentity';
import { MemberCreate } from './MemberCreate.jsx';

function deriveMembers(path, cache) {
  const params = new URLSearchParams(path.split('?')[1]);
  const complete = cache.get('/api/members?q=&homeCampusId=&status=');
  if (params.get('q') || !complete || complete.data.nextCursor) return null;
  const campus = params.get('homeCampusId');
  const status = params.get('status');
  return {
    ...complete,
    data: {
      ...complete.data,
      items: complete.data.items.filter(
        (item) => (!campus || item.homeCampusId === campus) && (!status || item.status === status)
      )
    }
  };
}

export function Members({ user }) {
  const active = useContext(ActivityContext);
  const viewKey = `members:${user.memberId || user.account}:${user.authVersion || 0}`;
  const saved = readWorkspaceState(viewKey);
  const [q, setQ] = useState(saved?.q || '');
  const [search, setSearch] = useState(q.trim());
  const [campus, setCampus] = useState(saved?.campus || '');
  const [status, setStatus] = useState(saved?.status || '');
  const query = new URLSearchParams({ q: search, homeCampusId: campus, status }).toString();
  const [selected, setSelected] = useState(null);
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [educationImporting, setEducationImporting] = useState(false);
  const [revision, setRevision] = useState(0);
  const list = useWorkspaceQuery(`/api/members?${query}`, active, revision, {
    itemKey: 'memberId',
    derive: deriveMembers
  });
  const { error, loading: busy, nextCursor } = list;
  const items = list.data?.items || [];
  const load = () => setRevision((value) => value + 1);
  const sentinel = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(q.trim()), q.trim() ? 250 : 0);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    if (
      !active ||
      busy ||
      list.loadingMore ||
      error ||
      !nextCursor ||
      !list.current ||
      !sentinel.current
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void list.loadMore();
      },
      { rootMargin: `${window.innerHeight * 2}px 0px` }
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [active, busy, list.loadingMore, error, nextCursor, list.current, query]);

  useEffect(() => {
    writeWorkspaceState(viewKey, {
      q,
      campus,
      status,
      query
    });
  }, [viewKey, q, campus, status, query]);

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
            <button onClick={() => load()} disabled={busy}>
              刷新
            </button>
          </div>
          <span className="members-result-count" role="status">
            已显示{' '}
            <DataValue label="已显示成员数量">{list.current ? items.length : undefined}</DataValue>{' '}
            名成员
          </span>
        </div>
        <div
          className="react-table members-results"
          aria-busy={busy}
          data-refreshing={list.refreshing}
        >
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
        <footer ref={sentinel} className="members-list-footer" aria-busy={list.loadingMore}>
          {nextCursor && (
            <button disabled={busy || list.loadingMore} onClick={() => list.loadMore()}>
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
