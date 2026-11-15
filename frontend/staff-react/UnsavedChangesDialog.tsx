import type { ReactNode } from 'react';
import { Modal, Notice } from './field/ui';

export function UnsavedChangesDialog({
  busy,
  error,
  message = '请保存或丢弃修改后继续。',
  onCancel,
  onDiscard,
  onSave
}: {
  busy: boolean;
  error?: string;
  message?: ReactNode;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <Modal
      title="有未保存的调整"
      compact
      closeLabel="取消操作"
      dismissible={!busy}
      onClose={onCancel}
    >
      <p>{message}</p>
      <Notice>{error}</Notice>
      <div className="workspace-unsaved-actions">
        <button
          data-track="staff.unsavedchanges.discard"
          type="button"
          className="workspace-discard"
          disabled={busy}
          onClick={onDiscard}
        >
          丢弃并继续
        </button>
        <button
          data-track="staff.unsavedchanges.save"
          type="button"
          className="field-primary"
          disabled={busy}
          onClick={onSave}
        >
          {busy ? '正在处理…' : '保存并继续'}
        </button>
      </div>
    </Modal>
  );
}
