import React, {
  Children,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from 'react';
import { createPortal } from 'react-dom';
import { addDays, dateKey, calendarWeekRange as weekRange } from '../../shared/time.js';
import { TimePicker } from './TimePicker.jsx';
import { useControlLabel } from './useControlLabel.js';
import './workspace-controls.css';

function usePanel(open, setOpen, trigger, panel, calendar = false) {
  const [position, setPosition] = useState({ top: 12, left: 12, width: 300 });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!trigger.current?.getClientRects().length) {
        setOpen(false);
        return;
      }
      const bounds = trigger.current?.getBoundingClientRect();
      if (!bounds) return;
      const width = Math.min(calendar ? 308 : bounds.width, window.innerWidth - 24);
      const height = Math.min(panel.current?.offsetHeight || 360, window.innerHeight - 24);
      const below = window.innerHeight - bounds.bottom - 20;
      const above = bounds.top - 20;
      const upward = height > below && above > below;
      setPosition({
        width,
        left: Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12)),
        top: upward ? Math.max(12, bounds.top - height - 8) : Math.max(12, bounds.bottom + 8),
        maxHeight: Math.max(120, Math.min(window.innerHeight - 24, upward ? above : below))
      });
    };
    const outside = (event) => {
      if (!panel.current?.contains(event.target) && !trigger.current?.contains(event.target))
        setOpen(false);
    };
    const escape = (event) => {
      if (event.key === 'Tab' && panel.current?.contains(document.activeElement)) {
        setOpen(false);
        trigger.current?.focus({ preventScroll: true });
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    };
    place();
    const first =
      panel.current?.querySelector('input[type="search"]') ||
      panel.current?.querySelector(
        '[aria-selected="true"]:not(:disabled), [aria-pressed="true"]:not(:disabled), [data-autofocus]:not(:disabled)'
      ) ||
      panel.current?.querySelector('button:not(:disabled)');
    first?.focus({ preventScroll: true });
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    if (trigger.current) observer.observe(trigger.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open, setOpen, trigger, panel, calendar]);
  return position;
}

function textOf(children) {
  return Children.toArray(children)
    .map((child) => (isValidElement(child) ? textOf(child.props.children) : String(child)))
    .join('');
}
function optionsOf(children) {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement(child)) return [];
    if (child.type !== 'option') return optionsOf(child.props.children);
    const label = textOf(child.props.children);
    return [{ value: String(child.props.value ?? label), label, disabled: child.props.disabled }];
  });
}

