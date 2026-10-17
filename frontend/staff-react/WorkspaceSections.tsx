import React from 'react';

// Secondary navigation uses ordinary buttons with a pressed state. Every
// section stays in the current workspace; no incomplete ARIA tab keyboard model.
export function WorkspaceSections({ label, items, value, onChange }: {
  label: string; items: { id: string; label: string; count?: number }[];
  value: string; onChange: (id: string) => void;
}) {
  return <nav className="workspace-section-nav" aria-label={label} style={{ '--workspace-section-count': items.length, '--workspace-section-columns': items.length===4?2:Math.min(items.length,3), '--workspace-section-narrow': Math.min(items.length,2) } as React.CSSProperties}>
    {items.map(item => <button key={item.id} type="button" aria-pressed={value === item.id} onClick={() => onChange(item.id)}>{item.label}{item.count !== undefined && <span className="workspace-section-count">{item.count}</span>}</button>)}
  </nav>;
}
