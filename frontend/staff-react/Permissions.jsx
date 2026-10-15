import React, { useEffect, useMemo, useState } from 'react';
import { request } from './request.js';
import { setGrantEnabled } from './authorization-drafts.js';

export function Permissions() {
  const [permissions, setPermissions] = useState([]);
  const [roles, setRoles] = useState([]);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const dirty = selected && JSON.stringify(draft) !== JSON.stringify(selected.grants || []);
  const codes = useMemo(() => new Set(draft.map(grant => grant.permissionCode)), [draft]);
  useEffect(() => {
    let active = true;
    Promise.all([request('/api/permissions'), request('/api/roles')]).then(([definitions, data]) => {
      if (!active) return;
      setPermissions(definitions.items || []); setRoles(data.items || []);
      const first = data.items?.[0] || null;
      setSelected(first); setDraft(structuredClone(first?.grants || []));
    }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);
  function select(role) {
    setSelected(role); setDraft(structuredClone(role.grants || [])); setError(''); setMessage('');
  }
  async function save() {
    setBusy(true); setError(''); setMessage('');
    try {
      const updated = await request(`/api/roles/${encodeURIComponent(selected.id)}`, {
        method: 'PATCH', body: { revision: selected.revision, grants: draft }
      });
      setRoles(current => current.map(role => role.id === updated.id ? updated : role));
      setSelected(updated); setDraft(structuredClone(updated.grants || []));
      setMessage('权限已保存，受影响的账号需要重新登录');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <section className="react-page">
    <div className="react-heading"><div><h1>权限身份</h1><p>选择角色，调整权限后统一保存。</p></div></div>
    {error && <p className="react-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <div className="react-permission-layout"><aside className="react-card" aria-label="角色列表"><h2>角色</h2>
      {roles.map(role => <button type="button" disabled={busy || !!dirty} aria-pressed={selected?.id === role.id} className={selected?.id === role.id ? 'is-selected' : ''} key={role.id} onClick={() => select(role)}>{role.name}<small>{role.description || role.code}</small></button>)}
    </aside><article className="react-card"><h2>{selected?.name || '正在读取角色…'}</h2>
      <p className="react-muted">启用已有权限会保留其范围、条件和有效期；新增权限采用受限的默认范围。</p>
      <fieldset disabled={busy || !selected} className="react-permission-fields"><legend className="sr-only">角色权限</legend>
        {permissions.map(permission => <label className="react-permission" key={permission.code}>
          <input type="checkbox" checked={codes.has(permission.code)} onChange={event => setDraft(current => setGrantEnabled(current, permission, event.target.checked, selected.grants || []))} />
          <span><strong>{permission.name}</strong><small>{permission.description || permission.code}</small></span>
        </label>)}
      </fieldset>
      <div className="react-editor-actions"><span aria-live="polite">{dirty ? '有未保存的修改' : '已与服务器同步'}</span>
        <button type="button" disabled={!dirty || busy} onClick={() => { setDraft(structuredClone(selected.grants || [])); setError(''); }}>放弃修改</button>
        <button type="button" className="react-primary" disabled={!dirty || busy} onClick={save}>{busy ? '正在保存…' : '保存权限'}</button>
      </div>
    </article></div>
  </section>;
}
