import React from 'react';
import { Select } from './SelectionControls.jsx';

export function ChoiceMenu({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className = '',
  'data-track': trackId
}) {
  return (
    <label className={`workspace-choice ${className}`}>
      {label && <span className="report-control-label">{label}</span>}
      <Select
        data-track={trackId}
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </Select>
    </label>
  );
}
