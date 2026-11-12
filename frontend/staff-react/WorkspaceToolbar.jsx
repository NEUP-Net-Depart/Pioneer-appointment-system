import React, { useRef, useState } from 'react';
import './workspace-controls.css';

export function WorkspaceToolbar({ title, children, className = '' }) {
  return (
    <div className={`workspace-panel-toolbar ${className}`}>
      {title && <h2>{title}</h2>}
      <div className="workspace-panel-actions">{children}</div>
    </div>
  );
}

export function RefreshButton({
  onRefresh,
  disabled = false,
  label = '刷新数据',
  compactOnMobile = false,
  ...buttonProps
}) {
  const lock = useRef(false);
  const [state, setState] = useState('idle');
  const [updatedAt, setUpdatedAt] = useState('');
  async function refresh() {
    if (lock.current || disabled) return;
    lock.current = true;
    setState('pending');
    try {
      const result = await onRefresh();
      const failure = (Array.isArray(result) ? result : [result]).find((item) => item?.error);
      if (failure) throw failure.error;
      setUpdatedAt(
        new Intl.DateTimeFormat('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        }).format(new Date())
      );
      setState('success');
    } catch {
      setState('error');
    } finally {
      lock.current = false;
    }
  }
  return (
    <div className={`workspace-refresh-control${compactOnMobile ? ' mobile-refresh-compact' : ''}`}>
      <button
        {...buttonProps}
        type="button"
        disabled={disabled || state === 'pending'}
        aria-busy={state === 'pending'}
        aria-label={label}
        title={label}
        onClick={refresh}
      >
        <span
          className="workspace-refresh-icon"
          data-pending={state === 'pending'}
          aria-hidden="true"
        >
          ↻
        </span>
        <span className="workspace-refresh-label">{state === 'pending' ? '正在刷新…' : label}</span>
      </button>
      <span className="workspace-refresh-state" role="status">
        {state === 'pending'
          ? '正在读取最新数据'
          : state === 'success'
            ? `已更新 ${updatedAt}`
            : state === 'error'
              ? '更新失败，请重试'
              : ''}
      </span>
    </div>
  );
}
