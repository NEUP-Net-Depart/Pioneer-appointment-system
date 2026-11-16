import { controlPart } from '../../shared/telemetry-controls.js';
import { track } from '../../shared/telemetry-client.js';
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useControlLabel } from './useControlLabel.js';
import './workspace-controls.css';

const validTime = (value) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const padded = (value) => String(value).padStart(2, '0');

// One monoline wire glyph per cathode, drawn in a 60x100 box; each sits at its
// own depth inside the tube, so the unlit wires peek out around the lit one.
const CATHODE_WIRES = {
  0: 'M17,50 C17,24 22,8 30,8 C38,8 43,24 43,50 C43,76 38,92 30,92 C22,92 17,76 17,50 Z',
  1: 'M20,20 L29,9 L29,91',
  2: 'M16,20 C16,11 22,7 30,7 C39,7 45,12 45,21 C45,29 39,36 32,43 C25,50 17,59 13,68 L13,91 L46,91',
  3: 'M16,15 C16,10 22,7 30,7 C40,7 46,12 46,20 C46,28 40,33 34,35 C42,37 47,43 47,53 C47,71 37,93 23,93 C16,93 10,90 7,85',
  4: 'M38,92 L38,8 L10,64 L50,64',
  5: 'M45,7 L17,7 L14,45 C20,40 26,38 31,38 C41,38 47,45 47,55 C47,72 38,93 23,93 C15,93 9,89 6,83',
  6: 'M42,7 C31,7 19,20 15,45 C11,67 17,93 30,93 C40,93 46,86 46,75 C46,64 39,57 30,57 C21,57 15,64 14,75',
  7: 'M13,8 L47,8 L28,92',
  8: 'M30,7 C37,7 42,11 42,17 C42,24 36,30 30,34 C24,30 18,24 18,17 C18,11 23,7 30,7 M30,34 C39,34 46,41 46,54 C46,72 39,93 30,93 C21,93 14,72 14,54 C14,41 21,34 30,34',
  9: 'M18,93 C29,93 41,80 45,55 C49,33 43,7 30,7 C20,7 14,14 14,25 C14,36 21,43 30,43 C40,43 46,36 47,25'
};
const CATHODE_DEPTH = {
  0: 'translate(-1.4px, 0.9px) scale(1.01)',
  1: 'translate(1.2px, -1.8px) scale(0.97)',
  2: 'translate(-0.8px, -1.2px) scale(1.02)',
  3: 'translate(1.5px, 1.4px) scale(0.98)',
  4: 'translate(-1px, 1.8px) scale(1)',
  5: 'translate(0.9px, -0.6px) scale(1.01)',
  6: 'translate(-1.6px, -1.5px) scale(0.99)',
  7: 'translate(1.1px, 1.1px) scale(1.02)',
  8: 'translate(0, 0.6px) scale(1)',
  9: 'translate(-0.6px, -0.9px) scale(0.98)'
};

function CathodeStack({ digit }) {
  const [frame, setFrame] = useState({ digit, previous: null });
  if (frame.digit !== digit) setFrame({ digit, previous: frame.digit });
  return (
    <span className="time-tube-stack">
      {Object.keys(CATHODE_WIRES).map((cathode) => {
        const leaving = cathode === frame.previous;
        const arriving = cathode === frame.digit;
        return (
          <svg
            key={cathode}
            viewBox="0 0 60 100"
            className={[
              'time-tube-cathode',
              arriving ? 'time-tube-cathode-lit' : '',
              leaving ? 'time-tube-cathode-out' : '',
              arriving && !leaving ? 'time-tube-cathode-in' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ transform: CATHODE_DEPTH[cathode] }}
          >
            <path d={CATHODE_WIRES[cathode]} />
          </svg>
        );
      })}
    </span>
  );
}

function Tube({ children }) {
  return (
    <span className="time-tube" aria-hidden="true">
      {children}
      <span className="time-tube-pins" />
    </span>
  );
}

