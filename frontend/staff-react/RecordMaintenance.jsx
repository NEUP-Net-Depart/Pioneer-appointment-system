import React, { useContext, useEffect, useRef, useState } from 'react';
import { statusLabels, outcomeLabels, repairOutcomes } from '../../shared/constants.js';
import { request } from './request.js';
import { ActivityContext, Notice } from './field/ui';

// Record administration is shared by every repair detail entry point. The
// server returns available actions and revalidates each command independently.
export function RecordMaintenance({ item, onChanged, busy: parentBusy }) {
  const active = useContext(ActivityContext);
  const [section, setSection] = useState(''),
    [candidates, setCandidates] = useState([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(false);
  const [draft, setDraft] = useState(() => ({
    status: item.status,
    assignedTo: item.assignedTo || '',
    outcome: item.outcome === 'legacy_unknown' ? '' : item.outcome || '',
    repairNote: item.repairNote || '',
    expiresAt: '',
    correctionReason: ''
  }));
  const [verified, setVerified] = useState(false),
    [reason, setReason] = useState(''),
    [link, setLink] = useState(''),
    [message, setMessage] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    setPreview(false);
  }, [item.revision]);
  useEffect(() => {
    if (!active) {
      setPreview(false);
      setLink('');
      setVerified(false);
    }
  }, [active]);
  useEffect(() => {
    if (!active || section !== 'correct' || !item.canCorrect) return;
    const controller = new AbortController();
    request(`/api/field/appointments/${encodeURIComponent(item.id)}/assignees`, {
      signal: controller.signal
    })
      .then((result) => {
        if (!controller.signal.aborted) setCandidates(result.items);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, [active, section, item.id, item.canCorrect]);
  async function run(operation) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await operation();
    } catch (failure) {
      setPreview(false);
      setError(failure.message);
      if (failure.status === 409) await onChanged().catch(() => {});
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function correct() {
    run(async () => {
      const body = {
        revision: item.revision,
        status: draft.status,
        correctionReason: draft.correctionReason.trim()
      };
      if (draft.status === 'booked') {
        if (draft.expiresAt) body.expiresAt = new Date(`${draft.expiresAt}:00+08:00`).toISOString();
      } else {
        body.assignedTo = draft.assignedTo;
        body.repairNote = draft.repairNote.trim();
        if (draft.status === 'completed' && draft.outcome) body.outcome = draft.outcome;
      }
      await request(`/api/appointments/${encodeURIComponent(item.id)}/correction`, {
        method: 'PATCH',
        body
      });
      setSection('');
      setPreview(false);
      setMessage('预约记录已修正。');
      await onChanged();
    });
  }
  function recover(event) {
    event.preventDefault();
    run(async () => {
      const result = await request(`/api/appointments/${encodeURIComponent(item.id)}/credential`, {
        method: 'POST',
        body: { identityVerified: verified, reason: reason.trim() }
      });
      const url = new URL('/', location.origin);
      url.hash = new URLSearchParams({
        appointment: result.id,
        access: result.accessToken
      }).toString();
      setLink(url.href);
      setVerified(false);
      setReason('');
      setMessage('新凭证已签发，旧凭证立即失效。请将新链接交给核验通过的本人。');
      await onChanged();
    });
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setMessage('新私人链接已复制，请交给核验通过的本人。');
    } catch {
      setMessage('复制失败，请选中上方完整链接复制。');
    }
  }
  if (!item.canCorrect && !item.canRecoverCredential) return null;
  const disabled = busy || parentBusy;
  return (
    <section className="record-maintenance">
      <h3>记录管理</h3>
      <p className="field-muted">仅在核实信息后使用，系统会记录操作人和原因。</p>
      <div className="field-actions">
        {item.canCorrect && (
          <button
            disabled={disabled}
            aria-expanded={section === 'correct'}
            onClick={() => {
              setSection((value) => (value === 'correct' ? '' : 'correct'));
              setError('');
            }}
          >
            修正预约记录
          </button>
        )}
        {item.canRecoverCredential && (
          <button
            disabled={disabled}
            aria-expanded={section === 'credential'}
            onClick={() => {
              setSection((value) => (value === 'credential' ? '' : 'credential'));
              setError('');
            }}
          >
            重发客户凭证
          </button>
        )}
      </div>
      <Notice>{error || message}</Notice>
      {section === 'correct' && (
        <form
          className="workspace-form"
          onSubmit={(event) => {
            event.preventDefault();
            setPreview(true);
          }}
        >
          <fieldset disabled={disabled} className="workspace-form-fields">
            <label>
              修正后状态
              <select
                value={draft.status}
                onChange={(event) => {
                  setPreview(false);
                  setDraft({ ...draft, status: event.target.value });
                }}
              >
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {draft.status === 'booked' ? (
              <>
                <Notice>
                  恢复为已预约会清除维修人员、签到照片、开始与结束时间、维修说明及结果。需要重新核验接单。
                </Notice>
                <label>
                  新有效截止时间（北京时间，选填）
                  <input
                    type="datetime-local"
                    value={draft.expiresAt}
                    onChange={(event) => {
                      setPreview(false);
                      setDraft({ ...draft, expiresAt: event.target.value });
                    }}
                  />
                </label>
                <p className="field-muted">已过原有效期限的预约必须指定新的截止时间。</p>
              </>
            ) : (
              <>
                <label>
                  维修人员
                  <select
                    value={draft.assignedTo}
                    onChange={(event) => {
                      setPreview(false);
                      setDraft({ ...draft, assignedTo: event.target.value });
                    }}
                  >
                    <option value="">未分配</option>
                    {draft.assignedTo &&
                      !candidates.some((candidate) => candidate.account === draft.assignedTo) && (
                        <option value={draft.assignedTo}>
                          {item.assignedToName || draft.assignedTo}（原记录）
                        </option>
                      )}
                    {candidates.map((candidate) => (
                      <option value={candidate.account} key={candidate.account}>
                        {candidate.name} · {candidate.account}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  维修说明
                  <textarea
                    maxLength={3000}
                    rows={4}
                    value={draft.repairNote}
                    onChange={(event) => {
                      setPreview(false);
                      setDraft({ ...draft, repairNote: event.target.value });
                    }}
                  />
                </label>
                {draft.status === 'completed' && (
                  <label>
                    维修结果
                    <select
                      value={draft.outcome}
                      onChange={(event) => {
                        setPreview(false);
                        setDraft({ ...draft, outcome: event.target.value });
                      }}
                    >
                      <option value="">保留原有结果</option>
                      {repairOutcomes.map((value) => (
                        <option key={value} value={value}>
                          {outcomeLabels[value]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
            <label>
              纠错原因
              <textarea
                required
                minLength={8}
                maxLength={300}
                value={draft.correctionReason}
                onChange={(event) => {
                  setPreview(false);
                  setDraft({ ...draft, correctionReason: event.target.value });
                }}
                placeholder="至少 8 字，说明需要修正的原因"
              />
            </label>
          </fieldset>
          {!preview ? (
            <button disabled={disabled}>核对修改</button>
          ) : (
            <div className="field-confirm" role="region" aria-label="确认记录修正">
              <strong>
                {statusLabels[item.status]} → {statusLabels[draft.status]}
              </strong>
              <p>{draft.correctionReason}</p>
              <div className="field-actions">
                <button type="button" disabled={disabled} onClick={() => setPreview(false)}>
                  返回修改
                </button>
                <button
                  type="button"
                  className="field-primary"
                  disabled={disabled}
                  onClick={correct}
                >
                  {busy ? '正在修正…' : '确认修正记录'}
                </button>
              </div>
            </div>
          )}
        </form>
      )}
      {section === 'credential' && (
        <form className="workspace-form" onSubmit={recover}>
          <Notice>重发后原二维码与私人链接立即失效。请先人工核实客户本人身份。</Notice>
          <label className="workspace-check">
            <input
              type="checkbox"
              required
              checked={verified}
              disabled={disabled}
              onChange={(event) => setVerified(event.target.checked)}
            />
            已人工核验客户本人身份
          </label>
          <label>
            身份核验说明
            <textarea
              required
              minLength={8}
              maxLength={300}
              value={reason}
              disabled={disabled}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <button disabled={disabled || !verified}>{busy ? '正在签发…' : '签发新凭证'}</button>
          {link && (
            <div className="record-private-link">
              <label>
                新私人链接
                <input readOnly value={link} onFocus={(event) => event.target.select()} />
              </label>
              <button type="button" onClick={copy}>
                复制新私人链接
              </button>
            </div>
          )}
        </form>
      )}
    </section>
  );
}
