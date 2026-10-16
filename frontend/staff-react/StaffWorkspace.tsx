import React, { useEffect, useState, type ReactNode } from 'react';
import { Modal } from './field/ui';
import './field/field.css';

type Entry = { id: string; label: string; group?: string };
export function StaffWorkspace({ children, name, entries, active, onSelect }: {
  children: ReactNode; name: string; entries: Entry[]; active: string; onSelect: (id: string) => void;
}) {
  const [more, setMore] = useState(false);
  const activeGroup = entries.find(entry => entry.id === active)?.group || '其他';
  const [expanded, setExpanded] = useState<string[]>(() => [...new Set(entries.map(entry => entry.group || '其他'))]);
  useEffect(() => { setExpanded(current => current.includes(activeGroup) ? current : [...current, activeGroup]); }, [activeGroup]);
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    document.body.classList.add('field-mode');
    return () => document.body.classList.remove('field-mode');
  }, []);
  function choose(id: string) {
    setMore(false);
    if (id === active) return;
    const event = new CustomEvent('staff-before-navigation', { cancelable: true });
    if (!window.dispatchEvent(event)) { setPending(id); return; }
    onSelect(id);
  }
  const groups = ['今日工作', '我的', '值班管理', '平台管理', '业务管理', '数据与审计', '其他'].map(label => ({ label, items: entries.filter(entry => (entry.group || '其他') === label) })).filter(group => group.items.length);
  const primary = entries.filter(entry => entry.id.startsWith('scene:') && entry.id !== 'scene:mine').slice(0, 2);
  const mine = entries.find(entry => entry.id === 'scene:mine');
  if (mine) primary.push(mine);
  if (!primary.length) primary.push(...entries.slice(0, 3));
  const overflow = entries.filter(entry => !primary.some(item => item.id === entry.id));
  return <div className="field-app">
    <aside className="field-sidebar">
      <a className="field-brand" href="/staff/"><img src="/assets/organization-logo.jpg" alt="" /><span>先锋<span>工作人员平台</span></span></a>
      <nav aria-label="岗位工作导航">{groups.map(group => <section className="workspace-nav-group" key={group.label}><h2><button className="workspace-group-toggle" type="button" aria-expanded={expanded.includes(group.label)} onClick={() => setExpanded(current => current.includes(group.label) ? current.filter(item => item !== group.label) : [...current, group.label])}>{group.label}<span aria-hidden="true">{expanded.includes(group.label) ? '−' : '+'}</span></button></h2><div hidden={!expanded.includes(group.label)}>{group.items.map(entry => <button key={entry.id} type="button" className={active === entry.id ? 'active' : ''} aria-current={active === entry.id ? 'page' : undefined} onClick={() => choose(entry.id)}><span className="field-nav-dot" />{entry.label}</button>)}</div></section>)}</nav>
      <div className="field-sidebar-bottom"><span className="field-avatar">{name.slice(-2)}</span><div><strong>{name}</strong><button type="button" onClick={() => document.getElementById('logout-btn')?.click()}>退出登录</button></div></div>
    </aside>
    {children}
    <nav className="field-bottom-nav" aria-label="手机岗位导航">{primary.map(entry => <button key={entry.id} type="button" className={active === entry.id ? 'active' : ''} aria-current={active === entry.id ? 'page' : undefined} onClick={() => choose(entry.id)}>{entry.id === 'scene:mine' ? '我的' : entry.label === '工作台' ? '工作台' : entry.label.replace('工作台', '').replace('现场管理', '现场')}</button>)}{overflow.length > 0 && <button type="button" className={overflow.some(entry => entry.id === active) ? 'active' : ''} onClick={() => setMore(true)}>更多</button>}</nav>
    {pending && <Modal title="有未保存的调整" onClose={() => setPending(null)}><p>你可以先保存；也可以保留当前草稿，稍后返回继续编辑。</p><div className="field-actions"><button type="button" onClick={() => setPending(null)}>留在当前页面</button><button type="button" onClick={() => { const id = pending; setPending(null); onSelect(id); }}>保留草稿并切换</button></div></Modal>}
    {more && <Modal title="工作入口" onClose={() => setMore(false)}><nav className="workspace-more">{groups.map(group => <section className="workspace-nav-group" key={group.label}><h2>{group.label}</h2>{group.items.map(entry => <button key={entry.id} type="button" aria-current={active === entry.id ? 'page' : undefined} onClick={() => choose(entry.id)}>{entry.label}</button>)}</section>)}</nav></Modal>}
  </div>;
}
