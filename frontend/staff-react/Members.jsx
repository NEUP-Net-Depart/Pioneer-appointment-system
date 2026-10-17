import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { request } from './request.js';
import { ActivityContext } from './field/ui';
import { WorkspaceHeader } from './WorkspaceHeader';
import { readWorkspaceState, writeWorkspaceState } from './workspace-state.js';
import { MemberEditor } from './MemberEditor.jsx';
import { staffPermission } from '../../shared/staff-access.js';
import { MemberImport } from './MemberImport.jsx';
import { StaffIdentity } from './StaffIdentity';

export function Members({ user }) {
  const routeActive = useContext(ActivityContext);
  const viewKey = `members:${user.memberId || user.account}:${user.authVersion || 0}`;
  const saved = readWorkspaceState(viewKey);
  const [items, setItems] = useState(saved?.items || []);
  const [q, setQ] = useState(saved?.q || '');
  const [campus, setCampus] = useState(saved?.campus || '');
  const [status, setStatus] = useState(saved?.status || '');
  const [nextCursor, setNextCursor] = useState(saved?.nextCursor || '');
  const [resolvedQuery, setResolvedQuery] = useState(saved?.query || '');
  const query = JSON.stringify([q, campus, status]);
  const [selected, setSelected] = useState(null);
  const [importing,setImporting] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const controller = useRef(null);

  const load = useCallback(async (cursor = '') => {
    const current = ++generation.current;
    controller.current?.abort();
    controller.current = new AbortController();
    setBusy(true); setError('');
    const params = new URLSearchParams({ q, ...(campus ? { homeCampusId: campus } : {}), ...(status ? { status } : {}), ...(cursor ? { cursor } : {}) });
    try {
      const data = await request(`/api/members?${params}`, { signal: controller.current.signal });
      if (current !== generation.current) return;
      setItems(previous => cursor ? [...new Map([...previous, ...(data.items || [])].map(item => [item.memberId, item])).values()] : data.items || []);
      setNextCursor(data.nextCursor || '');
      setResolvedQuery(JSON.stringify([q, campus, status]));
    } catch (err) {
      if (current === generation.current && err.name !== 'AbortError') setError(err.message);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }, [q, campus, status]);

  useEffect(() => {
    if (!routeActive) { ++generation.current; controller.current?.abort(); return; }
    setBusy(true); setNextCursor('');
    const timer = setTimeout(() => load(), 200);
    return () => { clearTimeout(timer); ++generation.current; controller.current?.abort(); };
  }, [load, routeActive]);

  useEffect(() => { if (resolvedQuery === query) writeWorkspaceState(viewKey, { q, campus, status, items, nextCursor, query }); }, [viewKey, q, campus, status, items, nextCursor, query, resolvedQuery]);

  return <section className="react-page react-members-page">
    <WorkspaceHeader group="平台管理" title="成员管理" description="成员资料与角色授权分别维护，所属校区不改变授权范围。">{user.role==='superadmin' && <button className="react-primary" onClick={()=>setImporting(true)}>导入名单</button>}<button onClick={() => load()} disabled={busy}>刷新</button></WorkspaceHeader>
    {error && <p className="react-error" role="alert">{error}</p>}
    <div className="members-workspace"><div className="react-toolbar members-tools"><label>查找成员<input aria-label="搜索成员" value={q} onChange={event => setQ(event.target.value)} placeholder="姓名、学号或账号" /></label>
      <label>所属校区<select aria-label="筛选成员校区" value={campus} onChange={event => setCampus(event.target.value)}><option value="">全部校区</option><option value="campus-nanhu">南湖</option><option value="campus-hunnan">浑南</option></select></label>
      <label>成员状态<select aria-label="筛选成员状态" value={status} onChange={event => setStatus(event.target.value)}><option value="">全部状态</option><option value="active">正常</option><option value="inactive">停用</option></select></label>
      <span className="members-result-count" role="status">{busy ? '正在更新筛选结果…' : `已显示 ${items.length} 名成员`}</span></div>
    <div className="react-table members-results" aria-busy={busy} data-refreshing={busy}>
      <div className="react-row react-row-head"><span>成员</span><span>校区</span><span>状态</span><span>主要部门</span><span>操作</span></div>
      {items.map(item => <div className="react-row" key={item.memberId}>
        <span className="react-member-identity"><strong>{item.name}</strong><StaffIdentity identities={item.identities}/><small>{item.studentId || item.account || '未关联登录账号'}</small></span>
        <span data-label="所属校区">{item.homeCampusId === 'campus-hunnan' ? '浑南' : item.homeCampusId === 'campus-nanhu' ? '南湖' : '未设校区'}</span>
        <span data-label="状态"><span className={`react-member-status ${item.status === 'active' ? 'is-active' : ''}`}>{item.status === 'active' ? '正常' : '停用'}</span></span>
        <span data-label="主要部门">{item.primaryDepartment || '未设部门'}</span><span className="members-row-action"><button disabled={busy} onClick={() => setSelected(item)}>编辑成员与权限</button></span>
      </div>)}
      {busy && !items.length && <div className="workspace-skeleton" aria-label="正在读取成员"><span /><span /><span /><span /></div>}
      {!busy && !items.length && !error && <div className="members-empty"><h2>没有找到成员</h2><p>试试其他姓名、学号，或放宽校区与状态条件。</p>{(q || campus || status) && <button onClick={() => { setQ(''); setCampus(''); setStatus(''); }}>清除筛选</button>}</div>}
    </div>
    <footer className="members-list-footer"><span>仅展示你有权查看的成员</span>{nextCursor && <button onClick={() => load(nextCursor)} disabled={busy}>加载更多成员</button>}</footer></div>
    {selected && <MemberEditor member={selected} canManageRoles={user.role === 'superadmin' && staffPermission(user, 'roles.manage')} onClose={() => setSelected(null)} onSaved={() => load()} />}
    {importing && <MemberImport onClose={()=>setImporting(false)} onSaved={()=>load()}/>}
  </section>;
}
