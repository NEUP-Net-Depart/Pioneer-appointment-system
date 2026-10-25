import React, { useState } from 'react';

export function CollectionSettings({ series, task, busy, error, onSave }) {
  const [name, setName] = useState(
    series.name ||
      task.collectionName ||
      `${task.dutyType === 'office' ? '办公' : '维修'}可用时间收集`
  );
  const [enabled, setEnabled] = useState(!!series.enabled),
    [useCurrent, setUseCurrent] = useState(false);
  const [recurrence, setRecurrence] = useState({
    publishWeekday: series.publish_weekday,
    publishTime: series.publish_time,
    deadlineWeekday: series.deadline_weekday,
    deadlineTime: series.deadline_time
  });
  return (
    <form
      className="roster-compose"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          enabled,
          name,
          revision: series.revision,
          recurrence,
          ...(useCurrent ? { templateTaskId: task.id, templateRevision: task.revision } : {})
        });
      }}
    >
      <p className="react-muted">
        发布一次，始终使用这个任务。本次结束后立即收集下一工作周，各周填报和班表独立保留；重新开放历史周不影响下一周。
      </p>
      <label>
        收集名称
        <input
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="roster-choice-row">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        结束后继续收集下一周
      </label>
      <fieldset disabled={!enabled || busy}>
        <legend>循环截止时间</legend>
        <p className="react-muted">时间均为值班前一周，北京时间。</p>
        {[['deadline', '截止']].map(([prefix, label]) => (
          <div className="roster-time-fields" key={prefix}>
            <label>
              {label}星期
              <select
                value={recurrence[`${prefix}Weekday`]}
                onChange={(event) =>
                  setRecurrence({ ...recurrence, [`${prefix}Weekday`]: Number(event.target.value) })
                }
              >
                {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <option value={i} key={i}>
                    周{['一', '二', '三', '四', '五', '六', '日'][i - 1]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {label}时间
              <input
                type="time"
                required
                value={recurrence[`${prefix}Time`]}
                onChange={(event) =>
                  setRecurrence({ ...recurrence, [`${prefix}Time`]: event.target.value })
                }
              />
            </label>
          </div>
        ))}
      </fieldset>
      <fieldset>
        <legend>后续周次设置</legend>
        <label className="roster-choice-row">
          <input
            type="checkbox"
            checked={useCurrent}
            onChange={(event) => setUseCurrent(event.target.checked)}
          />
          将当前周的参与名单、班次时间和每日人数用于后续周次
        </label>
        <p className="react-muted">
          只影响尚未开始的周次，已有填报、人工安排和已发布班表保持原样。
        </p>
      </fieldset>
      {error && (
        <p data-motion-value="text" className="react-error" role="alert">
          {error}
        </p>
      )}
      <div className="roster-modal-actions">
        <button className="field-primary" disabled={busy}>
          {busy ? '正在保存…' : '保存收集设置'}
        </button>
      </div>
    </form>
  );
}
