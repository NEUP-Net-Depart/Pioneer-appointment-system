import React, { useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// The application owns one host for the whole signed-in session. Individual
// routes replace content, never the navigation or its scroll/focus state.
export function WorkspacePortal({ children }: { children: ReactNode }) {
  const [host] = useState(() => document.createElement('div'));
  useLayoutEffect(() => {
    host.dataset.workspaceHost = 'true';
    document.getElementById('app-shell')!.append(host);
    return () => host.remove();
  }, [host]);
  return createPortal(children, host);
}
