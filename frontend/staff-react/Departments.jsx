import React, { useContext, useEffect, useRef, useState } from 'react';
import { ActivityContext, Modal, Notice } from './field/ui';
import { request } from './request.js';

export function Departments() {
  const active = useContext(ActivityContext);
  const [items, setItems] = useState([]),
    [canManage, setCanManage] = useState(false),
    [selected, setSelected] = useState(null),
    [name, setName] = useState(''),
    [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    request('/api/organization/departments?includeDisabled=1', { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setItems(data.items || []);
          setCanManage(data.actions?.manage === true);
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [active, revision]);
  function edit(item) {
    setSelected(item);
    setName(item.name || '');
    setEnabled(item.enabled ?? true);
    setError('');
  }
  async function save(event) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await request(
        `/api/organization/departments${selected.id ? `/${encodeURIComponent(selected.id)}` : ''}`,
        {
          method: selected.id ? 'PATCH' : 'POST',
          body: {
            name,
            enabled,
            ...(selected.id ? { revision: selected.revision } : {}),
            requestId: crypto.randomUUID()
          }
        }
      );
      setSelected(null);
      setRevision((value) => value + 1);
    } catch (failure) {
      setError(failure.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="departments-workspace">
      <div className="workspace-list-tools">
        {canManage && (
          <button className="react-primary" onClick={() => edit({})}>
            新增部门
          </button>
        )}
        <button disabled={loading} onClick={() => setRevision((value) => value + 1)}>
          刷新部门
        </button>
      </div>
      {!selected && <Notice>{error}</Notice>}
      <div className="account-list" aria-busy={loading}>
        {items.map((item) => (
          <article className="field-card department-row" key={item.id}>
            <strong>{item.name}</strong>
            <span>{item.enabled ? '启用' : '停用'}</span>
            {canManage && <button onClick={() => edit(item)}>编辑部门</button>}
          </article>
        ))}
      </div>
      {!loading && !items.length && <p>暂无部门</p>}
      {selected && (
        <Modal
          title={selected.id ? '编辑部门' : '新增部门'}
          compact
          dismissible={!busy}
          onClose={() => setSelected(null)}
        >
          <form className="workspace-form" onSubmit={save}>
            <fieldset className="workspace-form-fields" disabled={busy}>
              <label>
                部门名称
                <input
                  required
                  maxLength={80}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label>
                部门状态
                <select
                  value={enabled ? 'enabled' : 'disabled'}
                  onChange={(event) => setEnabled(event.target.value === 'enabled')}
                >
                  <option value="enabled">启用</option>
                  <option value="disabled">停用</option>
                </select>
              </label>
              {!enabled && <p>停用后保留已有任职及历史记录，不再接受新增任职。</p>}
            </fieldset>
            <Notice>{error}</Notice>
            <div className="field-actions">
              <button type="button" disabled={busy} onClick={() => setSelected(null)}>
                取消
              </button>
              <button className="react-primary" disabled={busy}>
                {busy ? '正在保存…' : '保存部门'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
