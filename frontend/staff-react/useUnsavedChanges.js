import { createContext, useContext, useEffect, useRef } from 'react';

export const UnsavedPageContext = createContext(null);

// Internal navigation may retain dirty editors. Logout collects their
// save/discard operations, including editors on hidden routes.
export function useUnsavedChanges({ dirty, active = true, busy = false, save, discard }) {
  const pageActive = useContext(UnsavedPageContext);
  const current = useRef(null),
    form = useRef(null);
  current.current = { dirty, active: (pageActive ?? true) && active, busy, save, discard };
  useEffect(() => {
    const guard = (event) => {
      if ((!current.current.active && !event.detail?.includeHidden) || !current.current.dirty)
        return;
      event.preventDefault();
      event.detail?.editors.push({
        async save() {
          if (current.current.busy) throw new Error('当前操作正在提交，请稍后再试。');
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
    const unload = (event) => {
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
  const editors = [];
  window.dispatchEvent(
    new CustomEvent('staff-before-navigation', {
      cancelable: true,
      detail: { editors, includeHidden }
    })
  );
  return editors;
}
