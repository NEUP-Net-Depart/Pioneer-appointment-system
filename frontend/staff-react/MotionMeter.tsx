import React from 'react';

// Native semantics update immediately; the visual fill shares the page's
// animation budget instead of creating one independent effect per row.
export function MotionMeter({
  value,
  max,
  label,
  progress = false
}: {
  value: number;
  max: number;
  label: string;
  progress?: boolean;
}) {
  const limit = Math.max(1, max);
  const ratio = Math.max(0, Math.min(1, value / limit));
  return (
    <span className="motion-meter">
      {progress ? (
        <progress max={limit} value={value} aria-label={label} />
      ) : (
        <meter min={0} max={limit} value={value} aria-label={label} />
      )}
      <span className="motion-meter-track" aria-hidden="true">
        <span
          data-motion-value="bar"
          data-motion-ratio={ratio}
          style={{ transform: `scaleX(${ratio})` }}
        />
      </span>
    </span>
  );
}
