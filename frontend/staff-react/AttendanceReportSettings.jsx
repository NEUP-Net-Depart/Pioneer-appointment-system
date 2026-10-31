import React, { useEffect, useRef, useState } from 'react';
import { request } from './request.js';
import { useUnsavedChanges } from './useUnsavedChanges.js';

const countLabels = {
  weekly: '每周最多一次',
  actual: '按实际计入'
};

export function AttendanceReportSettings({ active, onSaved }) {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const editButton = useRef(null);
  const closeEditor = () => {
    setEditing(false);
    requestAnimationFrame(() => editButton.current?.focus());
  };
  const dirty =
    !!saved &&
    !!draft &&
    ['countMode', 'hoursPerCount', 'mergeLeaders'].some((key) => saved[key] !== draft[key]);
  useEffect(() => {
    if (!active || saved) return;
    const controller = new AbortController();
    request('/api/attendance/report-settings', { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) {
          setSaved(result);
          setDraft(result);
          setError('');
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, [active, saved]);
  async function save(event) {
    event?.preventDefault();
    if (!draft || !dirty || busy) return true;
    setBusy(true);
    setError('');
    try {
      const result = await request('/api/attendance/report-settings', {
        method: 'PUT',
        body: { ...draft, requestId: crypto.randomUUID() }
      });
      const next = { ...result, canEdit: saved.canEdit };
      setSaved(next);
      setDraft(next);
      closeEditor();
      setMessage('导出规则已保存');
      onSaved?.();
      return true;
    } catch (failure) {
      setError(failure.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const formRef = useUnsavedChanges({
    dirty,
    active: active && editing,
    busy,
    save,
    discard: () => {
      setDraft(saved);
      closeEditor();
    }
  });
  return (
    <section className="report-settings" aria-labelledby="report-settings-title">
      <div className="report-settings-heading">
        <div>
          <h2 id="report-settings-title">志愿登记表规则</h2>
          {saved && !editing && (
            <p>
              {countLabels[saved.countMode]} · {saved.hoursPerCount} 小时/次 · 负责人
              {saved.mergeLeaders ? '自动计入' : '按签到计入'}
            </p>
          )}
        </div>
        {saved?.canEdit && !editing && (
          <button
            type="button"
            ref={editButton}
            onClick={() => {
              setMessage('');
              setEditing(true);
            }}
          >
            修改规则
          </button>
        )}
      </div>
      {error && (
        <p className="react-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="react-message" role="status">
          {message}
        </p>
      )}
      {!saved && !error && <p className="report-settings-loading">正在读取规则…</p>}
      {editing && draft && (
        <form ref={formRef} className="report-settings-form" onSubmit={save}>
          <fieldset disabled={busy}>
            <legend>签到计数</legend>
            <div className="report-count-options">
              {Object.entries(countLabels).map(([value, label]) => (
                <label key={value} className={draft.countMode === value ? 'is-selected' : ''}>
                  <input
                    type="radio"
                    name="countMode"
                    value={value}
                    checked={draft.countMode === value}
                    onChange={() => setDraft({ ...draft, countMode: value })}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="report-rule-fields">
            <label>
              <span>每次时长</span>
              <span className="report-hours-control">
                <input
                  type="number"
                  min="0.5"
                  max="24"
                  step="0.5"
                  required
                  value={draft.hoursPerCount}
                  onChange={(event) =>
                    setDraft({ ...draft, hoursPerCount: Number(event.target.value) })
                  }
                />
                <span>小时</span>
              </span>
            </label>
            <label className="report-leader-option">
              <input
                type="checkbox"
                checked={draft.mergeLeaders}
                onChange={(event) => setDraft({ ...draft, mergeLeaders: event.target.checked })}
              />
              <span>负责人每周自动计入一次</span>
            </label>
          </div>
          <div className="report-settings-actions">
            <button
              type="button"
              onClick={() => {
                setDraft(saved);
                closeEditor();
                setError('');
              }}
              disabled={busy}
            >
              取消
            </button>
            <button type="submit" className="field-primary" disabled={!dirty || busy}>
              {busy ? '保存中…' : '保存规则'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
