import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal } from './field/ui';
import {WorkspaceLauncher} from './WorkspaceLauncher';
import { pendingEditors } from './useUnsavedChanges.js';
import './field/field.css';

type Entry = { id: string; label: string; group?: string };
export function StaffWorkspace({ children, name, entries, active, onSelect }: {
  children: ReactNode; name: string; entries: Entry[]; active: string; onSelect: (id: string) => void;
}) {
  const [more, setMore] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const activeGroup = entries.find(entry => entry.id === active)?.group || '其他';
  const [expanded, setExpanded] = useState<string[]>(() => [...new Set(entries.map(entry => entry.group || '其他'))]);
  useEffect(() => { setExpanded(current => current.includes(activeGroup) ? current : [...current, activeGroup]); }, [activeGroup]);
  useEffect(() => {
    const nav = sidebar.current?.querySelector('nav');
    const entry = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !entry) return;
    const bounds = nav.getBoundingClientRect(), item = entry.getBoundingClientRect();
    if (item.top < bounds.top) nav.scrollTop -= bounds.top - item.top + 8;
    else if (item.bottom > bounds.bottom) nav.scrollTop += item.bottom - bounds.bottom + 8;
  }, [active, expanded]);
  const [pending, setPending] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false), [navigationError, setNavigationError] = useState('');
  const navigationLock = useRef(false);
  useEffect(() => {
    document.body.classList.add('field-mode');
    return () => document.body.classList.remove('field-mode');
  }, []);
  function choose(id: string) {
    if (navigationLock.current || pending) return;
    setMore(false);
    if (id === active) return;
    if (pendingEditors().length) { setNavigationError(''); setPending(id); return; }
    onSelect(id);
  }
  useEffect(() => {
    const navigate = (event: Event) => choose((event as CustomEvent<string>).detail);
    window.addEventListener('staff-request-navigation', navigate);
    return () => window.removeEventListener('staff-request-navigation', navigate);
  });
  async function resolveNavigation(action: 'save' | 'discard') {
    if (navigationLock.current || !pending) return;
    navigationLock.current = true; setResolving(true); setNavigationError('');
    try {
      for (const editor of pendingEditors()) {
        if (action === 'save') {
          if (await editor.save() !== true) throw new Error('修改尚未保存成功，请取消切换后检查页面提示，或重试保存。');
        } else editor.discard();
        // Let saved revisions and dirty flags reach nested editors before the
        // next operation (e.g. member profile followed by role bindings).
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (pendingEditors().length) throw new Error('仍有未保存的修改，请取消切换后检查。');
      const id = pending; setPending(null); onSelect(id);
    } catch (error) { setNavigationError(error instanceof Error ? error.message : '操作失败，请重试。'); }
    finally { navigationLock.current = false; setResolving(false); }
  }
  const groups = ['今日工作', '我的', '值班管理', '平台管理', '业务管理', '数据与审计', '其他'].map(label => ({ label, items: entries.filter(entry => (entry.group || '其他') === label) })).filter(group => group.items.length);
  const primary = entries.filter(entry => entry.id.startsWith('scene:') && entry.id !== 'scene:mine').slice(0, 2);
  const mine = entries.find(entry => entry.id === 'scene:mine');
  if (mine) primary.push(mine);
  if (!primary.length) primary.push(...entries.slice(0, 3));
  const overflow = entries.filter(entry => !primary.some(item => item.id === entry.id));
  return <div className="field-app">
    <aside className="field-sidebar" ref={sidebar}>
      <a className="field-brand" href="/staff/"><img src="/assets/organization-logo.jpg" alt="" /><span>先锋<span>工作人员平台</span></span></a>
      <nav aria-label="岗位工作导航">{groups.map(group => <section className="workspace-nav-group" key={group.label}><h2><button className="workspace-group-toggle" type="button" aria-expanded={expanded.includes(group.label)} onClick={() => setExpanded(current => current.includes(group.label) ? current.filter(item => item !== group.label) : [...current, group.label])}>{group.label}<span aria-hidden="true">{expanded.includes(group.label) ? '−' : '+'}</span></button></h2><div hidden={!expanded.includes(group.label)}>{group.items.map(entry => <button key={entry.id} type="button" className={active === entry.id ? 'active' : ''} aria-current={active === entry.id ? 'page' : undefined} onClick={() => choose(entry.id)}><span className="field-nav-dot" />{entry.label}</button>)}</div></section>)}</nav>
      <div className="field-sidebar-bottom"><span className="field-avatar">{name.slice(-2)}</span><div><strong>{name}</strong><button type="button" onClick={() => document.getElementById('logout-btn')?.click()}>退出登录</button></div></div>
    </aside>
    {children}
    <nav className="field-bottom-nav" aria-label="手机岗位导航">{primary.map(entry => <button key={entry.id} type="button" className={active === entry.id ? 'active' : ''} aria-current={active === entry.id ? 'page' : undefined} onClick={() => choose(entry.id)}>{entry.id === 'scene:mine' ? '我的' : entry.label === '工作台' ? '工作台' : entry.label.replace('工作台', '').replace('现场管理', '现场')}</button>)}{overflow.length > 0 && <button type="button" className={overflow.some(entry => entry.id === active) ? 'active' : ''} onClick={() => setMore(true)}>更多</button>}</nav>
    {pending && <Modal title="有未保存的调整" compact dismissible={!resolving} onClose={() => setPending(null)}><p>保存成功后切换页面，或丢弃本次未保存的改动。</p>{navigationError && <p className="react-error" role="alert">{navigationError}</p>}<div className="field-actions"><button type="button" disabled={resolving} onClick={() => setPending(null)}>取消切换</button><button type="button" disabled={resolving} onClick={() => resolveNavigation('discard')}>丢弃并切换</button><button type="button" className="field-primary" disabled={resolving} onClick={() => resolveNavigation('save')}>{resolving ? '正在处理…' : '保存并切换'}</button></div></Modal>}
    {more && <Modal title="工作入口" onClose={() => setMore(false)}><WorkspaceLauncher groups={groups} active={active} onSelect={choose}/></Modal>}
  </div>;
}
