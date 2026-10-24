import React from 'react';

/** Only used while the lazy page module (not its API data) is unavailable. */
export function WorkspaceSkeleton({ label = '正在加载页面组件' }: { label?: string }) {
  return (
    <div className="workspace-skeleton" role="status" aria-label={label} aria-busy="true">
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </div>
  );
}
