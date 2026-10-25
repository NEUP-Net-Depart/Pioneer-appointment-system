import React, { useRef, type ReactNode } from 'react';
import { useDataMotion } from './useDataMotion';

// Route geometry belongs to the shell. Modules only lay out their contents.
export function WorkspacePage({
  route,
  active,
  children
}: {
  route: string;
  active: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useDataMotion(ref, active, true);
  return (
    <main
      ref={ref}
      className="workspace-route workspace-page"
      data-route={route}
      hidden={!active}
      aria-hidden={!active}
    >
      {children}
    </main>
  );
}
