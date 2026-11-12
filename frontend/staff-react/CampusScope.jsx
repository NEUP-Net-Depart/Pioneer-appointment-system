import React from 'react';
import './workspace-controls.css';

export function CampusScope({ campuses, value, onChange, disabled = false, label = '校区' }) {
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
          type="button"
          key={campus.id}
          disabled={disabled}
          aria-pressed={value === campus.id}
          onClick={() => onChange(campus.id)}
        >
          {campus.name}
        </button>
      ))}
    </div>
  );
}
