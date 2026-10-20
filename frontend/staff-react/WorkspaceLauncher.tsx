import React, { useId, useState } from 'react';
import { Empty } from './field/ui';

type Group = { label: string; items: { id: string; label: string }[] };
export function WorkspaceLauncher({
  groups,
  active,
  onSelect
}: {
  groups: Group[];
  active: string;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const id = useId(),
    search = query.trim();
  const filtered = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((entry) => `${group.label} ${entry.label}`.includes(search))
    }))
    .filter((group) => group.items.length);
  const current = groups.flatMap((group) => group.items).find((entry) => entry.id === active);
  return (
    <div className="workspace-launcher">
      <div className="workspace-launcher-search">
        <p>
          当前位置 · <strong>{current?.label || '工作台'}</strong>
        </p>
        <label>
          查找功能
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="输入功能名称，如排班、签到"
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
              <h3 id={`${id}-${index}`}>{group.label}</h3>
              <span>{group.items.length} 项</span>
            </header>
            <div>
              {group.items.map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  aria-current={active === entry.id ? 'page' : undefined}
                  onClick={() => onSelect(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </section>
        ))}
      </nav>
      {!filtered.length && (
        <Empty title="没有匹配的功能">试试其他名称，或清空搜索查看全部入口。</Empty>
      )}
    </div>
  );
}
