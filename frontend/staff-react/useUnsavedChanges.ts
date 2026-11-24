interface EditorOptions {
  dirty: boolean;
  active?: boolean;
  busy?: boolean;
  save?: (event: { preventDefault(): void }) => unknown;
  discard: () => void;
  leaveMessage?: string;
  saveLabel?: string;
}

interface PendingEditor {
  canSave: boolean;
  leaveMessage: string;
  saveLabel: string;
  save: () => Promise<unknown>;
  discard: () => void;
}

import { createContext, useContext, useEffect, useRef } from 'react';

export const UnsavedPageContext = createContext<boolean | null>(null);

// Internal navigation may retain dirty editors. Logout and refresh collect their
// save/discard operations, including editors on hidden routes.
export function useUnsavedChanges({
  dirty,
  active = true,
  busy = false,
  save,
  discard,
  leaveMessage = '',
  saveLabel = ''
}: EditorOptions) {
  const pageActive = useContext(UnsavedPageContext);
  const current = useRef({ dirty, active, busy, save, discard, leaveMessage, saveLabel }),
    form = useRef<HTMLFormElement>(null);
  current.current = {
    dirty,
    active: (pageActive ?? true) && active,
    busy,
    save,
    discard,
    leaveMessage,
    saveLabel
  };
  useEffect(() => {
    const guard = (event: Event) => {
      const { detail } = event as CustomEvent<{ editors: PendingEditor[]; includeHidden: boolean }>;
      if ((!current.current.active && !detail?.includeHidden) || !current.current.dirty) return;
      event.preventDefault();
      detail?.editors.push({
        canSave: typeof current.current.save === 'function',
        leaveMessage: current.current.leaveMessage,
        saveLabel: current.current.saveLabel,
        async save() {
          if (current.current.busy) throw new Error('当前操作正在提交，请稍后再试。');
          if (!current.current.save)
            throw new Error(
              current.current.leaveMessage || '请返回页面完成操作，或丢弃修改后继续。'
            );
          if (form.current && !form.current.checkValidity())
            throw new Error('有必填项或格式需要检查，请取消切换后修正。');
          return current.current.save({ preventDefault() {} });
        },
        discard() {
          if (current.current.busy) throw new Error('当前操作正在提交，请稍后再试。');
          current.current.discard();
        }
      });
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (!current.current.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('staff-before-navigation', guard);
    window.addEventListener('beforeunload', unload);
    return () => {
      window.removeEventListener('staff-before-navigation', guard);
      window.removeEventListener('beforeunload', unload);
    };
  }, []);
  return form;
}

export function pendingEditors({ includeHidden = false } = {}) {
  const editors: PendingEditor[] = [];
  window.dispatchEvent(
    new CustomEvent('staff-before-navigation', {
      cancelable: true,
      detail: { editors, includeHidden }
    })
  );
  return editors;
}
