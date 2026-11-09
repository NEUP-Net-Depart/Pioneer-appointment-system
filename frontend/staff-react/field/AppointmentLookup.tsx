import { useQuery } from '@tanstack/react-query';
import React, { useEffect, useId, useRef, useState } from 'react';
import { parseAppointmentSearch } from '../../../shared/appointment-search.js';
import { api, Status } from './ui';
import type { Home } from './types';

type Candidate = {
  id: string;
  campus: string;
  date: string;
  timeSlot: string;
  status: string;
  name?: string;
  studentId?: string;
};
export function AppointmentLookup({
  active,
  disabled,
  onSelect,
  onChange,
  onSearchActivityChange,
  label,
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
  searchCapabilities?: Home['searchCapabilities'];
  allowContactSearch?: boolean;
}) {
  const [value, setValue] = useState(''),
    [message, setMessage] = useState(''),
    [expanded, setExpanded] = useState(false),
    [highlight, setHighlight] = useState(-1);
  const id = useId(),
    chosen = useRef(''),
    contactEnabled = allowContactSearch ?? searchCapabilities?.contact ?? true,
    studentIdEnabled = searchCapabilities?.identity ?? false,
    inputLabel = label || (studentIdEnabled ? '预约编号 / 学号' : '预约编号'),
    query = parseAppointmentSearch(value),
    numberQuery = !!query && /^\d+(?:-\d*)?$/.test(query.text),
    ready = !!query?.ready && (numberQuery || !query.contact || contactEnabled),
    contactHint =
      searchCapabilities?.contactScope === 'own'
        ? '本人经手工单的完整联系方式'
        : searchCapabilities?.contactScope === 'today'
          ? '今日授权工单的完整联系方式'
          : '授权范围内工单的完整联系方式',
    placeholder =
      inputRole === 'textbox'
        ? `编号、设备或故障${studentIdEnabled ? '、姓名、完整学号' : ''}${contactEnabled ? `、${contactHint}` : ''}`
        : ['预约编号', studentIdEnabled && '姓名、完整学号', contactEnabled && contactHint]
            .filter(Boolean)
            .join('、');
  const [search, setSearch] = useState('');
  useEffect(() => {
    setHighlight(-1);
    setMessage('');
    const timer = setTimeout(() => setSearch(value.trim()), 250);
    return () => clearTimeout(timer);
  }, [value]);
  const mode = !contactEnabled
    ? studentIdEnabled && query?.studentId
      ? 'studentId'
      : studentIdEnabled
        ? 'identity'
        : 'number'
    : undefined;
  const body = { q: search, ...(mode ? { mode } : {}), ...(campusId ? { campusId } : {}) };
  const searching = active && !disabled && ready && chosen.current !== value;
  const result = useQuery<{ items: Candidate[]; hasMore: boolean }>({
    queryKey: ['/api/scan/search', body],
    queryFn: ({ signal }) =>
      api('/api/scan/search', { method: 'POST', body, signal, timeoutMs: 15000 }),
    enabled: searching && search === value.trim(),
    refetchInterval: false
  });
  const items = searching && search === value.trim() ? result.data?.items || [] : [];
  const pending = searching && (search !== value.trim() || result.isLoading);
  const feedback =
    message ||
    result.error?.message ||
    (result.data && searching && search === value.trim()
      ? result.data.hasMore
        ? studentIdEnabled && query?.studentId
          ? '匹配较多，可前往预约记录查看完整列表'
          : '匹配较多，请输入更完整的编号、姓名或联系方式'
        : !items.length && !hasLocalMatches
          ? '未找到权限范围内的匹配预约'
          : ''
      : '');
  useEffect(() => {
    onSearchActivityChange?.(pending || items.length > 0);
  }, [pending, items.length, onSearchActivityChange]);
  function select(value: string) {
    chosen.current = value;
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
                : `请输入${['至少两位预约编号尾号', studentIdEnabled && '姓名或完整学号', contactEnabled && '完整联系方式'].filter(Boolean).join('、')}`
            );
          }
        }}
      >
        <label className="field-lookup-input">
          {inputLabel}
          <input
            role={inputRole}
            aria-label={inputLabel}
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
                {item.name && (
                  <small>
                    {item.name} · {item.studentId}
                  </small>
                )}
                <small data-motion-value="text">
                  {item.campus}校区 · {item.date} · {item.timeSlot}
                </small>
              </span>
              <Status value={item.status} />
            </button>
          ))}
        </div>
      )}
      {feedback && (
        <p data-motion-value="text" role="status" className="field-lookup-help">
          {feedback}
        </p>
      )}
    </div>
  );
}
