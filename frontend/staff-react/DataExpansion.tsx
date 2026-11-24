import type { ReactNode } from 'react';

export function DataExpansion({ ready, children }: { ready: boolean; children?: ReactNode }) {
  return (
    <div className="data-expansion" data-ready={ready ? 'true' : 'false'} aria-busy={!ready}>
      <div className="data-expansion-content">{children}</div>
    </div>
  );
}
