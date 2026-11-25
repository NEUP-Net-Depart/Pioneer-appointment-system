import { track } from '../../shared/telemetry-client.ts';
import './workspace-controls.css';

export function CampusScope({
  campuses,
  value,
  onChange,
  disabled = false,
  label = '校区',
  'data-track': trackId
}: {
  campuses: readonly { id: string; name: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  'data-track'?: string;
}) {
  if (campuses.length === 1)
    return (
      <span className="workspace-campus-single" aria-label={label}>
        {campuses[0].name}
      </span>
    );
  return (
    <div className="workspace-campus-scope" role="group" aria-label={label}>
      {campuses.map((campus) => (
        <button
          data-track={trackId}
          type="button"
          key={campus.id}
          disabled={disabled}
          aria-pressed={value === campus.id}
          onClick={() => {
            track('ui.change', { control: trackId });
            onChange(campus.id);
          }}
        >
          {campus.name}
        </button>
      ))}
    </div>
  );
}
