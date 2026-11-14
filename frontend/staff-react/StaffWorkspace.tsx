import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { Github } from 'lucide-react';
import { Modal } from './field/ui';
import { WorkspaceLauncher } from './WorkspaceLauncher';
import { WorkspaceIcon } from './WorkspaceIcon';
import { groupWorkspaceEntries, mobileWorkspaceEntries } from './workspace-navigation.js';
import { pendingEditors } from './useUnsavedChanges.js';
import './field/field.css';

type Entry = { id: string; label: string; group?: string; icon?: string; keywords?: string };
export function StaffWorkspace({
  children,
  name,
  entries,
  active,
  onSelect,
  onPrepare,
  opening,
  onLogout,
  loading = false
}: {
  children: ReactNode;
  name: string;
  entries: Entry[];
  active: string;
  onSelect: (id: string) => void;
  onPrepare?: (id: string) => void;
  opening?: string;
  onLogout: () => void;
  loading?: boolean;
}) {
  const [more, setMore] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const activeGroup = entries.find((entry) => entry.id === active)?.group || '其他';
  const [expanded, setExpanded] = useState<string[] | null>(null);
  const expandedGroups = expanded ?? [activeGroup];
  // Resolving the initial workbench scene must not close a group being browsed.
  const activePage = active.startsWith('scene:') ? 'workbench' : active;
  useEffect(() => {
    setExpanded(null);
  }, [activePage]);
  useEffect(() => {
    const find = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== 'k' ||
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        document.querySelector('dialog[open]')
      )
        return;
      event.preventDefault();
      setMore(true);
    };
    window.addEventListener('keydown', find);
    return () => window.removeEventListener('keydown', find);
  }, []);
  useEffect(() => {
    const nav = sidebar.current?.querySelector('nav');
    const entry = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !entry || entry.closest('[hidden]')) return;
    const bounds = nav.getBoundingClientRect(),
      item = entry.getBoundingClientRect();
    if (item.top < bounds.top) nav.scrollTop -= bounds.top - item.top + 8;
    else if (item.bottom > bounds.bottom) nav.scrollTop += item.bottom - bounds.bottom + 8;
  }, [active, expanded]);
  const [pending, setPending] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false),
    [navigationError, setNavigationError] = useState('');
  const navigationLock = useRef(false);
  function choose(id: string) {
    if (navigationLock.current || pending) return;
    setMore(false);
    if (id === active) return;
    if (pendingEditors({ includeHidden: id === '__logout__' || id === '__refresh__' }).length) {
      setNavigationError('');
      setPending(id);
      return;
    }
    finishNavigation(id);
  }
  function finishNavigation(id: string) {
    if (id.startsWith('scene:')) setExpanded(null);
    if (id === '__logout__') onLogout();
    else if (id === '__refresh__') window.location.reload();
    else onSelect(id);
  }
  useEffect(() => {
    const navigate = (event: Event) => choose((event as CustomEvent<string>).detail);
    window.addEventListener('staff-request-navigation', navigate);
    return () => window.removeEventListener('staff-request-navigation', navigate);
  });
  async function resolveNavigation(action: 'save' | 'discard') {
    if (navigationLock.current || !pending) return;
    navigationLock.current = true;
    setResolving(true);
    setNavigationError('');
    try {
      for (const editor of pendingEditors({
        includeHidden: pending === '__logout__' || pending === '__refresh__'
      })) {
        if (action === 'save') {
          if ((await editor.save()) !== true)
            throw new Error(
              pending === '__refresh__'
                ? '修改尚未保存成功，请取消刷新后检查页面提示，或重试保存。'
                : '修改尚未保存成功，请取消切换后检查页面提示，或重试保存。'
            );
        } else editor.discard();
        // Let saved revisions and dirty flags reach nested editors before the
        // next operation (e.g. member profile followed by role bindings).
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      // Each editor explicitly acknowledges success. React may not have
      // committed its clean state or unmounted its guard in this task yet.
      const id = pending;
      setPending(null);
      finishNavigation(id);
    } catch (error) {
      setNavigationError(error instanceof Error ? error.message : '操作失败，请重试。');
    } finally {
      navigationLock.current = false;
      setResolving(false);
    }
  }
  const actionText =
    pending === '__logout__' ? '退出' : pending === '__refresh__' ? '刷新' : '切换';
  const groups = groupWorkspaceEntries(entries);
  const primary: Entry[] = mobileWorkspaceEntries(entries);
  const overflow = entries.filter((entry) => !primary.some((item) => item.id === entry.id));
  const projectLink = (
    <a
      data-track="staff.staffworkspace.a.1"
      className="workspace-project-link"
      href="https://github.com/NEUP-Net-Depart/Pioneer-appointment-system"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="star&issue · 在 GitHub 支持项目或反馈问题（新标签页）"
    >
      <Github className="workspace-icon" aria-hidden="true" />
      star&amp;issue
    </a>
  );
  return (
    <div className={`field-app${loading ? ' workspace-bootstrap' : ''}`} aria-busy={loading}>
      <aside className="field-sidebar" ref={sidebar}>
        <a data-track="staff.staffworkspace.a.2" className="field-brand" href="/staff/">
          <img src="/assets/organization-logo.jpg" alt="" />
          <span>
            先锋<span>工作人员平台</span>
          </span>
        </a>
        <button
          data-track="staff.staffworkspace.button.3"
          className="workspace-find"
          type="button"
          aria-keyshortcuts="Control+k Meta+k"
          onClick={() => setMore(true)}
        >
          <WorkspaceIcon name="search" />
          查找功能
        </button>
        <nav aria-label="岗位工作导航">
          {groups.map((group) => (
            <section className="workspace-nav-group" key={group.label}>
              <h2>
                <button
                  data-track="staff.staffworkspace.button.4"
                  className="workspace-group-toggle"
                  type="button"
                  aria-expanded={expandedGroups.includes(group.label)}
                  onClick={() =>
                    setExpanded((current) =>
                      (current ?? [activeGroup]).includes(group.label) ? [] : [group.label]
                    )
                  }
                >
                  {group.label}
                  <span data-motion-value="text" aria-hidden="true">
                    {expandedGroups.includes(group.label) ? '−' : '+'}
                  </span>
                </button>
              </h2>
              <div className="workspace-nav-items" hidden={!expandedGroups.includes(group.label)}>
                {group.items.map((entry) => (
                  <button
                    data-track="staff.staffworkspace.button.5"
                    key={entry.id}
                    type="button"
                    className={active === entry.id ? 'active' : ''}
                    aria-current={active === entry.id ? 'page' : undefined}
                    onPointerEnter={() => onPrepare?.(entry.id)}
                    onFocus={() => onPrepare?.(entry.id)}
                    onTouchStart={() => onPrepare?.(entry.id)}
                    onClick={() => choose(entry.id)}
                  >
                    <WorkspaceIcon name={entry.icon} />
                    {entry.label}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </nav>
        <div className="field-sidebar-bottom">
          <span data-motion-value="text" className="field-avatar">
            {name.slice(-2)}
          </span>
          <div>
            <strong data-motion-value="text">{name}</strong>
            <button
              data-track="staff.staffworkspace.button.6"
              type="button"
              onClick={() => choose('__logout__')}
            >
              退出登录
            </button>
          </div>
        </div>
        {projectLink}
      </aside>
      {children}
      {opening && (
        <div className="workspace-navigation-status" role="status">
          正在打开{opening}…
        </div>
      )}
      <nav className="field-bottom-nav" aria-label="手机岗位导航">
        {primary.map((entry) => (
          <button
            data-track="staff.staffworkspace.button.7"
            key={entry.id}
            type="button"
            className={active === entry.id ? 'active' : ''}
            aria-current={active === entry.id ? 'page' : undefined}
            onPointerEnter={() => onPrepare?.(entry.id)}
            onFocus={() => onPrepare?.(entry.id)}
            onTouchStart={() => onPrepare?.(entry.id)}
            onClick={() => choose(entry.id)}
          >
            <WorkspaceIcon name={entry.icon} />
            {entry.label === '工作台' ? '工作台' : entry.label.replace('工作台', '')}
          </button>
        ))}
        {overflow.length > 0 && (
          <button
            data-track="staff.staffworkspace.button.8"
            type="button"
            className={overflow.some((entry) => entry.id === active) ? 'active' : ''}
            onClick={() => setMore(true)}
          >
            <WorkspaceIcon name="more" />
            更多
          </button>
        )}
      </nav>
      {pending && (
        <Modal
          title="有未保存的调整"
          compact
          dismissible={!resolving}
          onClose={() => setPending(null)}
        >
          <p data-motion-value="text">
            {pending === '__logout__'
              ? '保存成功后退出登录，或丢弃本次未保存的改动。'
              : pending === '__refresh__'
                ? '保存成功后刷新页面，或丢弃本次未保存的改动。'
                : '请保存或丢弃修改后切换。'}
          </p>
          {navigationError && (
            <p data-motion-value="text" className="react-error" role="alert">
              {navigationError}
            </p>
          )}
          <div className="field-actions">
            <button
              data-track="staff.staffworkspace.button.9"
              type="button"
              disabled={resolving}
              onClick={() => setPending(null)}
            >
              {pending === '__logout__' ? '取消退出' : '留在当前页面'}
            </button>
            <button
              data-track="staff.staffworkspace.button.10"
              type="button"
              disabled={resolving}
              onClick={() => resolveNavigation('discard')}
            >
              丢弃并{actionText}
            </button>
            <button
              data-track="staff.staffworkspace.button.11"
              type="button"
              className="field-primary"
              disabled={resolving}
              onClick={() => resolveNavigation('save')}
            >
              {resolving ? '正在处理…' : `保存并${actionText}`}
            </button>
          </div>
        </Modal>
      )}
      {more && (
        <Modal title="工作入口" initialFocus="input[type=search]" onClose={() => setMore(false)}>
          <WorkspaceLauncher
            groups={groups}
            active={active}
            onSelect={choose}
            onPrepare={onPrepare}
          />
          <footer className="workspace-launcher-footer">{projectLink}</footer>
        </Modal>
      )}
    </div>
  );
}
