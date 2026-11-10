import React, { type CSSProperties, type ReactNode } from 'react';
import { AnimatedValue } from './AnimatedValue';

/** Static labels stay visible; only a server-owned value waits for its response. */
export function DataValue({
  children,
  label,
  pending = true,
  preset = 'inline',
  digits = 2
}: {
  children?: ReactNode;
  label: string;
  pending?: boolean;
  preset?: 'inline' | 'badge' | 'metric';
  digits?: number;
}) {
  const missing = children === undefined || children === null || children === '';
  const numeric =
    typeof children === 'number' ||
    (typeof children === 'string' && /^-?\d+(\.\d+)?%?$/.test(children));
  return (
    <span
      className={`workspace-data-value${missing || numeric ? ' data-value-frame' : ''}${missing ? ' workspace-data-pending' : ''}`}
      data-preset={preset}
      style={{ '--value-digits': `${digits}ch` } as CSSProperties}
      data-motion-value={numeric ? 'number' : 'text'}
      aria-label={missing ? `${label}${pending ? '正在读取' : '尚未取得'}` : undefined}
      aria-busy={missing && pending}
    >
      {missing ? (
        <span className="data-value-loading" aria-hidden="true" />
      ) : numeric ? (
        <AnimatedValue value={children as string | number} />
      ) : (
        <span className="data-value-text">{children}</span>
      )}
    </span>
  );
}

export function CountBadge({ value, label }: { value?: number; label: string }) {
  return (
    <span className="data-count-badge">
      <DataValue label={label} preset="badge" digits={3}>
        {value}
      </DataValue>
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
