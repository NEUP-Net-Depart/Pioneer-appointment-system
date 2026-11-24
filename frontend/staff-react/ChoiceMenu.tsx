import type { ReactNode } from 'react';
import { Select } from './SelectionControls.tsx';

export function ChoiceMenu({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className = '',
  'data-track': trackId
}: {
  label?: string;
  value?: string | number;
  options: readonly { value: string | number; label: ReactNode; disabled?: boolean }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  'data-track'?: string;
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
