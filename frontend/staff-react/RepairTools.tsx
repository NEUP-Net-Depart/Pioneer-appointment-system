import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { UnsavedChangesDialog } from './UnsavedChangesDialog';
import { useUnsavedChanges } from './useUnsavedChanges';

type Editor = {
  id: string;
  dirty: boolean;
  busy: boolean;
  save?: () => Promise<boolean>;
  leaveMessage?: string;
  discard: () => void;
};
type Destination = { id: string | null; action?: () => void };
const RepairToolsContext = createContext<{
  active: string | null;
  editor: React.MutableRefObject<Editor | null>;
  request: (id: string | null, action?: () => void) => void;
  finish: (id?: string | null) => void;
} | null>(null);

export function RepairToolsProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<string | null>(null);
  const editor = useRef<Editor | null>(null);
  const [pending, setPending] = useState<Destination | null>(null);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  function navigate(destination: Destination) {
    editor.current = null;
    setActive(destination.id);
    setPending(null);
    destination.action?.();
  }
  function request(id: string | null, action?: () => void) {
    if (lock.current || pending || editor.current?.busy) return;
    const destination = { id, action };
    if (editor.current?.dirty) {
      setError('');
      setPending(destination);
    } else {
      editor.current?.discard();
      navigate(destination);
    }
  }
  async function resolve(save: boolean) {
    if (!pending || lock.current) return;
    lock.current = true;
    setResolving(true);
    setError('');
    try {
      if (save) {
        if ((await editor.current?.save?.()) !== true) {
          setError('尚未保存成功，请返回检查填写内容后重试。');
          return;
        }
      } else editor.current?.discard();
      navigate(pending);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      lock.current = false;
      setResolving(false);
    }
  }
  return (
    <RepairToolsContext.Provider
      value={{ active, editor, request, finish: (id = null) => setActive(id) }}
    >
      {children}
      {pending && (
        <UnsavedChangesDialog
          busy={resolving}
          error={error}
          message={editor.current?.leaveMessage}
          onCancel={() => setPending(null)}
          onDiscard={() => void resolve(false)}
          onSave={editor.current?.save ? () => void resolve(true) : undefined}
        />
      )}
    </RepairToolsContext.Provider>
  );
}

export function useRepairTools() {
  return useContext(RepairToolsContext);
}

export function useRepairTool(id: string, options?: Omit<Editor, 'id'>) {
  const tools = useRepairTools();
  const [localOpen, setLocalOpen] = useState(false);
  const open = tools ? tools.active === id : localOpen;
  const form = useUnsavedChanges({
    dirty: open && !!options?.dirty,
    busy: !!options?.busy,
    save: options?.save,
    leaveMessage: options?.leaveMessage,
    discard: () => {
      options?.discard();
      tools?.finish();
      setLocalOpen(false);
    }
  });
  useLayoutEffect(() => {
    if (!tools || !open || !options) return;
    const editor: Editor = {
      id,
      ...options,
      save:
        options.save &&
        (async () => {
          if (form.current && !form.current.checkValidity()) return false;
          return (await options.save?.()) ?? false;
        })
    };
    tools.editor.current = editor;
    return () => {
      if (tools.editor.current === editor) tools.editor.current = null;
    };
  });
  return {
    open,
    form,
    toggle: () => (tools ? tools.request(open ? null : id) : setLocalOpen(!open)),
    cancel: () => (tools ? tools.request(null) : setLocalOpen(false)),
    finish: (next: string | null = null) => {
      tools?.finish(next);
      setLocalOpen(false);
    }
  };
}
