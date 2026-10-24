import React, { type ReactNode } from 'react';

/** Static labels stay visible; only a server-owned value waits for its response. */
export function DataValue({
  children,
  label,
  pending = true
}: {
  children?: ReactNode;
  label: string;
  pending?: boolean;
}) {
  const missing = children === undefined || children === null || children === '';
  return (
    <span
      className={`workspace-data-value${missing ? ' workspace-data-pending' : ''}`}
      data-motion-value={typeof children === 'number' ? 'number' : 'text'}
      aria-label={missing ? `${label}${pending ? '正在读取' : '尚未取得'}` : undefined}
      aria-busy={missing && pending}
    >
      {missing ? '—' : children}
    </span>
  );
}

export function DataFields({
  fields,
  pending = true
}: {
  fields: readonly (readonly [string, ReactNode?])[];
  pending?: boolean;
}) {
  return (
    <dl className="workspace-data-fields">
      {fields.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>
            <DataValue label={label} pending={pending}>
              {value}
            </DataValue>
          </dd>
        </div>
      ))}
    </dl>
  );
}
