import React, { useContext, useEffect, useState } from 'react';
import { ActivityContext } from './field/ui';
import { useUnsavedChanges } from './useUnsavedChanges.js';
import { dateKey } from '../../shared/time.js';
import { staffIdentityLabels } from '../../shared/staff-identities.js';
import { request } from './request.js';

const emptyDraft = () => ({
  profileCode: 'repair',
  effectiveFrom: dateKey(),
  effectiveTo: '',
  trainingConfirmed: false
});
export function MemberQualifications({ detail, onSaved, onDirty, onBusy }) {
  const active = useContext(ActivityContext);
  const [draft, setDraft] = useState(emptyDraft);
  const [ending, setEnding] = useState(null),
    [endDate, setEndDate] = useState(dateKey());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const dirty = !!ending || JSON.stringify(draft) !== JSON.stringify(emptyDraft());
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  const navigationForm = useUnsavedChanges({
    dirty,
    active,
    busy,
    save,
    discard: () => {
      setEnding(null);
      setDraft(emptyDraft());
      setError('');
    }
  });
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    onBusy(true);
    setError('');
    setMessage('');
    try {
      await request(`/api/members/${encodeURIComponent(detail.member.memberId)}/work-profiles`, {
        method: 'POST',
        body: {
          revision: detail.member.revision,
          ...(ending
            ? { id: ending.id, profileRevision: ending.revision, effectiveTo: endDate }
            : { ...draft, effectiveTo: draft.effectiveTo || null }),
          requestId: crypto.randomUUID()
        }
      });
      await onSaved();
      setEnding(null);
      setDraft(emptyDraft());
      setMessage('工作资格已更新，相关账号需重新登录。历史记录保留。');
      return true;
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <div className="member-qualifications">
      <p className="field-muted">
        资格决定可参与的工作；负责人身份来自有效授权。交流人员通过培训后可以维修，不参与维修排班与换班。
      </p>
      {error && (
        <p className="react-error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <section aria-label="工作资格记录">
        {detail.member.workProfiles?.length ? (
          detail.member.workProfiles.map((item) => (
            <article className="react-binding" key={item.id}>
              <strong>{staffIdentityLabels[item.profileCode] || '工作资格'}</strong>
              <p>
                {item.effectiveFrom} 至 {item.effectiveTo || '长期有效'}
                {item.effectiveTo && item.effectiveTo <= dateKey()
                  ? ' · 已结束'
                  : item.effectiveFrom > dateKey()
                    ? ' · 待生效'
                    : ' · 当前有效'}
              </p>
              {(!item.effectiveTo || item.effectiveTo > dateKey()) && (
                <button
                  disabled={busy}
                  onClick={() => {
                    setEnding(item);
                    setEndDate(dateKey() < item.effectiveFrom ? item.effectiveFrom : dateKey());
                  }}
                >
                  结束此资格
                </button>
              )}
            </article>
          ))
        ) : (
          <p>尚未设置工作资格</p>
        )}
      </section>
      <form ref={navigationForm} onSubmit={save}>
        <fieldset disabled={busy}>
          <legend>
            {ending
              ? `结束${staffIdentityLabels[ending.profileCode] || '工作资格'}`
              : '新增工作资格'}
          </legend>
          {ending ? (
            <>
              <p>结束日期当天起不再具备该资格。已发生的签到和维修记录保留。</p>
              <label>
                结束日期
                <input
                  required
                  type="date"
                  min={ending.effectiveFrom}
                  max={ending.effectiveTo || undefined}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              <label>
                工作资格
                <select
                  value={draft.profileCode}
                  onChange={(e) =>
                    setDraft({ ...draft, profileCode: e.target.value, trainingConfirmed: false })
                  }
                >
                  {['repair', 'exchange', 'office'].map((code) => (
                    <option key={code} value={code}>
                      {staffIdentityLabels[code]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="react-form-grid">
                <label>
                  生效日期
                  <input
                    required
                    type="date"
                    value={draft.effectiveFrom}
                    onChange={(e) => setDraft({ ...draft, effectiveFrom: e.target.value })}
                  />
                </label>
                <label>
                  结束日期（可选）
                  <input
                    type="date"
                    min={draft.effectiveFrom}
                    value={draft.effectiveTo}
                    onChange={(e) => setDraft({ ...draft, effectiveTo: e.target.value })}
                  />
                </label>
              </div>
              {draft.profileCode === 'exchange' && (
                <label className="member-qualification-confirm">
                  <input
                    required
                    type="checkbox"
                    checked={draft.trainingConfirmed}
                    onChange={(e) => setDraft({ ...draft, trainingConfirmed: e.target.checked })}
                  />
                  已核验该成员通过维修培训
                </label>
              )}
            </>
          )}
          <div className="field-actions">
            {ending && (
              <button type="button" onClick={() => setEnding(null)}>
                取消
              </button>
            )}
            <button className="react-primary">
              {busy ? '正在保存…' : ending ? '确认结束资格' : '保存工作资格'}
            </button>
          </div>
        </fieldset>
      </form>
    </div>
  );
}
