import { DataFields } from './DataValue';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { dateKey } from '../../shared/time.js';
import { request } from './request.js';
import { ScopeFields } from './ScopeFields.jsx';
import { roleBindingsPayload } from './authorization-drafts.js';
import { ActivityContext, Modal } from './field/ui';
import { WorkspaceSections } from './WorkspaceSections';
import { MemberQualifications } from './MemberQualifications.jsx';
import { StaffIdentity } from './StaffIdentity';
import { useUnsavedChanges } from './useUnsavedChanges.js';

const campuses = [
  { id: 'campus-nanhu', name: '南湖' },
  { id: 'campus-hunnan', name: '浑南' }
];

export function MemberEditor({
  member,
  canManageRoles,
  canManageQualifications = canManageRoles,
  onClose,
  onSaved
}) {
  const active = useContext(ActivityContext),
    lock = useRef(false);
  const [detail, setDetail] = useState(null);
  const [readRevision, setReadRevision] = useState(0);
  const [profile, setProfile] = useState({
    name: member.name,
    homeCampusId: member.homeCampusId,
    status: member.status
  });
  const [bindings, setBindings] = useState([]);
  const [roles, setRoles] = useState([]);
  const bindableRoles = roles.filter((role) => role.actions?.bind !== false);
  const [departments, setDepartments] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [section, setSection] = useState('profile'),
    [confirmClose, setConfirmClose] = useState(false);
  const [qualificationDirty, setQualificationDirty] = useState(false);
  const profileDirty =
    detail && ['name', 'homeCampusId', 'status'].some((key) => profile[key] !== detail.member[key]);
  const bindingsDirty =
    detail && JSON.stringify(bindings) !== JSON.stringify(detail.bindings || []);
  const dirty = profileDirty || bindingsDirty || qualificationDirty;
  const profileForm = useUnsavedChanges({
    dirty: profileDirty,
    active,
    busy,
    save: saveProfile,
    discard: () => {
      setProfile({
        name: detail.member.name,
        homeCampusId: detail.member.homeCampusId,
        status: detail.member.status
      });
      setConfirmClose(false);
    }
  });
  const rolesForm = useUnsavedChanges({
    dirty: bindingsDirty,
    active,
    busy,
    save: saveBindings,
    discard: () => {
      setBindings(structuredClone(detail.bindings || []));
      setConfirmClose(false);
    }
  });
  useEffect(() => {
    let active = true;
    request(`/api/members/${encodeURIComponent(member.memberId)}`)
      .then((data) => {
        if (!active) return;
        setDetail(data);
        setBindings(data.bindings || []);
        setProfile({
          name: data.member.name,
          homeCampusId: data.member.homeCampusId,
          status: data.member.status
        });
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    request('/api/organization/departments')
      .then((data) => {
        if (active) setDepartments(data.items || []);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    if (canManageRoles)
      request('/api/roles')
        .then((data) => {
          if (active) setRoles(data.items || []);
        })
        .catch((err) => {
          if (active) setError(err.message);
        });
    return () => {
      active = false;
    };
  }, [member.memberId, canManageRoles, readRevision]);

  async function saveProfile(event) {
    event.preventDefault();
    if (lock.current || !detail) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const data = await request(`/api/members/${encodeURIComponent(member.memberId)}`, {
        method: 'PATCH',
        body: { ...profile, revision: detail.member.revision }
      });
      setDetail((current) => ({ ...current, member: data.member }));
      setMessage('成员资料已保存');
      onSaved();
      return true;
    } catch (err) {
      setError(err.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function saveBindings(event) {
    event.preventDefault();
    if (lock.current || !detail) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await request(`/api/members/${encodeURIComponent(member.memberId)}/roles`, {
        method: 'PUT',
        body: { revision: detail.member.revision, bindings: roleBindingsPayload(bindings) }
      });
      const data = await request(`/api/members/${encodeURIComponent(member.memberId)}`);
      setDetail(data);
      setBindings(data.bindings || []);
      setMessage('角色授权已保存，相关账号需要重新登录');
      onSaved();
      return true;
    } catch (err) {
      setError(err.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function editBinding(index, patch) {
    setBindings((current) =>
      current.map((binding, i) => (i === index ? { ...binding, ...patch } : binding))
    );
  }
  function close() {
    if (!busy) {
      if (dirty) setConfirmClose(true);
      else onClose();
    }
  }
  async function reload() {
    const data = await request(`/api/members/${encodeURIComponent(member.memberId)}`);
    setDetail(data);
    onSaved();
  }
  return (
    <Modal title={member.name} sidePanel dismissible={!busy} onClose={close}>
      <div className="member-detail-editor">
        {confirmClose && (
          <>
            <h3>放弃未保存的修改？</h3>
            <p>成员资料和角色授权中的未保存输入都会丢失。</p>
            <div className="field-actions">
              <button onClick={() => setConfirmClose(false)}>返回继续编辑</button>
              <button onClick={onClose}>放弃修改并关闭</button>
            </div>
          </>
        )}
        <div hidden={confirmClose}>
          <p className="field-muted">资料与授权分别保存；所属校区不改变授权范围。</p>
          <StaffIdentity identities={detail?.member.identities} />
          <WorkspaceSections
            label="成员详情"
            value={section}
            onChange={setSection}
            items={[
              { id: 'profile', label: '成员资料' },
              ...(canManageQualifications && detail?.actions?.edit !== false
                ? [{ id: 'qualifications', label: '工作资格' }]
                : []),
              ...(canManageRoles && !detail?.account?.protected && detail?.actions?.edit !== false
                ? [{ id: 'roles', label: '角色授权' }]
                : [])
            ]}
          />
          {error && (
            <p className="react-error" role="alert">
              {error}
            </p>
          )}
          {message && <p role="status">{message}</p>}
          <form ref={profileForm} hidden={section !== 'profile'} onSubmit={saveProfile}>
            <fieldset
              aria-busy={!detail && !error}
              disabled={busy || !detail || detail.actions?.edit === false}
            >
              <legend>成员资料{profileDirty ? ' · 未保存' : ''}</legend>
              <label>
                姓名
                <input
                  required
                  data-motion-value="field"
                  value={profile.name}
                  onChange={(event) => setProfile({ ...profile, name: event.target.value })}
                />
              </label>
              <label>
                所属校区
                <select
                  data-motion-value="field"
                  value={profile.homeCampusId}
                  onChange={(event) => setProfile({ ...profile, homeCampusId: event.target.value })}
                >
                  {campuses.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                成员状态
                <select
                  data-motion-value="field"
                  value={profile.status}
                  onChange={(event) => setProfile({ ...profile, status: event.target.value })}
                >
                  <option value="active">正常</option>
                  <option value="inactive">停用</option>
                </select>
              </label>
              <button className="react-primary">保存资料</button>
            </fieldset>
          </form>

          {!detail ? (
            error ? (
              <button
                onClick={() => {
                  setError('');
                  setReadRevision((value) => value + 1);
                }}
              >
                重新读取成员资料
              </button>
            ) : section === 'profile' ? null : (
              <section>
                <h3>{section === 'roles' ? '角色授权' : '工作资格'}</h3>
                <p className="field-muted">
                  {section === 'roles'
                    ? '授权校区独立于所属校区；结束日期当天起失效。'
                    : '工作资格用于确认成员可以参与的岗位，身份与角色授权分别管理。'}
                </p>
                <DataFields
                  fields={
                    section === 'roles'
                      ? [['已授角色'], ['授权范围'], ['有效期']]
                      : [['资格类型'], ['有效期'], ['培训确认']]
                  }
                />
              </section>
            )
          ) : (
            <>
              {canManageQualifications &&
                detail.actions?.edit !== false &&
                (section === 'qualifications' || qualificationDirty) && (
                  <div hidden={section !== 'qualifications'}>
                    <MemberQualifications
                      detail={detail}
                      onSaved={reload}
                      onDirty={setQualificationDirty}
                      onBusy={setBusy}
                    />
                  </div>
                )}
              {detail.account?.protected && (
                <p className="react-muted">此系统账号受保护，仅本人可验证原密码后修改密码。</p>
              )}
              {canManageRoles && !detail.account?.protected && detail.actions?.edit !== false && (
                <form ref={rolesForm} hidden={section !== 'roles'} onSubmit={saveBindings}>
                  <fieldset disabled={busy || !roles.length}>
                    <legend>角色授权{bindingsDirty ? ' · 未保存' : ''}</legend>
                    <p className="react-muted">授权校区独立于所属校区；结束日期当天起失效。</p>
                    {bindings.map((binding, index) => {
                      return (
                        <details
                          className="react-binding workspace-binding"
                          open={index === 0 || !binding.id}
                          key={binding.id || `new-${index}`}
                        >
                          <summary>
                            <span>
                              <strong>
                                {roles.find((role) => role.id === binding.roleId)?.name ||
                                  '待选择角色'}
                              </strong>
                              <small>
                                {binding.scope?.campusIds?.length
                                  ? binding.scope.campusIds
                                      .map(
                                        (id) =>
                                          campuses.find((campus) => campus.id === id)?.name ||
                                          '指定校区'
                                      )
                                      .join('、')
                                  : '按授权范围'}{' '}
                                · {binding.effectiveFrom || '待设置生效日期'}
                                {binding.effectiveTo
                                  ? ` 至 ${binding.effectiveTo}`
                                  : ' 起，长期有效'}
                              </small>
                            </span>
                            <span className="workspace-binding-hint">展开编辑</span>
                          </summary>
                          <div className="workspace-binding-fields">
                            <label>
                              角色
                              <select
                                value={binding.roleId}
                                onChange={(event) =>
                                  editBinding(index, { roleId: event.target.value })
                                }
                              >
                                {bindableRoles.map((role) => (
                                  <option key={role.id} value={role.id}>
                                    {role.name}
                                    {role.enabled ? '' : '（已停用）'}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <ScopeFields
                              value={binding.scope}
                              onChange={(scope) => editBinding(index, { scope })}
                              campuses={campuses}
                              departments={departments}
                            />
                            <div className="react-form-grid">
                              <label>
                                生效日期
                                <input
                                  type="date"
                                  required
                                  value={binding.effectiveFrom || ''}
                                  onChange={(event) =>
                                    editBinding(index, { effectiveFrom: event.target.value })
                                  }
                                />
                              </label>
                              <label>
                                结束日期（可选）
                                <input
                                  type="date"
                                  min={binding.effectiveFrom || undefined}
                                  value={binding.effectiveTo || ''}
                                  onChange={(event) =>
                                    editBinding(index, { effectiveTo: event.target.value || null })
                                  }
                                />
                              </label>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setBindings((current) => current.filter((_, i) => i !== index))
                              }
                            >
                              移除此项授权
                            </button>
                          </div>
                        </details>
                      );
                    })}
                    <div className="react-editor-actions">
                      <button
                        type="button"
                        disabled={!bindableRoles.some((role) => role.enabled)}
                        onClick={() =>
                          setBindings((current) => [
                            ...current,
                            {
                              roleId: bindableRoles.find((role) => role.enabled)?.id,
                              scope: { campusIds: [profile.homeCampusId] },
                              effectiveFrom: dateKey(),
                              effectiveTo: null
                            }
                          ])
                        }
                      >
                        添加角色
                      </button>
                      <button className="react-primary">保存角色授权</button>
                    </div>
                  </fieldset>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
