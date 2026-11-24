import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from 'react';
import { reveal } from './motion';

type Dialog = { kind: 'notice' | 'signature' | 'agreement' } | { kind: 'photo'; url: string };

export function useDialogState() {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  return { dialog, open: setDialog, close: () => setDialog(null) };
}

export const DialogContext = createContext<ReturnType<typeof useDialogState> | null>(null);

export function useDialogs() {
  const value = useContext(DialogContext);
  if (!value) throw new Error('Missing student dialogs');
  return value;
}

export function DialogLayer({
  id,
  kind,
  layer,
  children
}: {
  id: string;
  kind: Dialog['kind'];
  layer?: string;
  children: ReactNode;
}) {
  const { dialog, close } = useDialogs();
  const root = useRef<HTMLDivElement>(null);
  const open = dialog?.kind === kind;
  const controls = () =>
    [
      ...(root.current?.querySelectorAll<HTMLElement>('button,a[href],input,select,textarea') || [])
    ].filter((item) => !item.matches(':disabled,[hidden]'));
  useLayoutEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    reveal(root.current?.querySelector('.modal') ?? null, { distance: 12 });
    controls()[0]?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open]);
  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      const items = controls(),
        first = items[0],
        last = items.at(-1);
      const edge = event.shiftKey ? first : last;
      if (document.activeElement === edge) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    }
  }
  return (
    <div
      ref={root}
      className={'modal-backdrop' + (layer ? ' ' + layer : '')}
      id={id}
      hidden={!open}
      onKeyDown={keydown}
    >
      {children}
    </div>
  );
}
