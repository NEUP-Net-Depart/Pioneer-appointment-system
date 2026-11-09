import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useContext, useState } from 'react';
import { ActivityContext, Modal, Notice } from './field/ui';
import { request } from './request.js';

export function Departments() {
  const active = useContext(ActivityContext);
  const client = useQueryClient();
  const result = useQuery({
    queryKey: ['/api/organization/departments', { includeDisabled: '1' }],
    enabled: active
  });
  const items = result.data?.items || [];
  const canManage = result.data?.actions?.manage === true;
  const loading = result.isPending;
  const [selected, setSelected] = useState(null),
    [name, setName] = useState(''),
    [enabled, setEnabled] = useState(true);
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: ({ path, method, body }) => request(path, { method, body }),
    onSuccess: async () => {
      await client.cancelQueries({ queryKey: ['/api/organization/departments'] });
      await client.invalidateQueries({ queryKey: ['/api/organization/departments'] });
    }
  });
  const busy = mutation.isPending;
  function edit(item) {
    setSelected(item);
    setName(item.name || '');
    setEnabled(item.enabled ?? true);
    setError('');
  }
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setError('');
    try {
      await mutation.mutateAsync({
        path: `/api/organization/departments${selected.id ? `/${encodeURIComponent(selected.id)}` : ''}`,
        method: selected.id ? 'PATCH' : 'POST',
        body: {
          name,
          enabled,
          ...(selected.id ? { revision: selected.revision } : {}),
          requestId: crypto.randomUUID()
        }
      });
      setSelected(null);
    } catch (failure) {
      setError(failure.message);
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
        <button
          disabled={loading}
          onClick={() => client.invalidateQueries({ queryKey: ['/api/organization/departments'] })}
        >
          刷新部门
        </button>
      </div>
      {!selected && <Notice>{error || result.error?.message}</Notice>}
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
            <Notice>{error || result.error?.message}</Notice>
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
