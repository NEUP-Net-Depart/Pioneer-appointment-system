import React, { useLayoutEffect, useRef } from 'react';

// Keep existing controllers and DOM state alive while placing operational pages
// inside the same workspace as React modules. Navigation remains owned by main.js.
export function LegacyWorkspace({ page }: { page: string }) {
  const content = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const node = document.querySelector<HTMLElement>(`[data-view="${page}"]`);
    if (!node || !content.current) return;
    const anchor = document.createComment('operational-view-home');
    node.before(anchor);
    content.current.append(node);
    return () => { anchor.replaceWith(node); };
  }, [page]);
  return <main className="field-main workspace-operational" ref={content} />;
}
