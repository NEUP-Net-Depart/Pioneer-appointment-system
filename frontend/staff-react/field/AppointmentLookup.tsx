import React, { useEffect, useId, useRef, useState } from 'react';
import { parseAppointmentSearch } from '../../../shared/appointment-search.js';
import { api, Status } from './ui';

type Candidate = { id: string; campus: string; date: string; timeSlot: string; status: string };
export function AppointmentLookup({
  active,
  disabled,
  onSelect
}: {
  active: boolean;
  disabled: boolean;
  onSelect: (value: string) => void;
}) {
  const [value, setValue] = useState(''),
    [items, setItems] = useState<Candidate[]>([]),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState(''),
    [expanded, setExpanded] = useState(false),
    [highlight, setHighlight] = useState(-1);
  const id = useId(),
    controller = useRef<AbortController | null>(null),
    chosen = useRef(''),
    query = parseAppointmentSearch(value);
  useEffect(() => {
    controller.current?.abort();
    setItems([]);
    setHighlight(-1);
    setMessage('');
    setPending(false);
    if (!active || disabled || !query?.ready || chosen.current === value) return;
    const abort = new AbortController();
    controller.current = abort;
    const timer = setTimeout(async () => {
      if (document.hidden) return;
      setPending(true);
      try {
        const result = await api<{ items: Candidate[]; hasMore: boolean }>('/api/scan/search', {
          method: 'POST',
          body: { q: query.text },
          signal: abort.signal
        });
        if (!abort.signal.aborted) {
          setItems(result.items);
          setExpanded(true);
          setMessage(
            result.hasMore
              ? '匹配较多，请补充编号缩小范围'
              : !result.items.length
                ? '未找到权限范围内的匹配预约'
                : ''
          );
        }
      } catch (error) {
        if (!abort.signal.aborted) setMessage((error as Error).message);
      } finally {
        if (!abort.signal.aborted) setPending(false);
      }
    }, 250);
    const hide = () => {
      if (document.hidden) {
        abort.abort();
        setPending(false);
        setExpanded(false);
        setItems([]);
      }
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      clearTimeout(timer);
      abort.abort();
      document.removeEventListener('visibilitychange', hide);
    };
  }, [active, disabled, value]);
  function select(value: string) {
    controller.current?.abort();
    chosen.current = value;
    setItems([]);
    setPending(false);
    setMessage('');
    setExpanded(false);
    setValue(value);
    onSelect(value);
  }
  function choose(item: Candidate) {
    select(item.id);
  }
  return (
    <div className="field-lookup">
      <form
        className="field-search"
        onSubmit={(event) => {
          event.preventDefault();
          if (highlight >= 0 && items[highlight]) choose(items[highlight]);
          else if (/^(?:reserve|reverse)?[01]\d{8}-\d{2,}$/i.test(value.trim()))
            select(value.trim());
          else if (items.length === 1) choose(items[0]);
          else {
            setExpanded(true);
            setMessage(
              items.length ? '请选择下方对应预约' : '请至少输入两位尾号，或输入含短横线的编号片段'
            );
          }
        }}
      >
        <label className="field-lookup-input">
          预约编号
          <input
            role="combobox"
            aria-label="预约编号"
            aria-autocomplete="list"
            aria-controls={id}
            aria-expanded={expanded && items.length > 0}
            aria-activedescendant={highlight >= 0 ? `${id}-${highlight}` : undefined}
            placeholder="输入至少两位尾号或编号"
            autoComplete="off"
            value={value}
            disabled={disabled}
            onFocus={() => setExpanded(true)}
            onChange={(event) => {
              setValue(event.target.value);
              setExpanded(true);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setExpanded(false);
                setHighlight(-1);
              }
              if (['ArrowDown', 'ArrowUp'].includes(event.key) && items.length) {
                event.preventDefault();
                setExpanded(true);
                setHighlight((current) =>
                  event.key === 'ArrowDown'
                    ? Math.min(items.length - 1, current + 1)
                    : Math.max(0, current - 1)
                );
              }
            }}
          />
        </label>
        <button disabled={disabled || !query?.ready}>查询</button>
      </form>
      <details className="workspace-help field-lookup-help">
        <summary>查询规则</summary>
        <p>两位及以上尾号只查当天；输入前段和“-”可跨日期查找。</p>
      </details>
      {pending && <p role="status">正在查找…</p>}
      {expanded && items.length > 0 && (
        <div className="field-lookup-results" role="listbox" id={id} aria-label="匹配的预约">
          {items.map((item, index) => (
            <button
              type="button"
              role="option"
              id={`${id}-${index}`}
              aria-selected={highlight === index}
              key={item.id}
              onClick={() => choose(item)}
            >
              <span>
                <strong>{item.id}</strong>
                <small>
                  {item.campus}校区 · {item.date} · {item.timeSlot}
                </small>
              </span>
              <Status value={item.status} />
            </button>
          ))}
        </div>
      )}
      {message && (
        <p role="status" className="field-lookup-help">
          {message}
        </p>
      )}
    </div>
  );
}