export function Select({
  value = undefined,
  defaultValue = undefined,
  onChange = undefined,
  children = undefined,
  disabled = false,
  required = false,
  className = '',
  ...props
}) {
  const options = optionsOf(children);
  const [local, setLocal] = useState(defaultValue);
  const selectedValue = String(value ?? local ?? options[0]?.value ?? '');
  const selected = options.find((option) => option.value === selectedValue);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [invalid, setInvalid] = useState(false);
  const root = useRef(null),
    trigger = useRef(null),
    panel = useRef(null);
  const id = useId();
  const label = useControlLabel(root, props['aria-label'], props.id) || '选择选项';
  const position = usePanel(open, setOpen, trigger, panel);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useLayoutEffect(() => {
    if (open && trigger.current?.matches(':disabled')) setOpen(false);
  });
  const visible = options.filter((option) =>
    option.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  );
  const choose = (option) => {
    if (option.disabled || trigger.current?.matches(':disabled')) return;
    setLocal(option.value);
    setInvalid(false);
    const target = { value: option.value, name: props.name };
    onChange?.({ target, currentTarget: target });
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };
  const move = (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if (event.target.type === 'search' && ['Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = [...panel.current.querySelectorAll('[role="option"]:not(:disabled)')];
    const current = items.indexOf(document.activeElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus({ preventScroll: true });
    items[next]?.scrollIntoView({ block: 'nearest' });
  };
  return (
    <span className={`workspace-select ${className}`} ref={root}>
      <button
        {...props}
        ref={trigger}
        type="button"
        role="combobox"
        data-value={selectedValue}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-haspopup="listbox"
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onClick={() => {
          setSearch('');
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();
            setSearch('');
            setOpen(true);
          }
        }}
      >
        <span>{selected?.label || '请选择'}</span>
        <span className="workspace-chevron" aria-hidden="true" />
      </button>
      {(required || props.name) && (
        <input
          className="workspace-validation-input"
          tabIndex={-1}
          aria-hidden="true"
          name={props.name}
          value={selectedValue}
          required={required}
          disabled={disabled}
          onChange={() => {}}
          onInvalid={(event) => {
            event.preventDefault();
            setInvalid(true);
            trigger.current?.focus();
          }}
        />
      )}
      {invalid && (
        <span className="workspace-control-error" role="alert">
          请选择{label}
        </span>
      )}
      {open &&
        createPortal(
          <div className="workspace-control-popover" style={position} ref={panel} onKeyDown={move}>
            {options.length > 7 && (
              <input
                type="search"
                aria-label={`搜索${label}`}
                placeholder="搜索"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            )}
            <div role="listbox" aria-label={label} id={id} className="workspace-select-options">
              {visible.map((option, index) => (
                <button
                  type="button"
                  role="option"
                  data-value={option.value}
                  key={`${option.value}:${index}`}
                  aria-selected={selectedValue === option.value}
                  disabled={option.disabled}
                  data-autofocus={index === 0 ? '' : undefined}
                  onClick={() => choose(option)}
                >
                  <span>{option.label}</span>
                  <span aria-hidden="true">{selectedValue === option.value ? '✓' : ''}</span>
                </button>
              ))}
              {!visible.length && (
                <div className="workspace-select-empty" role="status">
                  没有匹配项
                </div>
              )}
            </div>
          </div>,
          trigger.current?.closest('dialog') || document.body
        )}
    </span>
  );
}

const validDate = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const pad = (value) => String(value).padStart(2, '0');
const monthAt = (value, offset) => {
  const date = new Date(`${value.slice(0, 7)}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
};

export function DatePicker({
  value = '',
  onChange = undefined,
  disabled = false,
  required = false,
  min = '',
  max = '',
  mode = 'date',
  label = undefined,
  ...props
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState((value || dateKey()).slice(0, 7));
  const [months, setMonths] = useState(false);
  const [editing, setEditing] = useState({ source: value, text: value });
  if (editing.source !== value) setEditing({ source: value, text: value });
  const trigger = useRef(null),
    panel = useRef(null),
    input = useRef(null);
  const id = useId();
  const position = usePanel(open, setOpen, trigger, panel, true);
  const fieldLabel = useControlLabel(input, props['aria-label'], props.id);
  const year = Number(month.slice(0, 4));
  const text = editing.source === value ? editing.text : value;
  const title =
    label ||
    (props['aria-label'] ? `选择${props['aria-label']}` : '') ||
    (mode === 'week' ? '选择工作周' : mode === 'month' ? '选择月份' : '选择日期');
  const allowed = (day) => (!min || day >= min) && (!max || day <= max);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useLayoutEffect(() => {
    if (open && input.current?.matches(':disabled')) setOpen(false);
  });
  useEffect(() => {
    const valid =
      !text ||
      ((mode === 'month' ? /^\d{4}-(?:0[1-9]|1[0-2])$/.test(text) : validDate(text)) &&
        allowed(text));
    input.current?.setCustomValidity(valid ? '' : '请选择有效范围内的日期');
  }, [text, min, max, mode]);
  const change = (day) => {
    if (input.current?.matches(':disabled')) return;
    const next = mode === 'week' && day ? weekRange(day).start : day;
    if (next && !allowed(next)) return;
    onChange?.({ target: { value: next }, currentTarget: { value: next } });
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };
  const start = weekRange(`${month}-01`).start;
  const days = Array.from({ length: 42 }, (_, index) => addDays(start, index));
  const dayKeys = (event, day) => {
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!(event.key in offsets) && !['PageUp', 'PageDown'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key in offsets
        ? addDays(day, offsets[event.key])
        : `${monthAt(day, event.key === 'PageUp' ? -1 : 1)}-01`;
    setMonth(next.slice(0, 7));
    requestAnimationFrame(() => panel.current?.querySelector(`[data-day="${next}"]`)?.focus());
  };
  return (
    <span className="workspace-date-field">
      <input
        {...props}
        ref={input}
        type="text"
        aria-label={fieldLabel || undefined}
        inputMode="numeric"
        placeholder={mode === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD'}
        pattern={mode === 'month' ? '[0-9]{4}-[0-9]{2}' : '[0-9]{4}-[0-9]{2}-[0-9]{2}'}
        required={required}
        min={min || undefined}
        max={max || undefined}
        disabled={disabled}
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          setEditing({ source: value, text: next });
          if (
            !next ||
            (mode === 'month' ? /^\d{4}-(?:0[1-9]|1[0-2])$/.test(next) : validDate(next))
          ) {
            const normalized = mode === 'week' && next ? weekRange(next).start : next;
            onChange?.({ target: { value: normalized }, currentTarget: { value: normalized } });
          }
        }}
      />
      <button
        ref={trigger}
        className="workspace-date-open"
        type="button"
        aria-label={title}
        aria-haspopup="dialog"
        aria-controls={open ? id : undefined}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setMonth((value || dateKey()).slice(0, 7));
          setMonths(mode === 'month');
          setOpen((current) => !current);
        }}
      >
        <span className="workspace-calendar-icon" aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            className="workspace-control-popover workspace-calendar"
            ref={panel}
            style={position}
            role="dialog"
            aria-label={title}
            id={id}
          >
            <div className="workspace-calendar-heading">
              <button
                type="button"
                disabled={year <= 1}
                aria-label={months ? '上一年' : '上个月'}
                onClick={() => setMonth(monthAt(month, months ? -12 : -1))}
              >
                ‹
              </button>
              {mode === 'month' ? (
                <strong className="workspace-calendar-year">{year}年</strong>
              ) : (
                <button type="button" onClick={() => setMonths((current) => !current)}>
                  {year}年{!months && `${Number(month.slice(5))}月`}
                </button>
              )}
              <button
                type="button"
                disabled={year >= 9999}
                aria-label={months ? '下一年' : '下个月'}
                onClick={() => setMonth(monthAt(month, months ? 12 : 1))}
              >
                ›
              </button>
            </div>
            {months ? (
              <div className="workspace-calendar-months">
                {Array.from({ length: 12 }, (_, index) => {
                  const next = `${year}-${pad(index + 1)}`;
                  return (
                    <button
                      type="button"
                      key={next}
                      disabled={mode === 'month' && !allowed(next)}
                      aria-pressed={next === value.slice(0, 7)}
                      data-autofocus={index === 0 ? '' : undefined}
                      onClick={() => {
                        if (mode === 'month') change(next);
                        else {
                          setMonth(next);
                          setMonths(false);
                        }
                      }}
                    >
                      {index + 1}月
                    </button>
                  );
                })}
              </div>
            ) : (
              <>
                <div className="workspace-calendar-weekdays" aria-hidden="true">
                  {['日', '一', '二', '三', '四', '五', '六'].map((day) => (
                    <span key={day}>{day}</span>
                  ))}
                </div>
                <div
                  className={`workspace-calendar-days${mode === 'week' ? ' workspace-calendar-weeks' : ''}`}
                  role="group"
                  aria-label={mode === 'week' ? '按周选择' : '按日选择'}
                >
                  {days.map((day) => (
                    <button
                      type="button"
                      key={day}
                      data-day={day}
                      data-outside={day.slice(0, 7) !== month}
                      data-today={day === dateKey()}
                      data-autofocus={day === (value || dateKey()) ? '' : undefined}
                      aria-label={
                        mode === 'week'
                          ? `${weekRange(day).start} — ${addDays(weekRange(day).start, 6)}`
                          : day
                      }
                      aria-pressed={
                        mode === 'week'
                          ? !!value && weekRange(day).start === weekRange(value).start
                          : day === value
                      }
                      disabled={!allowed(mode === 'week' ? weekRange(day).start : day)}
                      onKeyDown={(event) => dayKeys(event, day)}
                      onClick={() => change(day)}
                    >
                      {Number(day.slice(8))}
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="workspace-calendar-footer">
              <button
                type="button"
                disabled={
                  !allowed(
                    mode === 'month'
                      ? dateKey().slice(0, 7)
                      : mode === 'week'
                        ? weekRange(dateKey()).start
                        : dateKey()
                  )
                }
                onClick={() => change(mode === 'month' ? dateKey().slice(0, 7) : dateKey())}
              >
                {mode === 'week' ? '本周' : mode === 'month' ? '本月' : '今天'}
              </button>
              {!required && (
                <button type="button" onClick={() => change('')}>
                  清除
                </button>
              )}
            </div>
          </div>,
          trigger.current?.closest('dialog') || document.body
        )}
    </span>
  );
}

export function DateTimePicker({
  value = '',
  onChange = undefined,
  disabled = false,
  required = false,
  label = '日期时间',
  min = '',
  max = '',
  ...props
}) {
  const [day, time] = value.split('T');
  const validation = useRef(null);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    validation.current?.setCustomValidity(
      value && ((min && value < min) || (max && value > max)) ? '请选择有效范围内的日期和时间' : ''
    );
    setInvalid(false);
  }, [value, min, max]);
  const change = (next) => onChange?.({ target: { value: next }, currentTarget: { value: next } });
  return (
    <span className="workspace-datetime-field" role="group" aria-label={label}>
      <DatePicker
        {...props}
        name={undefined}
        aria-label={`${label}日期`}
        min={min.slice(0, 10)}
        max={max.slice(0, 10)}
        value={day || ''}
        disabled={disabled}
        required={required}
        onChange={(event) =>
          change(event.target.value ? `${event.target.value}T${time || '00:00'}` : '')
        }
      />
      <TimePicker
        aria-label={`${label}时刻`}
        label={`选择${label}时刻`}
        value={time || ''}
        disabled={disabled || !day}
        required={required}
        onChange={(next) => change(next && day ? `${day}T${next}` : '')}
      />
      <input
        ref={validation}
        className="workspace-validation-input"
        type="text"
        tabIndex={-1}
        aria-hidden="true"
        name={props.name}
        value={value}
        required={required}
        disabled={disabled}
        onChange={() => {}}
        onInvalid={(event) => {
          event.preventDefault();
          setInvalid(true);
          event.currentTarget.parentElement.querySelector('input:not([aria-hidden])')?.focus();
        }}
      />
      {invalid && (
        <span className="workspace-control-error" role="alert">
          请选择有效范围内的日期和时间
        </span>
      )}
    </span>
  );
}
