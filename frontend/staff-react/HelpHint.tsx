import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

export function HelpHint({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 280 });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const bounds = trigger.current?.getBoundingClientRect();
      if (!bounds) return;
      const width = Math.min(280, window.innerWidth - 24);
      const height = panel.current?.offsetHeight || 100;
      setPosition({
        width,
        left: Math.max(12, Math.min(bounds.right - width, window.innerWidth - width - 12)),
        top:
          bounds.bottom + height + 12 < window.innerHeight
            ? bounds.bottom + 6
            : Math.max(12, bounds.top - height - 6)
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === 'Escape'
          : !trigger.current?.contains(event.target as Node) &&
            !panel.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <span
      className="workspace-help-hint"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
      >
        <Info size={17} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            id={id}
            ref={panel}
            role="tooltip"
            className="workspace-help-tooltip"
            style={position}
          >
            {children}
          </div>,
          trigger.current?.closest('dialog') || document.body
        )}
    </span>
  );
}
