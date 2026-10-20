import React, { type ReactNode } from 'react';

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
  return (
    <main
      className="workspace-route workspace-page"
      data-route={route}
      hidden={!active}
      aria-hidden={!active}
    >
      {children}
    </main>
  );
}
