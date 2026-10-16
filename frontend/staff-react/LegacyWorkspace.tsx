import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { StaffWorkspace } from './StaffWorkspace';

// Keep existing controllers and DOM state alive while placing operational pages
// inside the same workspace as React modules. Navigation remains owned by main.js.
export function LegacyWorkspace({ page, name, entries, onSelect }: {
  page: string; name: string; entries: { id: string; label: string }[]; onSelect: (id: string) => void;
}) {
  const [host] = useState(() => document.createElement('div'));
  const content = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    host.dataset.workspaceHost = 'true';
    document.getElementById('app-shell')!.append(host);
    return () => host.remove();
  }, [host]);
  useLayoutEffect(() => {
    const node = document.querySelector<HTMLElement>(`[data-view="${page}"]`);
    if (!node || !content.current) return;
    const anchor = document.createComment('operational-view-home');
    node.before(anchor);
    content.current.append(node);
    return () => { anchor.replaceWith(node); };
  }, [page]);
  return createPortal(<StaffWorkspace name={name} entries={entries} active={page} onSelect={onSelect}>
    <main className="field-main workspace-operational" ref={content} />
  </StaffWorkspace>, host);
}
