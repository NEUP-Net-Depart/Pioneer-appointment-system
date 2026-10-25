import React, { type ReactNode } from 'react';

// A disclosure keeps its children mounted and makes closed controls inert.
// CSS owns the small local size transition; no per-frame React state updates.
export function MotionCollapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className="motion-collapse" data-open={open} aria-hidden={!open} inert={!open}>
      <div>{children}</div>
    </div>
  );
}
