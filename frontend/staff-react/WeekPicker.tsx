import { controlPart } from '../../shared/telemetry-controls.ts';
import { track } from '../../shared/telemetry-client.ts';
import { addDays, dateKey, weekRange } from '../../shared/time.ts';
import { DatePicker } from './SelectionControls.tsx';

export function WeekPicker({
  value,
  onChange,
  disabled = false,
  label = '工作周',
  min = '',
  'data-track': trackId
}: {
  value?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  min?: string;
  'data-track'?: string;
}) {
  const current = weekRange(value || dateKey()).start;
  const minimum = min ? weekRange(min).start : '';
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
            onChange(addDays(current, -7));
          }}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <DatePicker
          data-track={controlPart(trackId, 'date')}
          mode="week"
          weekStartsOn={1}
          aria-label={label}
          value={current}
          min={minimum}
          disabled={disabled}
          required
          onChange={(event) => event.target.value && onChange(event.target.value)}
        />
        <button
          data-track={controlPart(trackId, 'next')}
          type="button"
          disabled={disabled}
          aria-label="下一周"
          onClick={() => {
            track('ui.change', { control: trackId });
            onChange(addDays(current, 7));
          }}
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>
    </div>
  );
}
