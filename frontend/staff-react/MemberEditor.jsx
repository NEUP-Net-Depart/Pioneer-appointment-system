import React, { useContext, useEffect, useRef, useState } from 'react';
import { dateKey } from '../../shared/time.js';
import { request } from './request.js';
import { withCampusScope, roleBindingsPayload } from './authorization-drafts.js';
import { ActivityContext, Modal } from './field/ui';
import { WorkspaceSections } from './WorkspaceSections';
import { StaffIdentity } from './StaffIdentity';
import { useUnsavedChanges } from './useUnsavedChanges.js';
import { NEU_COLLEGES } from '../../shared/neu-colleges.js';
import { MemberMemberships } from './MemberMemberships.jsx';
import { MemberAccount } from './MemberAccount.jsx';
import { MemberHistory } from './MemberHistory.jsx';
import { staffPermission } from '../../shared/staff-access.js';

const campuses = [
  { id: 'campus-nanhu', name: '南湖' },
  { id: 'campus-hunnan', name: '浑南' }
];

export function MemberEditor({ user, member, canManageRoles, onClose, onSaved }) {
  const active = useContext(ActivityContext),
    lock = useRef(false);
  const [detail, setDetail] = useState(null);
  const [readRevision, setReadRevision] = useState(0);
  const [profile, setProfile] = useState({
    name: member.name,
    college: member.college || '',
    major: member.major || '',
    homeCampusId: member.homeCampusId || '',
    status: member.status || ''
  });
  const [bindings, setBindings] = useState([]);
  const [roles, setRoles] = useState([]);
  const bindableRoles = roles.filter((role) => role.actions?.bind !== false);
  const newBindingRoles = bindableRoles;
  const availableCampuses = campuses.filter((campus) =>
    (user.authorizedCampuses || []).some((id) => id === campus.id || id === campus.name)
  );
  function bindingCampuses(binding) {
    const raw = binding.scope?.campusIds ?? binding.scope?.campuses;
    return (
      Array.isArray(raw)
        ? raw
        : raw === 'bound'
          ? detail?.account?.authorizedCampuses || user.authorizedCampuses || []
          : []
    ).map((id) => campuses.find((campus) => campus.name === id)?.id || id);
  }
  const [departments, setDepartments] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [section, setSection] = useState('profile'),
    [confirmClose, setConfirmClose] = useState(false);
  const [membershipDirty, setMembershipDirty] = useState(false);
  const [accountDirty, setAccountDirty] = useState(false);
  const profileDirty =
    detail &&
    ['name', 'college', 'major', 'homeCampusId', 'status'].some(
      (key) => profile[key] !== detail.member[key]
    );
  const bindingsDirty =
    detail && JSON.stringify(bindings) !== JSON.stringify(detail.bindings || []);
  const dirty = profileDirty || bindingsDirty || membershipDirty || accountDirty;
  const profileForm = useUnsavedChanges({
    dirty: profileDirty,
    active,
    busy,
    save: saveProfile,
    discard: () => {
      setProfile({
        name: detail.member.name,
        college: detail.member.college,
        major: detail.member.major,
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
          college: data.member.college,
          major: data.member.major,
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
      setDetail((current) => ({
        ...current,
        member: {
          ...current.member,
          ...data.member,
          memberships: current.member.memberships
        }
      }));
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
      setMessage('系统授权已保存，相关账号需要重新登录');
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
            <p>人员详情中的未保存修改都会丢失。</p>
            <div className="field-actions">
              <button onClick={() => setConfirmClose(false)}>返回继续编辑</button>
              <button onClick={onClose}>放弃修改并关闭</button>
            </div>
          </>
        )}
        <div hidden={confirmClose}>
          <StaffIdentity identities={detail?.member.identities} />
          <WorkspaceSections
            label="成员详情"
            value={section}
            onChange={setSection}
            items={[
              { id: 'profile', label: '基本资料与组织任职' },
              ...(staffPermission(user, 'accounts.manage') ||
              (canManageRoles &&
                !detail?.account?.protected &&
                detail?.actions?.editRoles !== false)
                ? [{ id: 'participation', label: '账号与系统授权' }]
                : []),
              ...(detail?.actions?.readAudit === false
                ? []
                : [{ id: 'history', label: '操作记录' }])
            ]}
          />
          {error && (
            <p data-motion-value="text" className="react-error" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p data-motion-value="text" role="status">
              {message}
            </p>
          )}
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
                <span className="workspace-native-select">
                  <select
                    data-motion-value="field"
                    value={profile.homeCampusId}
                    onChange={(event) =>
                      setProfile({ ...profile, homeCampusId: event.target.value })
                    }
                  >
                    {campuses.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <span className="workspace-chevron" aria-hidden="true" />
                </span>
              </label>
              <label>
                学院
                <span className="workspace-native-select">
                  <select
                    data-motion-value="field"
                    value={profile.college}
                    onChange={(event) => setProfile({ ...profile, college: event.target.value })}
                  >
                    <option value="">待补充</option>
                    {profile.college && !NEU_COLLEGES.includes(profile.college) && (
                      <option value={profile.college}>{profile.college}</option>
                    )}
                    {NEU_COLLEGES.map((college) => (
                      <option key={college} value={college}>
                        {college}
                      </option>
                    ))}
                  </select>
                  <span className="workspace-chevron" aria-hidden="true" />
                </span>
              </label>
              <label>
                成员状态
                <span className="workspace-native-select">
                  <select
                    data-motion-value="field"
                    value={profile.status}
                    onChange={(event) => setProfile({ ...profile, status: event.target.value })}
                  >
                    <option value="active">正常</option>
                    <option value="inactive">停用</option>
                  </select>
                  <span className="workspace-chevron" aria-hidden="true" />
                </span>
              </label>
              <label>
                专业
                <input
                  maxLength={100}
                  value={profile.major}
                  onChange={(event) => setProfile({ ...profile, major: event.target.value })}
                />
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
            ) : null
          ) : (
            <>
              {(section === 'profile' || membershipDirty) && (
                <div hidden={section !== 'profile'}>
                  <MemberMemberships
                    detail={detail}
                    departments={departments}
                    onSaved={reload}
                    onDirty={setMembershipDirty}
                    onBusy={setBusy}
                  />
                </div>
              )}
              {(section === 'participation' || accountDirty) &&
                staffPermission(user, 'accounts.manage') && (
                  <div hidden={section !== 'participation'}>
                    <MemberAccount
                      user={user}
                      detail={detail}
                      onDirty={setAccountDirty}
                      onBusy={setBusy}
                      onSaved={async () => {
                        const data = await request(
                          `/api/members/${encodeURIComponent(member.memberId)}`
                        );
                        setDetail(data);
                        if (!profileDirty)
                          setProfile({
                            name: data.member.name,
                            college: data.member.college,
                            major: data.member.major,
                            homeCampusId: data.member.homeCampusId,
                            status: data.member.status
                          });
                        onSaved();
                      }}
                    />
                  </div>
                )}
              {section === 'history' && <MemberHistory memberId={member.memberId} />}
              {detail.account?.protected && (
                <p className="react-muted">此系统账号受保护，仅本人可验证原密码后修改密码。</p>
              )}
              {canManageRoles &&
                !detail.account?.protected &&
                detail.actions?.editRoles !== false && (
                  <form
                    ref={rolesForm}
                    hidden={section !== 'participation'}
                    onSubmit={saveBindings}
                  >
                    <fieldset disabled={busy || !roles.length}>
                      <legend>系统授权{bindingsDirty ? ' · 未保存' : ''}</legend>
                      <details>
                        <summary>编辑系统授权</summary>
                        {bindings.map((binding, index) => {
                          return (
                            <details
                              data-motion-item=""
                              className="react-binding workspace-binding"
                              open={index === 0 || !binding.id}
                              key={binding.id || `new-${index}`}
                            >
                              <summary>
                                <span>
                                  <strong data-motion-value="text">
                                    {roles.find((role) => role.id === binding.roleId)?.name ||
                                      '待选择角色'}
                                  </strong>
                                </span>
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
                                    {bindableRoles
                                      .filter(
                                        (role) =>
                                          role.id === binding.roleId ||
                                          newBindingRoles.some(
                                            (candidate) => candidate.id === role.id
                                          )
                                      )
                                      .map((role) => (
                                        <option key={role.id} value={role.id}>
                                          {role.name}
                                          {role.enabled ? '' : '（已停用）'}
                                        </option>
                                      ))}
                                  </select>
                                </label>
                                <fieldset>
                                  <legend>授权校区</legend>
                                  {availableCampuses.map((campus) => (
                                    <label className="workspace-check" key={campus.id}>
                                      <input
                                        type="checkbox"
                                        checked={bindingCampuses(binding).includes(campus.id)}
                                        onChange={(event) => {
                                          const selected = bindingCampuses(binding);
                                          editBinding(index, {
                                            scope: withCampusScope(
                                              binding.scope || {},
                                              event.target.checked
                                                ? [...new Set([...selected, campus.id])]
                                                : selected.filter((id) => id !== campus.id)
                                            )
                                          });
                                        }}
                                      />
                                      {campus.name}
                                    </label>
                                  ))}
                                </fieldset>
                                <label>
                                  原因
                                  <input
                                    required
                                    maxLength={300}
                                    value={binding.reason || ''}
                                    onChange={(event) =>
                                      editBinding(index, { reason: event.target.value })
                                    }
                                  />
                                </label>
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
                                        editBinding(index, {
                                          effectiveTo: event.target.value || null
                                        })
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
                            disabled={!newBindingRoles.some((role) => role.enabled)}
                            onClick={() =>
                              setBindings((current) => [
                                ...current,
                                {
                                  roleId: newBindingRoles.find((role) => role.enabled)?.id,
                                  scope: { campusIds: [] },
                                  effectiveFrom: dateKey(),
                                  effectiveTo: null,
                                  reason: ''
                                }
                              ])
                            }
                          >
                            添加系统授权
                          </button>
                          <button className="react-primary">保存系统授权</button>
                        </div>
                      </details>
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
