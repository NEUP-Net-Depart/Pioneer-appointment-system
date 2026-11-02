import React, { useId, useState } from 'react';
import { Empty } from './field/ui';
import { WorkspaceIcon } from './WorkspaceIcon';
import { matchesWorkspaceEntry } from './workspace-navigation.js';

type Group = {
  label: string;
  items: { id: string; label: string; icon?: string; keywords?: string }[];
};
export function WorkspaceLauncher({
  groups,
  active,
  onSelect,
  onPrepare
}: {
  groups: Group[];
  active: string;
  onSelect: (id: string) => void;
  onPrepare?: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const id = useId(),
    search = query.trim();
  const filtered = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((entry) => matchesWorkspaceEntry(entry, group.label, search))
    }))
    .filter((group) => group.items.length);
  return (
    <div className="workspace-launcher">
      <div className="workspace-launcher-search">
        <label>
          查找功能
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing && filtered.length) {
                event.preventDefault();
                onSelect(filtered[0].items[0].id);
              }
            }}
            placeholder="搜索功能或操作"
          />
        </label>
      </div>
      <nav className="workspace-launcher-groups" aria-label="全部工作入口">
        {filtered.map((group, index) => (
          <section
            className="workspace-launcher-group"
            key={group.label}
            aria-labelledby={`${id}-${index}`}
          >
            <header>
              <h3 data-motion-value="text" id={`${id}-${index}`}>
                {group.label}
              </h3>
              <span data-motion-value="number">{group.items.length} 项</span>
            </header>
            <div>
              {group.items.map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  aria-current={active === entry.id ? 'page' : undefined}
                  onPointerEnter={() => onPrepare?.(entry.id)}
                  onFocus={() => onPrepare?.(entry.id)}
                  onTouchStart={() => onPrepare?.(entry.id)}
                  onClick={() => onSelect(entry.id)}
                >
                  <WorkspaceIcon name={entry.icon} />
                  {entry.label}
                </button>
              ))}
            </div>
          </section>
        ))}
      </nav>
      {!filtered.length && (
        <Empty title="没有匹配的功能">
          <button type="button" onClick={() => setQuery('')}>
            清空搜索
          </button>
        </Empty>
      )}
    </div>
  );
}
