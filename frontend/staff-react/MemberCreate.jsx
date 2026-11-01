import React, { useEffect, useRef, useState } from 'react';
import { Modal, Notice } from './field/ui';
import { request } from './request.js';
import { staffPermission } from '../../shared/staff-access.js';
import { NEU_COLLEGES } from '../../shared/neu-colleges.js';
import { MemberSetup, newMemberSetup, memberDefaults } from './MemberSetup.jsx';

export function MemberCreate({ user, onClose, onSaved, onExisting }) {
  const [profile, setProfile] = useState({ studentId: '', name: '', college: '', major: '' });
  const [setup, setSetup] = useState(() => newMemberSetup(user));
  const [departments, setDepartments] = useState([]),
    [error, setError] = useState(''),
    [existing, setExisting] = useState(null),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    request('/api/organization/departments', { signal: controller.signal })
      .then((data) => setDepartments(data.items || []))
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, []);
  async function save(event) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setExisting(null);
    try {
      const data = await request('/api/members', {
        method: 'POST',
        body: { ...profile, ...memberDefaults(setup), requestId: crypto.randomUUID() }
      });
      onSaved(data.member);
      onClose();
    } catch (failure) {
      setError(failure.message);
      if (failure.code === 'MEMBER_EXISTS') setExisting(failure.fields);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal title="新增人员" sidePanel dismissible={!busy} onClose={onClose}>
      <form className="workspace-form" onSubmit={save}>
        <fieldset className="workspace-form-fields" disabled={busy}>
          <div className="react-form-grid">
            <label>
              学号
              <input
                required
                inputMode="numeric"
                pattern="[0-9]{6,20}"
                maxLength={20}
                value={profile.studentId}
                onChange={(event) => setProfile({ ...profile, studentId: event.target.value })}
              />
            </label>
            <label>
              姓名
              <input
                required
                maxLength={80}
                value={profile.name}
                onChange={(event) => setProfile({ ...profile, name: event.target.value })}
              />
            </label>
            <label>
              学院
              <select
                value={profile.college}
                onChange={(event) => setProfile({ ...profile, college: event.target.value })}
              >
                <option value="">待补充</option>
                {NEU_COLLEGES.map((college) => (
                  <option key={college}>{college}</option>
                ))}
              </select>
            </label>
            <label>
              专业
              <input
                maxLength={100}
                value={profile.major}
                onChange={(event) => setProfile({ ...profile, major: event.target.value })}
              />
            </label>
          </div>
        </fieldset>
        <MemberSetup
          value={setup}
          onChange={setSetup}
          departments={departments}
          disabled={busy}
          canAuthorize={
            staffPermission(user, 'roles.manage') && staffPermission(user, 'accounts.manage')
          }
        />
        <Notice>{error}</Notice>
        {existing && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onClose();
              onExisting({ memberId: existing.memberId, name: existing.name });
            }}
          >
            打开现有人员
          </button>
        )}
        <div className="field-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            className="react-primary"
            disabled={busy || (setup.kind === 'exchange' && !setup.trainingConfirmed)}
          >
            {busy ? '正在新增…' : '新增人员'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
