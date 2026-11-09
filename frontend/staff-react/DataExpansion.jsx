import React from 'react';

export function DataExpansion({ ready, children }) {
  return (
    <div className="data-expansion" data-ready={ready ? 'true' : 'false'} aria-busy={!ready}>
      <div className="data-expansion-content">{children}</div>
    </div>
  );
}
