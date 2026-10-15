import React, { useEffect, useRef, useState } from 'react';
import { dateKey } from '../../shared/time.js';
import { request } from './request.js';
import { ScopeFields } from './ScopeFields.jsx';
import { roleBindingsPayload } from './authorization-drafts.js';

const campuses = [{ id: 'campus-nanhu', name: '南湖' }, { id: 'campus-hunnan', name: '浑南' }];

export function MemberEditor({ member, canManageRoles, onClose, onSaved }) {
  const dialogRef = useRef(null);
  const [detail, setDetail] = useState(null);
  const [profile, setProfile] = useState({ name: member.name, homeCampusId: member.homeCampusId, status: member.status });
  const [bindings, setBindings] = useState([]);
  const [roles, setRoles] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    let active = true;
    request(`/api/members/${encodeURIComponent(member.memberId)}`).then(data => {
      if (!active) return;
      setDetail(data); setBindings(data.bindings || []);
      setProfile({ name: data.member.name, homeCampusId: data.member.homeCampusId, status: data.member.status });
    }).catch(err => { if (active) setError(err.message); });
    request('/api/organization/departments').then(data => { if (active) setDepartments(data.items || []); }).catch(err => { if (active) setError(err.message); });
    if (canManageRoles) request('/api/roles').then(data => { if (active) setRoles(data.items || []); })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [member.memberId, canManageRoles]);

  async function saveProfile(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const data = await request(`/api/members/${encodeURIComponent(member.memberId)}`, {
        method: 'PATCH', body: { ...profile, revision: detail.member.revision }
      });
      setDetail(current => ({ ...current, member: data.member }));
      setMessage('成员资料已保存'); onSaved();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function saveBindings(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      await request(`/api/members/${encodeURIComponent(member.memberId)}/roles`, {
        method: 'PUT', body: { revision: detail.member.revision, bindings: roleBindingsPayload(bindings) }
      });
      const data = await request(`/api/members/${encodeURIComponent(member.memberId)}`);
      setDetail(data); setBindings(data.bindings || []);
      setMessage('角色授权已保存，相关账号需要重新登录'); onSaved();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  function editBinding(index, patch) {
    setBindings(current => current.map((binding, i) => i === index ? { ...binding, ...patch } : binding));
  }
  function handleKey(event) {
    if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose(); }
    if (event.key !== 'Tab') return;
    const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(node => node.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  return <div className="react-modal"><section ref={dialogRef} tabIndex={-1} onKeyDown={handleKey} className="react-card react-member-editor" role="dialog" aria-modal="true" aria-labelledby="member-editor-title">
    <div className="react-heading"><div><h2 id="member-editor-title">{member.name}</h2><p>资料与角色授权分别保存</p></div><button type="button" disabled={busy} onClick={onClose}>关闭</button></div>
    {error && <p className="react-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {!detail ? <p role="status">正在读取成员资料…</p> : <>
      <form onSubmit={saveProfile}><fieldset disabled={busy}><legend>成员资料</legend>
        <label>姓名<input required value={profile.name} onChange={event => setProfile({ ...profile, name: event.target.value })} /></label>
        <label>所属校区<select value={profile.homeCampusId} onChange={event => setProfile({ ...profile, homeCampusId: event.target.value })}>{campuses.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>成员状态<select value={profile.status} onChange={event => setProfile({ ...profile, status: event.target.value })}><option value="active">正常</option><option value="inactive">停用</option></select></label>
        <button className="react-primary">保存资料</button>
      </fieldset></form>
      {detail.account?.protected && <p className="react-muted">此负责人账号受保护，不能停用或移除其授权。</p>}
      {canManageRoles && !detail.account?.protected && <form onSubmit={saveBindings}><fieldset disabled={busy || !roles.length}><legend>角色授权</legend>
        <p className="react-muted">授权校区独立于所属校区；结束日期当天起失效。</p>
        {bindings.map((binding, index) => {
          return <section className="react-binding" key={binding.id || `new-${index}`}>
            <label>角色<select value={binding.roleId} onChange={event => editBinding(index, { roleId: event.target.value })}>{roles.map(role => <option key={role.id} value={role.id}>{role.name}{role.enabled ? '' : '（已停用）'}</option>)}</select></label>
            <ScopeFields value={binding.scope} onChange={scope => editBinding(index, { scope })} campuses={campuses} departments={departments} />
            <div className="react-form-grid"><label>生效日期<input type="date" required value={binding.effectiveFrom || ''} onChange={event => editBinding(index, { effectiveFrom: event.target.value })} /></label><label>结束日期（可选）<input type="date" min={binding.effectiveFrom || undefined} value={binding.effectiveTo || ''} onChange={event => editBinding(index, { effectiveTo: event.target.value || null })} /></label></div>
            <button type="button" onClick={() => setBindings(current => current.filter((_, i) => i !== index))}>移除此项授权</button>
          </section>;
        })}
        <div className="react-editor-actions"><button type="button" onClick={() => setBindings(current => [...current, { roleId: roles.find(role => role.enabled)?.id || roles[0]?.id, scope: { campusIds: [profile.homeCampusId] }, effectiveFrom: dateKey(), effectiveTo: null }])}>添加角色</button><button className="react-primary">保存角色授权</button></div>
      </fieldset></form>}
    </>}
  </section></div>;
}
