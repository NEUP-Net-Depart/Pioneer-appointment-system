import React from 'react';

/** Reserve local content geometry without replacing the page or announcing fake data. */
export function WorkspaceSkeleton({
  variant = 'details',
  label = '正在加载内容',
  rows = 3
}: {
  variant?: 'details' | 'form' | 'rows';
  label?: string;
  rows?: number;
}) {
  return (
    <div
      className={`workspace-content-skeleton workspace-content-skeleton--${variant}`}
      role="status"
      aria-label={label}
      aria-busy="true"
      data-motion-region
    >
      <div aria-hidden="true" className="workspace-content-skeleton__layout">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="workspace-content-skeleton__item">
            <span className="workspace-content-skeleton__label" />
            <span className="workspace-content-skeleton__value" />
          </div>
        ))}
      </div>
    </div>
  );
}
