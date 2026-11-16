import { Select } from './SelectionControls.jsx';
import { useQuery } from '@tanstack/react-query';
import React, { useContext, useRef, useState } from 'react';
import { ActivityContext, Modal, Notice } from './field/ui';
import { request } from './request.js';
import { staffPermission } from '../../shared/staff-access.js';
import { NEU_COLLEGES } from '../../shared/neu-colleges.js';
import { MemberSetup, newMemberSetup, memberDefaults } from './MemberSetup.jsx';

export function MemberCreate({ user, onClose, onSaved, onExisting }) {
  const [profile, setProfile] = useState({ studentId: '', name: '', college: '', major: '' });
  const [setup, setSetup] = useState(() => newMemberSetup(user));
  const departmentsQuery = useQuery({
    queryKey: ['/api/organization/departments'],
    enabled: useContext(ActivityContext),
    staleTime: 5 * 60000,
    refetchInterval: false
  });
  const departments = departmentsQuery.data?.items || [];
  const [error, setError] = useState(''),
    [existing, setExisting] = useState(null),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);

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
      <form data-track="staff.membercreate.form.1" className="workspace-form" onSubmit={save}>
        <fieldset className="workspace-form-fields" disabled={busy}>
          <div className="react-form-grid">
            <label>
              学号
              <input
                data-track="staff.membercreate.input.2"
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
                data-track="staff.membercreate.input.3"
                required
                maxLength={80}
                value={profile.name}
                onChange={(event) => setProfile({ ...profile, name: event.target.value })}
              />
            </label>
            <label>
              学院
              <Select
                data-track="staff.membercreate.select.4"
                value={profile.college}
                onChange={(event) => setProfile({ ...profile, college: event.target.value })}
              >
                <option value="">待补充</option>
                {NEU_COLLEGES.map((college) => (
                  <option key={college}>{college}</option>
                ))}
              </Select>
            </label>
            <label>
              专业
              <input
                data-track="staff.membercreate.input.5"
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
          canAuthorize={staffPermission(user, 'accounts.manage')}
        />
        <Notice>{error || departmentsQuery.error?.message}</Notice>
        {existing && (
          <button
            data-track="staff.membercreate.button.6"
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
          <button
            data-track="staff.membercreate.button.7"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </button>
          <button
            data-track="staff.membercreate.button.8"
            className="react-primary"
            disabled={busy}
          >
            {busy ? '正在新增…' : '新增人员'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
