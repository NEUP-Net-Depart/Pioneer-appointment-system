import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useContext, useEffect, useId, useRef, useState } from 'react';
import { NEU_COLLEGES } from '../../../shared/neu-colleges.js';
import { ChoiceMenu } from '../ChoiceMenu';
import { StaffIdentity } from '../StaffIdentity';
import { useUnsavedChanges } from '../useUnsavedChanges.js';
import { ActivityContext, api } from './ui';

type Profile = {
  member: {
    name: string;
    studentId: string;
    college: string;
    homeCampusId: string;
    revision: number;
  };
};

export function PersonalProfile({
  initialName,
  identities
}: {
  initialName: string;
  identities: { code: string; label: string }[];
}) {
  const client = useQueryClient();
  const queryKey = ['/api/me/profile'];
  const result = useQuery<Profile>({
    queryKey,
    enabled: useContext(ActivityContext),
    refetchInterval: false,
    refetchOnWindowFocus: false
  });
  const profile = result.data;
  const baseline = useRef<Profile['member'] | null>(null);
  const revision = useRef<number | null>(null);
  const [name, setName] = useState(initialName);
  const [college, setCollege] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const formId = useId();
  const changed =
    !!baseline.current &&
    (name.trim() !== baseline.current.name || college !== (baseline.current.college || ''));
  useEffect(() => {
    if (!profile || busy || changed) return;
    baseline.current = profile.member;
    revision.current = profile.member.revision;
    setName(profile.member.name);
    setCollege(profile.member.college || '');
  }, [profile, busy, changed]);
  const formRef = useUnsavedChanges({
    dirty: changed,
    busy,
    save,
    discard: () => {
      baseline.current = profile?.member || null;
      revision.current = profile?.member.revision ?? null;
      setName(profile?.member.name || initialName);
      setCollege(profile?.member.college || '');
      setError('');
    }
  });
  async function save(event?: React.FormEvent) {
    event?.preventDefault();
    if (!profile || !changed || busy) return true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const next = await api<Profile>('/api/me/profile', {
        method: 'PATCH',
        body: {
          name: name.trim(),
          college,
          revision: revision.current,
          requestId: crypto.randomUUID()
        }
      });
      if (!next?.member || typeof next.member.name !== 'string')
        throw new Error('保存结果不完整，请刷新后核对资料');
      await client.cancelQueries({ queryKey });
      client.setQueryData(queryKey, next);
      revision.current = next.member.revision;
      baseline.current = next.member;
      const affectedQueries = {
        predicate: (query) =>
          ['/api/members', '/api/users', '/api/field/home', '/api/field/board'].includes(
            query.queryKey[0]
          )
      };
      await client.cancelQueries(affectedQueries);
      await client.invalidateQueries(affectedQueries);
      setName(next.member.name);
      setCollege(next.member.college);
      setMessage('个人资料已保存');
      return true;
    } catch (failure) {
      setError((failure as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const campusName =
    { 'campus-nanhu': '南湖', 'campus-hunnan': '浑南' }[profile?.member.homeCampusId || ''] || '—';
  return (
    <div className="personal-profile">
      <div className="personal-identity">
        <span data-motion-value="text" className="field-avatar" aria-hidden="true">
          {(profile?.member.name || initialName).slice(-2)}
        </span>
        <div className="personal-identity-details">
          <h2 data-motion-value="text">{profile?.member.name || initialName}</h2>
          <StaffIdentity identities={identities} />
        </div>
        {(changed || busy) && (
          <button
            data-track="staff.field.personalprofile.button.1"
            className="field-primary personal-profile-save"
            type="submit"
            form={formId}
            disabled={!name.trim() || !college || busy}
          >
            {busy ? '保存中…' : '保存资料'}
          </button>
        )}
      </div>
      <form
        data-track="staff.field.personalprofile.form.2"
        id={formId}
        ref={formRef}
        onSubmit={save}
      >
        <div className="personal-profile-grid">
          <label>
            姓名
            <input
              data-track="staff.field.personalprofile.input.3"
              required
              maxLength={80}
              value={name}
              disabled={!profile || busy}
              onChange={(event) => {
                setName(event.target.value);
                setMessage('');
              }}
            />
          </label>
          <label>
            学号
            <output>{profile?.member.studentId || '—'}</output>
          </label>
          <ChoiceMenu
            data-track="staff.field.personalprofile.choicemenu.4"
            className="personal-college-choice"
            label="学院"
            value={college}
            disabled={!profile || busy}
            onChange={(value) => {
              setCollege(value);
              setMessage('');
            }}
            options={[
              ...(college && !NEU_COLLEGES.includes(college)
                ? [{ value: college, label: college }]
                : []),
              ...NEU_COLLEGES.map((item) => ({ value: item, label: item }))
            ]}
          />
          <label>
            所属校区
            <output>{campusName}</output>
          </label>
        </div>
      </form>
      {(error || result.error) && (
        <p role="alert" className="react-error">
          {error || result.error?.message}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
