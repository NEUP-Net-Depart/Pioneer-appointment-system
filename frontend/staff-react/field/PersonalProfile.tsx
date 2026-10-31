import { useEffect, useId, useState } from 'react';
import { NEU_COLLEGES } from '../../../shared/neu-colleges.js';
import { ChoiceMenu } from '../ChoiceMenu';
import { StaffIdentity } from '../StaffIdentity';
import { useUnsavedChanges } from '../useUnsavedChanges.js';
import { api } from './ui';

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
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState(initialName);
  const [college, setCollege] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const formId = useId();
  useEffect(() => {
    const controller = new AbortController();
    api<Profile>('/api/me/profile', { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result?.member || typeof result.member.name !== 'string')
          throw new Error('个人资料暂时无法读取，请刷新后重试');
        setProfile(result);
        setName(result.member.name);
        setCollege(result.member.college || '');
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, []);
  const changed =
    !!profile &&
    (name.trim() !== profile.member.name || college !== (profile.member.college || ''));
  const formRef = useUnsavedChanges({
    dirty: changed,
    busy,
    save,
    discard: () => {
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
          revision: profile.member.revision,
          requestId: crypto.randomUUID()
        }
      });
      if (!next?.member || typeof next.member.name !== 'string')
        throw new Error('保存结果不完整，请刷新后核对资料');
      setProfile(next);
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
            className="field-primary personal-profile-save"
            type="submit"
            form={formId}
            disabled={!name.trim() || !college || busy}
          >
            {busy ? '保存中…' : '保存资料'}
          </button>
        )}
      </div>
      <form id={formId} ref={formRef} onSubmit={save}>
        <div className="personal-profile-grid">
          <label>
            姓名
            <input
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
      {error && (
        <p role="alert" className="react-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