function TubeControl({ value, maximum, label, onStep, onWheelStep, onSet, 'data-track': trackId }) {
  const surface = useRef(null);
  const drag = useRef(null);
  const wheel = useRef({ distance: 0, at: 0 });
  const interaction = useRef({ dirty: false, timer: null });
  const finishInteraction = useCallback(() => {
    clearTimeout(interaction.current.timer);
    if (!interaction.current.dirty) return;
    interaction.current.dirty = false;
    track('ui.change', { control: trackId });
  }, [trackId]);
  const scheduleInteraction = () => {
    interaction.current.dirty = true;
    clearTimeout(interaction.current.timer);
    interaction.current.timer = setTimeout(finishInteraction, 250);
  };
  useEffect(() => () => finishInteraction(), [finishInteraction]);
  useEffect(() => {
    const node = surface.current;
    const scroll = (event) => {
      if (event.ctrlKey || !event.deltaY) return;
      event.preventDefault();
      const now = performance.now();
      const distance =
        event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 160 : 1);
      if (now - wheel.current.at > 180 || Math.sign(distance) !== Math.sign(wheel.current.distance))
        wheel.current.distance = 0;
      wheel.current.at = now;
      wheel.current.distance += distance;
      if (Math.abs(wheel.current.distance) < 40) return;
      const direction = Math.sign(wheel.current.distance);
      wheel.current.distance = 0;
      onWheelStep(direction);
      scheduleInteraction();
    };
    node.addEventListener('wheel', scroll, { passive: false });
    return () => node.removeEventListener('wheel', scroll);
  }, [onWheelStep]);
  return (
    <div
      data-track={trackId}
      ref={surface}
      className="time-tube-control"
      role="spinbutton"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={maximum}
      aria-valuenow={value}
      aria-valuetext={String(value)}
      aria-description="上下滑动或方向键调整此位数字；滚轮在十位按十、个位按一调整所属小时或分钟并自动进位，也可以直接输入时间。"
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, y: event.clientY };
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        const steps = Math.trunc((drag.current.y - event.clientY) / 18);
        if (!steps) return;
        drag.current.y -= steps * 18;
        onStep(steps);
        interaction.current.dirty = true;
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        drag.current = null;
        finishInteraction();
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
        finishInteraction();
      }}
      onLostPointerCapture={() => {
        drag.current = null;
        finishInteraction();
      }}
      onKeyDown={(event) => {
        const steps = { ArrowUp: 1, ArrowDown: -1, PageUp: 5, PageDown: -5 };
        if (event.key in steps) {
          event.preventDefault();
          onStep(steps[event.key]);
          scheduleInteraction();
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          onSet(event.key === 'Home' ? 0 : maximum);
          scheduleInteraction();
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          const controls = [
            ...event.currentTarget.parentElement.querySelectorAll('[role="spinbutton"]')
          ];
          const index = controls.indexOf(event.currentTarget);
          controls[index + (event.key === 'ArrowLeft' ? -1 : 1)]?.focus();
        }
      }}
    >
      <Tube>
        <CathodeStack digit={String(value)} />
      </Tube>
    </div>
  );
}

