import React from 'react';
import { rosterCollections } from '../../shared/roster-collections.js';
import { addDays } from '../../shared/time.js';

export function CollectionScope({ tasks, taskId, onChange, disabled = false, management = false }) {
  const groups = rosterCollections(tasks),
    task = tasks.find((item) => item.id === taskId);
  const group = groups.find((item) => item.id === (task?.seriesId || taskId));
  return (
    <div className="collection-scope">
      <label>
        收集任务
        <select
          aria-label="收集任务"
          disabled={disabled}
          value={group?.id || ''}
          onChange={(event) =>
            onChange(groups.find((item) => item.id === event.target.value)?.currentPeriodId || '')
          }
        >
          <option value="">选择收集任务</option>
          {groups.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      {management || (group?.periods.filter((item) => item.actions?.fill).length || 0) > 1 ? (
        <label>
          工作周
          <select
            aria-label="排班周与校区"
            disabled={disabled}
            value={taskId}
            onChange={(event) => onChange(event.target.value)}
          >
            <option value="">选择工作周</option>
            {(group?.periods || [])
              .filter((item) => management || item.actions?.fill)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.weekStart} — {addDays(item.weekStart, 3)} ·{' '}
                  {item.collectionState === 'open'
                    ? '收集中'
                    : item.collectionState === 'scheduled'
                      ? '尚未开放'
                      : '收集已结束'}
                </option>
              ))}
          </select>
        </label>
      ) : (
        task && (
          <p className="collection-period">
            本次填报
            <strong>
              {task.weekStart} — {addDays(task.weekStart, 3)}
            </strong>
          </p>
        )
      )}
    </div>
  );
}
