import React, { useCallback, useEffect, useRef, useState } from 'react';
import { request } from './request.js';
import { MemberEditor } from './MemberEditor.jsx';

export function Members({ user }) {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const [campus, setCampus] = useState('');
  const [status, setStatus] = useState('');
  const [nextCursor, setNextCursor] = useState('');
  const [selected, setSelected] = useState(null);
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
    } catch (err) {
      if (current === generation.current && err.name !== 'AbortError') setError(err.message);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }, [q, campus, status]);

  useEffect(() => {
    setItems([]); setNextCursor('');
    const timer = setTimeout(() => load(), 200);
    return () => { clearTimeout(timer); ++generation.current; controller.current?.abort(); };
  }, [load]);

  return <section className="react-page react-members-page">
    <div className="react-heading"><div><p className="react-eyebrow">成员与组织</p><h1>成员管理</h1><p>成员资料与角色授权分别维护，所属校区不改变授权范围。</p></div><button onClick={() => load()} disabled={busy}>刷新</button></div>
    {error && <p className="react-error" role="alert">{error}</p>}
    <div className="react-toolbar"><input aria-label="搜索成员" value={q} onChange={event => setQ(event.target.value)} placeholder="搜索姓名、学号或账号" />
      <select aria-label="筛选成员校区" value={campus} onChange={event => setCampus(event.target.value)}><option value="">全部校区</option><option value="campus-nanhu">南湖</option><option value="campus-hunnan">浑南</option></select>
      <select aria-label="筛选成员状态" value={status} onChange={event => setStatus(event.target.value)}><option value="">全部状态</option><option value="active">正常</option><option value="inactive">停用</option></select>
      <span role="status">{busy ? '正在读取成员…' : `已显示 ${items.length} 名成员`}</span></div>
    <div className="react-table" aria-busy={busy}>
      <div className="react-row react-row-head"><span>姓名 / 学号</span><span>校区</span><span>状态</span><span>主要部门</span><span>操作</span></div>
      {items.map(item => <div className="react-row" key={item.memberId}>
        <span className="react-member-identity"><strong>{item.name}</strong><small>{item.studentId || item.account || '未关联登录账号'}</small></span>
        <span>{item.homeCampusId === 'campus-hunnan' ? '浑南' : item.homeCampusId === 'campus-nanhu' ? '南湖' : '未设校区'}</span>
        <span><span className={`react-member-status ${item.status === 'active' ? 'is-active' : ''}`}>{item.status === 'active' ? '正常' : '停用'}</span></span>
        <span>{item.primaryDepartment || '未设部门'}</span><span><button onClick={() => setSelected(item)}>编辑成员与权限</button></span>
      </div>)}
      {!busy && !items.length && !error && <p className="react-muted">没有符合筛选条件的可见成员</p>}
    </div>
    {nextCursor && <button onClick={() => load(nextCursor)} disabled={busy}>加载更多成员</button>}
    {selected && <MemberEditor member={selected} canManageRoles={user.role === 'superadmin' && user.grants?.some(grant => grant.permissionCode === 'roles.manage')} onClose={() => setSelected(null)} onSaved={() => load()} />}
  </section>;
}
