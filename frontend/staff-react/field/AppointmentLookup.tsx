import React, { useEffect, useId, useRef, useState } from 'react';
import { parseAppointmentSearch } from '../../../shared/appointment-search.js';
import { api, Status } from './ui';

type Candidate = {
  id: string;
  campus: string;
  date: string;
  timeSlot: string;
  status: string;
};
export function AppointmentLookup({
  active,
  disabled,
  onSelect,
  onChange,
  onSearchActivityChange,
  label = '预约编号',
  inputRole = 'combobox',
  hasLocalMatches = false,
  campusId,
  searchCapabilities,
  allowContactSearch
}: {
  active: boolean;
  disabled: boolean;
  onSelect: (value: string) => void;
  onChange?: (value: string) => void;
  onSearchActivityChange?: (active: boolean) => void;
  label?: string;
  inputRole?: 'combobox' | 'textbox';
  hasLocalMatches?: boolean;
  campusId?: string;
  searchCapabilities?: { contact: boolean; contactScope: 'none' | 'own' | 'today' | 'authorized' };
  allowContactSearch?: boolean;
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
    contactEnabled = allowContactSearch ?? searchCapabilities?.contact ?? true,
    query = parseAppointmentSearch(value),
    numberQuery = !!query && /^\d+(?:-\d*)?$/.test(query.text),
    ready = !!query?.ready && (numberQuery || (contactEnabled && !!query.contact)),
    contactHint =
      searchCapabilities?.contactScope === 'own'
        ? '本人经手工单的完整联系方式'
        : searchCapabilities?.contactScope === 'today'
          ? '今日授权工单的完整联系方式'
          : '授权范围内工单的完整联系方式',
    placeholder =
      inputRole === 'textbox'
        ? `编号、设备或故障${contactEnabled ? `、${contactHint}` : ''}`
        : `预约编号${contactEnabled ? `或${contactHint}` : ''}`;
  useEffect(() => {
    controller.current?.abort();
    setItems([]);
    setHighlight(-1);
    setMessage('');
    setPending(false);
    if (!active || disabled || !ready || chosen.current === value || document.hidden) return;
    const abort = new AbortController();
    controller.current = abort;
    setPending(true);
    const timer = setTimeout(async () => {
      if (document.hidden) return;
      try {
        const result = await api<{ items: Candidate[]; hasMore: boolean }>('/api/scan/search', {
          method: 'POST',
          body: {
            q: query.text,
            ...(!contactEnabled ? { mode: 'number' } : {}),
            ...(campusId ? { campusId } : {})
          },
          signal: abort.signal
        });
        if (!abort.signal.aborted) {
          setItems(result.items);
          setExpanded(true);
          setMessage(
            result.hasMore
              ? '匹配较多，请输入更完整的编号或联系方式'
              : !result.items.length
                ? hasLocalMatches
                  ? ''
                  : '未找到权限范围内的匹配预约'
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
  }, [active, disabled, value, hasLocalMatches, campusId, ready, contactEnabled]);
  useEffect(() => {
    onSearchActivityChange?.(pending || items.length > 0);
  }, [pending, items.length, onSearchActivityChange]);
  function select(value: string) {
    controller.current?.abort();
    chosen.current = value;
    setItems([]);
    setPending(false);
    setMessage('');
    setExpanded(false);
    setValue(value);
    onChange?.(value);
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
          else if (!ready && hasLocalMatches) return;
          else {
            setExpanded(true);
            setMessage(
              items.length
                ? '请选择下方对应预约'
                : !contactEnabled
                  ? '可输入至少两位预约编号尾号查询'
                  : '请输入至少两位编号尾号，或完整的联系方式'
            );
          }
        }}
      >
        <label className="field-lookup-input">
          {label}
          <input
            role={inputRole}
            aria-label={label}
            aria-autocomplete="list"
            aria-controls={id}
            aria-expanded={expanded && items.length > 0}
            aria-activedescendant={highlight >= 0 ? `${id}-${highlight}` : undefined}
            placeholder={placeholder}
            autoComplete="off"
            value={value}
            disabled={disabled}
            onFocus={() => setExpanded(true)}
            onChange={(event) => {
              setValue(event.target.value);
              onChange?.(event.target.value);
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
        {inputRole === 'combobox' && <button disabled={disabled || !ready}>查询</button>}
      </form>
      <details className="workspace-help field-lookup-help">
        <summary>查询规则</summary>
        <p>
          编号尾号查当天；含“-”的编号片段可跨日期查找。
          {!contactEnabled
            ? ''
            : searchCapabilities?.contactScope === 'own'
              ? '联系方式仅匹配本人接手的工单。'
              : '完整联系方式匹配当前校区可查看的现场工单。'}
        </p>
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
                <strong data-motion-value="text">{item.id}</strong>
                <small data-motion-value="text">
                  {item.campus}校区 · {item.date} · {item.timeSlot}
                </small>
              </span>
              <Status value={item.status} />
            </button>
          ))}
        </div>
      )}
      {message && (
        <p data-motion-value="text" role="status" className="field-lookup-help">
          {message}
        </p>
      )}
    </div>
  );
}
