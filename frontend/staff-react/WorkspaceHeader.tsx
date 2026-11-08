import React, { type ReactNode } from 'react';

export function WorkspaceHeader({
  group,
  title,
  description,
  children
}: {
  group?: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <header className="workspace-heading field-top">
      <div className="workspace-heading-copy">
        <p data-motion-value="text" className="field-kicker">
          {group || '工作人员平台'}
        </p>
        <h1>{title}</h1>
        {description && (
          <p data-motion-value="text" className="workspace-heading-description field-muted">
            {description}
          </p>
        )}
      </div>
      {children && <div className="workspace-heading-actions">{children}</div>}
    </header>
  );
}
