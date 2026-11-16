import { controlPart } from '../../shared/telemetry-controls.js';
import { track } from '../../shared/telemetry-client.js';
import React from 'react';
import { addDays, dateKey, calendarWeekRange, rosterWeekKey } from '../../shared/time.js';
import { DatePicker } from './SelectionControls.jsx';

export function WeekPicker({
  value,
  onChange,
  disabled = false,
  label = '工作周',
  min = '',
  'data-track': trackId
}) {
  const current = calendarWeekRange(value || dateKey()).start;
  const minimum = min ? calendarWeekRange(min).start : '';
  return (
    <div className="week-picker">
      <span>{label}</span>
      <div>
        <button
          data-track={controlPart(trackId, 'previous')}
          type="button"
          disabled={disabled || (!!minimum && addDays(current, -7) < minimum)}
          aria-label="上一周"
          onClick={() => {
            track('ui.change', { control: trackId });
            onChange(rosterWeekKey(addDays(current, -7)));
          }}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <DatePicker
          data-track={controlPart(trackId, 'date')}
          mode="week"
          aria-label={label}
          value={current}
          min={minimum}
          disabled={disabled}
          required
          onChange={(event) => event.target.value && onChange(rosterWeekKey(event.target.value))}
        />
        <button
          data-track={controlPart(trackId, 'next')}
          type="button"
          disabled={disabled}
          aria-label="下一周"
          onClick={() => {
            track('ui.change', { control: trackId });
            onChange(rosterWeekKey(addDays(current, 7)));
          }}
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>
    </div>
  );
}
