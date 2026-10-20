import React from 'react';
import { addDays, dateKey, weekRange } from '../../shared/time.js';

// A week is selected as a Monday, rather than exposing irrelevant calendar days.
export function WeekPicker({ value, onChange, disabled = false, label = '工作周' }) {
  const current = weekRange(value || dateKey()).start;
  const options = Array.from({ length: 105 }, (_, i) => addDays(current, (i - 52) * 7));
  return (
    <div className="week-picker">
      <span>{label}</span>
      <div>
        <button
          type="button"
          disabled={disabled}
          aria-label="上一周"
          onClick={() => onChange(addDays(current, -7))}
        >
          上一周
        </button>
        <select
          aria-label={label}
          disabled={disabled}
          value={current}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((day) => (
            <option key={day} value={day}>
              {day} 周一 — {addDays(day, 6)}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={disabled}
          aria-label="下一周"
          onClick={() => onChange(addDays(current, 7))}
        >
          下一周
        </button>
      </div>
    </div>
  );
}
