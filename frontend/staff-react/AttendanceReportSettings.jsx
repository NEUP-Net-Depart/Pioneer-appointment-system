import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useRef, useState } from 'react';
import { request } from './request.js';
import { useUnsavedChanges } from './useUnsavedChanges.js';
import { DataValue } from './DataValue';

const countLabels = {
  weekly: '每周最多一次',
  actual: '按实际计入'
};

export function AttendanceReportSettings({ active, onSaved }) {
  const client = useQueryClient();
  const queryKey = ['/api/attendance/report-settings'];
  const result = useQuery({
    queryKey,
    enabled: active,
    staleTime: 5 * 60000,
    refetchInterval: false
  });
  const saved = result.data;
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
      await client.cancelQueries({ queryKey });
      client.setQueryData(queryKey, next);
      await client.invalidateQueries({ queryKey: ['/api/me/volunteer-summary'] });
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
          {!editing && (
            <p>
              <DataValue label="签到计数规则">
                {saved ? countLabels[saved.countMode] : undefined}
              </DataValue>{' '}
              · <DataValue label="每次时长">{saved?.hoursPerCount}</DataValue> 小时/次 · 负责人
              <DataValue label="负责人登记规则">
                {saved ? (saved.mergeLeaders ? '自动计入' : '按签到计入') : undefined}
              </DataValue>
            </p>
          )}
        </div>
        {saved?.canEdit && !editing && (
          <button
            data-track="staff.attendancereportsettings.button.1"
            type="button"
            ref={editButton}
            onClick={() => {
              setMessage('');
              setDraft(saved);
              setEditing(true);
            }}
          >
            修改规则
          </button>
        )}
      </div>
      {(error || result.error) && (
        <p className="react-error" role="alert">
          {error || result.error?.message}
        </p>
      )}
      {message && (
        <p className="react-message" role="status">
          {message}
        </p>
      )}
      {editing && draft && (
        <form
          data-track="staff.attendancereportsettings.form.2"
          ref={formRef}
          className="report-settings-form"
          onSubmit={save}
        >
          <fieldset disabled={busy}>
            <legend>签到计数</legend>
            <div className="report-count-options">
              {Object.entries(countLabels).map(([value, label]) => (
                <label key={value} className={draft.countMode === value ? 'is-selected' : ''}>
                  <input
                    data-track="staff.attendancereportsettings.input.3"
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
                  data-track="staff.attendancereportsettings.input.4"
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
                data-track="staff.attendancereportsettings.input.5"
                type="checkbox"
                checked={draft.mergeLeaders}
                onChange={(event) => setDraft({ ...draft, mergeLeaders: event.target.checked })}
              />
              <span>负责人每周自动计入一次</span>
            </label>
          </div>
          <div className="report-settings-actions">
            <button
              data-track="staff.attendancereportsettings.button.6"
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
            <button
              data-track="staff.attendancereportsettings.button.7"
              type="submit"
              className="field-primary"
              disabled={!dirty || busy}
            >
              {busy ? '保存中…' : '保存规则'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