export function TimePicker({
  value = '',
  onChange,
  disabled = false,
  required = false,
  label = '选择时间',
  portalTarget = null,
  'data-track': trackId,
  ...inputProps
}) {
  const id = useId();
  const input = useRef(null);
  const panel = useRef(null);
  const trigger = useRef(null);
  const currentDraft = useRef(value || '19:00');
  const fieldLabel = useControlLabel(input, inputProps['aria-label'], inputProps.id);
  const [editing, setEditing] = useState({ source: value, text: value });
  if (editing.source !== value) setEditing({ source: value, text: value });
  const text = editing.source === value ? editing.text : value;
  const setText = (next) => setEditing({ source: value, text: next });
  const [open, setOpen] = useState(false);
  const close = useCallback(
    (restoreFocus = true) => {
      setEditing({ source: value, text: value });
      setOpen(false);
      if (restoreFocus) trigger.current?.focus();
    },
    [value]
  );
  const [draft, setDraft] = useState(value || '19:00');
  const updateDraft = (next) => {
    currentDraft.current = next;
    setDraft(next);
  };
  const show = () => {
    if (open || disabled) return;
    updateDraft(validTime(text) ? text : '19:00');
    setOpen(true);
  };
  const [position, setPosition] = useState({ top: 0, left: 0, width: 320 });
  useEffect(() => {
    if (!open || disabled) return;
    const updatePosition = () => {
      if (portalTarget) return;
      if (!input.current?.getClientRects().length) {
        close(false);
        return;
      }
      const bounds = input.current.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop || 0;
      const viewportHeight = viewport?.height || window.innerHeight;
      const viewportLeft = viewport?.offsetLeft || 0;
      const width = Math.min(320, (viewport?.width || window.innerWidth) - 24);
      const height = Math.min(panel.current?.offsetHeight || 260, viewportHeight - 24);
      const below = Math.max(0, viewportTop + viewportHeight - bounds.bottom - 20);
      const above = Math.max(0, bounds.top - viewportTop - 20);
      const downward = below >= height || below >= above;
      const available = downward ? below : above;
      const top = downward ? bounds.bottom + 8 : bounds.top - Math.min(height, available) - 8;
      setPosition({
        top,
        left: Math.max(
          viewportLeft + 12,
          Math.min(bounds.left, viewportLeft + (viewport?.width || window.innerWidth) - width - 12)
        ),
        width,
        maxHeight: available
      });
    };
    const outside = (event) => {
      if (
        !panel.current?.contains(event.target) &&
        !input.current?.parentElement.contains(event.target)
      )
        close(false);
    };
    const escape = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    if (input.current) observer.observe(input.current);
    if (panel.current) observer.observe(panel.current);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    window.visualViewport?.addEventListener('resize', updatePosition);
    window.visualViewport?.addEventListener('scroll', updatePosition);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      window.visualViewport?.removeEventListener('resize', updatePosition);
      window.visualViewport?.removeEventListener('scroll', updatePosition);
    };
  }, [open, disabled, portalTarget, close]);
  useEffect(() => {
    if (disabled) close(false);
  }, [disabled, close]);
  const digitMaximum = (index, current) => [2, current[0] === '2' ? 3 : 9, 5, 9][index];
  const changeUnit = (unit, steps) => {
    const parts = currentDraft.current.split(':');
    const range = unit === 0 ? 24 : 60;
    parts[unit] = padded((((Number(parts[unit]) + steps) % range) + range) % range);
    const next = parts.join(':');
    updateDraft(next);
    setText(next);
  };
  const changeDigit = (index, change) => {
    const digits = currentDraft.current.replace(':', '').split('');
    const range = digitMaximum(index, digits) + 1;
    digits[index] = String(((change(Number(digits[index])) % range) + range) % range);
    if (digits[0] === '2' && Number(digits[1]) > 3) digits[1] = '3';
    const next = `${digits[0]}${digits[1]}:${digits[2]}${digits[3]}`;
    updateDraft(next);
    setText(next);
  };
  return (
    <span className="workspace-time-field">
      <input
        {...inputProps}
        data-track={trackId}
        ref={input}
        type="text"
        aria-label={fieldLabel || undefined}
        inputMode="numeric"
        placeholder="HH:mm"
        pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]"
        maxLength={5}
        required={required}
        disabled={disabled}
        value={text}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={show}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            show();
          }
        }}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          const compact = next.match(/^(\d{2})(\d{2})$/);
          const normalized = compact ? `${compact[1]}:${compact[2]}` : next;
          if (validTime(normalized)) {
            updateDraft(normalized);
            if (compact) setText(normalized);
            if (!open) onChange(normalized);
          } else if (!next && !open) onChange(next);
        }}
        onBlur={() => {
          if (!text) return;
          const match = text.match(/^(\d{1,2}):?(\d{2})$/);
          const normalized = match ? `${padded(Number(match[1]))}:${match[2]}` : text;
          if (validTime(normalized)) {
            setText(normalized);
            updateDraft(normalized);
            if (!open) onChange(normalized);
          }
        }}
      />
      <button
        type="button"
        data-track={controlPart(trackId, 'trigger')}
        className="workspace-time-open"
        ref={trigger}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => {
          if (open) close();
          else show();
        }}
      >
        <span className="workspace-time-icon" aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            className={`workspace-time-popover${portalTarget ? ' workspace-time-inline' : ''}`}
            ref={panel}
            id={id}
            data-track={controlPart(trackId, 'panel')}
            role="dialog"
            aria-label={label}
            style={portalTarget ? undefined : position}
          >
            <div className="time-instrument">
              <div className="time-instrument-readout">
                {['小时十位', '小时个位', '分钟十位', '分钟个位'].map((digitLabel, index) => (
                  <React.Fragment key={digitLabel}>
                    {index === 2 && (
                      <Tube>
                        <span className="time-tube-point" />
                      </Tube>
                    )}
                    <TubeControl
                      data-track={controlPart(trackId, 'adjust')}
                      value={Number(draft.replace(':', '')[index])}
                      maximum={digitMaximum(index, draft)}
                      label={digitLabel}
                      onStep={(steps) => changeDigit(index, (current) => current + steps)}
                      onWheelStep={(steps) =>
                        changeUnit(index < 2 ? 0 : 1, steps * (index % 2 === 0 ? 10 : 1))
                      }
                      onSet={(next) => changeDigit(index, () => next)}
                    />
                  </React.Fragment>
                ))}
              </div>
            </div>
            <div className="time-picker-actions">
              <button
                data-track={controlPart(trackId, 'cancel')}
                type="button"
                onClick={() => close()}
              >
                取消
              </button>
              <button
                type="button"
                data-track={controlPart(trackId, 'confirm')}
                className="workspace-control-primary"
                onClick={() => {
                  track('ui.change', { control: trackId });
                  onChange(draft);
                  setText(draft);
                  setOpen(false);
                  trigger.current?.focus();
                }}
              >
                确定 {draft}
              </button>
            </div>
          </div>,
          portalTarget || input.current?.closest('dialog') || document.body
        )}
    </span>
  );
}
