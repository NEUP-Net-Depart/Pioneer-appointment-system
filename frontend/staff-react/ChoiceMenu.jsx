import React, { useEffect, useId, useRef, useState } from 'react';

export function ChoiceMenu({ label, value, options, onChange, disabled = false, className = '' }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef(null);
  const trigger = useRef(null);
  const list = useRef(null);
  const selected = options.find((option) => option.value === value);
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector('[aria-selected="true"]')?.focus();
    const closeOutside = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);
  const choose = (next) => {
    onChange(next);
    setOpen(false);
    trigger.current?.focus();
  };
  const moveFocus = (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = [...list.current.querySelectorAll('[role="option"]')];
    const current = items.indexOf(document.activeElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };
  return (
    <div className={`workspace-choice ${className}`} ref={root}>
      {label && (
        <span className="report-control-label" id={`${id}-label`}>
          {label}
        </span>
      )}
      <button
        type="button"
        ref={trigger}
        className="workspace-choice-trigger"
        aria-label={label ? `${label}：${selected?.label || '请选择'}` : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected?.label || '请选择'}</span>
        <span className="workspace-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div
          role="listbox"
          id={id}
          ref={list}
          aria-labelledby={label ? `${id}-label` : undefined}
          className="workspace-choice-options"
          onKeyDown={moveFocus}
        >
          {options.map((option) => (
            <button
              type="button"
              role="option"
              key={option.value}
              aria-selected={option.value === value}
              onClick={() => choose(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
