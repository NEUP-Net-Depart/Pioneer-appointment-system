import React, { useContext, useEffect, useMemo, useState } from 'react';
import { request } from './request.js';
import { ActivityContext } from './field/ui';
import { WorkspaceHeader } from './WorkspaceHeader';
import { ScopeFields, ConditionFields } from './ScopeFields.jsx';
import { setGrantEnabled, withGrantValidity } from './authorization-drafts.js';
import { WorkspaceSections } from './WorkspaceSections';
import { useUnsavedChanges } from './useUnsavedChanges.js';

const permissionGroups = [
  { id: 'all', label: '全部功能' },
  { id: 'repair', label: '接待与维修' },
  { id: 'roster', label: '排班与申请' },
  { id: 'attendance', label: '签到与在岗' },
  { id: 'management', label: '管理与数据' },
];
const permissionGroup = code => /^(repair|onsite)\./.test(code) ? 'repair' : /^(roster|leave|swap)\./.test(code) ? 'roster' : /^(attendance|presence|meeting)\./.test(code) ? 'attendance' : 'management';

export function Permissions({ user }) {
  const routeActive = useContext(ActivityContext);
  const [search, setSearch] = useState('');
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [group, setGroup] = useState('all');
  const [permissions, setPermissions] = useState([]);
  const [providers, setProviders] = useState([]);
  const [campuses, setCampuses] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState([]);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const dirty = selected && JSON.stringify(draft) !== JSON.stringify(selected.grants || []);
  const codes = useMemo(() => new Set(draft.map(grant => grant.permissionCode)), [draft]);
  const protectedRole = selected?.id === 'role-superadmin';
  const readOnly = user.role !== 'superadmin' || protectedRole;
  useEffect(() => {
    let active = true;
    Promise.all([request('/api/permissions'), request('/api/roles'), request('/api/organization/campuses'), request('/api/organization/departments')]).then(([definitions, data, campusData, departmentData]) => {
      if (!active) return;
      setPermissions(definitions.items || []); setProviders(definitions.conditionProviders || []); setCampuses(campusData.items || []); setDepartments(departmentData.items || []); setRoles(data.items || []);
      const first = data.items?.[0] || null;
      setSelected(first); setDraft(structuredClone(first?.grants || []));
    }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);
  useUnsavedChanges({dirty,active:routeActive,busy,save,discard:()=>{setDraft(structuredClone(selected.grants || []));setError('');}});
  const visiblePermissions = permissions.filter(permission => (!enabledOnly || codes.has(permission.code)) && (search.trim() || group === 'all' || permissionGroup(permission.code) === group) && `${permission.name} ${permission.description || ''}`.includes(search.trim()));
  function select(role) {
    setSelected(role); setDraft(structuredClone(role.grants || [])); setError(''); setMessage('');
  }
  function updateGrant(index, patch) { setDraft(current => current.map((grant, i) => i === index ? { ...grant, ...patch } : grant)); }
  async function save() {
    setBusy(true); setError(''); setMessage('');
    try {
      const updated = await request(`/api/roles/${encodeURIComponent(selected.id)}`, {
        method: 'PATCH', body: { revision: selected.revision, grants: draft }
      });
      setRoles(current => current.map(role => role.id === updated.id ? updated : role));
      setSelected(updated); setDraft(structuredClone(updated.grants || []));
      setMessage('权限已保存，受影响的账号需要重新登录');
      return true;
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <section className="react-page permissions-workspace">
    <WorkspaceHeader group="平台管理" title="授权管理" description="选择角色，调整权限后统一保存。" />
    {error && <p className="react-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <div className="react-permission-layout"><aside className="react-card" aria-label="角色列表"><h2>角色</h2>
      {roles.map(role => <button type="button" disabled={busy || !!dirty} aria-pressed={selected?.id === role.id} className={selected?.id === role.id ? 'is-selected' : ''} key={role.id} onClick={() => select(role)}>{role.name}<small>{role.description || role.code}</small></button>)}
    </aside><article className="react-card"><h2>{selected?.name || '正在读取角色…'}</h2>
      <p className="react-muted">启用已有权限会保留其范围、条件和有效期；新增权限采用受限的默认范围。</p>
      {protectedRole && <p className="react-muted">最高管理员权限包受保护，请选择其他角色配置。</p>}
      {user.role !== 'superadmin' && <p className="react-muted">角色配置与分配由最高管理员管理，当前可查看已有配置。</p>}
      <div className="permission-tools"><label>查找权限<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="按功能名称查找" /></label><label className="permission-filter"><input type="checkbox" checked={enabledOnly} onChange={event => setEnabledOnly(event.target.checked)} />只看已启用</label><span>已启用 {codes.size} 项 · 当前显示 {visiblePermissions.length} 项</span></div>
      <WorkspaceSections label="权限功能分类" value={search.trim() ? 'all' : group} onChange={value => { setGroup(value); setSearch(''); }} items={permissionGroups} />
      <fieldset disabled={busy || !selected || readOnly} className="react-permission-fields"><legend className="sr-only">角色权限</legend>
        {visiblePermissions.map(permission => <section className="react-permission-item" key={permission.code}>
          <label className="react-permission"><input type="checkbox" checked={codes.has(permission.code)} onChange={event => setDraft(current => setGrantEnabled(current, permission, event.target.checked, selected.grants || []))} />
            <span><strong>{permission.name}</strong><small>{permission.description || permission.code}</small></span>
          </label>
          {draft.map((grant, index) => grant.permissionCode === permission.code && <details key={grant.id || index} className="react-grant-details"><summary>范围、条件与有效期</summary>
            <ScopeFields value={grant.scope} onChange={scope => updateGrant(index, { scope })} campuses={campuses} departments={departments} kinds={permission.scopeKinds} inherit="沿用账号授权范围" />
            <ConditionFields conditions={grant.conditions} providers={providers} requiredCodes={permission.conditionKinds} onChange={conditions => updateGrant(index, { conditions })} />
            <div className="react-form-grid"><label>权限生效日期<input type="date" value={grant.validity?.effectiveFrom || grant.validity?.from || ''} onChange={event => updateGrant(index, { validity: withGrantValidity(grant.validity, 'effectiveFrom', event.target.value) })} /></label>
              <label>权限结束日期<input type="date" value={grant.validity?.effectiveTo || grant.validity?.to || ''} onChange={event => updateGrant(index, { validity: withGrantValidity(grant.validity, 'effectiveTo', event.target.value) })} /></label></div>
          </details>)}
        </section>)}
      </fieldset>
      {selected && !visiblePermissions.length && <p className="members-empty">没有匹配的权限，请调整筛选条件。</p>}
      <div className="react-editor-actions"><span aria-live="polite">{dirty ? '有未保存的修改' : '已与服务器同步'}</span>
        <button type="button" disabled={!dirty || busy} onClick={() => { setDraft(structuredClone(selected.grants || [])); setError(''); }}>放弃修改</button>
        <button type="button" className="react-primary" disabled={!dirty || busy} onClick={save}>{busy ? '正在保存…' : '保存权限'}</button>
      </div>
    </article></div>
  </section>;
}
