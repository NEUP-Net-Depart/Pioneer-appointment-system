import React, { useLayoutEffect, useRef } from 'react';
import { WorkspaceHeader } from './WorkspaceHeader';

// Keep existing controllers and DOM state alive while placing operational pages
// inside the same workspace as React modules. Navigation remains owned by main.js.
export function LegacyWorkspace({ page }: { page: string }) {
  const content = useRef<HTMLElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = document.querySelector<HTMLElement>(`[data-view="${page}"]`);
    if (!node || !content.current) return;
    const anchor = document.createComment('operational-view-home');
    node.before(anchor);
    content.current.append(node);
    const action = document.getElementById(page === 'staff' ? 'export-csv' : 'copy-activation-url');
    const actionAnchor = document.createComment('operational-action-home');
    if (action && actions.current) { action.before(actionAnchor); actions.current.append(action); }
    return () => { if (action) actionAnchor.replaceWith(action); anchor.replaceWith(node); };
  }, [page]);
  return <main className="field-main workspace-operational"><WorkspaceHeader group={page === 'staff' ? '今日工作' : '平台管理'} title={page === 'staff' ? '预约记录' : '账号管理'} description={page === 'staff' ? '查看预约进展，按校区、时段和状态查找记录。' : '管理账号、激活申请与加入资格。'}><div ref={actions} /></WorkspaceHeader><div ref={content} className="workspace-operational-content" /></main>;
}
