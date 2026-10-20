import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TIME_SLOTS } from '../../shared/constants.js';
import {
  gridRange,
  rangeContains,
  parseCapacityGrid,
  pasteRange,
  repeatGridValue
} from '../../shared/capacity-grid.js';
import { request } from './request.js';
import { ActivityContext, Modal, Notice } from './field/ui';
import { ServiceDayEditor } from './ServiceDayEditor';
import { ActualDayCapacity } from './ActualDayCapacity';
import { ServiceLocationEditor } from './ServiceLocationEditor';
import { WorkspaceSections } from './WorkspaceSections';
import { useUnsavedChanges } from './useUnsavedChanges.js';
import './capacity.css';

const days = ['周一', '周二', '周三', '周四'];
const keyOf = (item) => `${item.campus}/${item.weekday}/${item.timeSlot}`;
const valid = (value) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value));
const label = (item) => `${item.campus} ${days[item.weekday - 1]} ${item.timeSlot}`;
const single = {
  anchor: { row: 0, col: 0 },
  end: { row: 0, col: 0 },
  range: { top: 0, bottom: 0, left: 0, right: 0 }
};

export function CapacityEditor({ active, onNavigate }) {
  const [items, setItems] = useState([]),
    [drafts, setDrafts] = useState({});
  const [campus, setCampus] = useState(''),
    [day, setDay] = useState(1),
    [mode, setMode] = useState('template');
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false),
    [discard, setDiscard] = useState(false),
    [undo, setUndo] = useState(null);
  const [selections, setSelections] = useState({}),
    [copied, setCopied] = useState(''),
    [extend, setExtend] = useState(false);
  const [bulk, setBulk] = useState('5'),
    [scope, setScope] = useState('day'),
    [copyTarget, setCopyTarget] = useState(''),
    [dayTarget, setDayTarget] = useState('all');
  const [editing, setEditing] = useState(''),
    [preview, setPreview] = useState(null),
    [revision, setRevision] = useState(0);
  const root = useRef(null),
    drag = useRef(null),
    reading = useRef(null),
    lock = useRef(false),
    currentDrafts = useRef(drafts);
  currentDrafts.current = drafts;
  const campuses = [...new Set(items.map((item) => item.campus))];
  const selection = selections[campus] || single;
  const at = (row, col) =>
    items.find(
      (item) =>
        item.campus === campus && item.weekday === col + 1 && item.timeSlot === TIME_SLOTS[row]
    );
  const value = (item) => drafts[keyOf(item)]?.value ?? String(item.capacity);
  const changes = items.filter((item) => drafts[keyOf(item)]);
  const conflicts = changes.filter((item) => drafts[keyOf(item)].revision !== item.revision);
  const invalid = changes.filter((item) => !valid(value(item)));

  const refresh = useCallback(async () => {
    if (!active || document.hidden || lock.current) return;
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    setLoading(true);
    setError('');
    try {
      const result = await request('/api/slot-capacities', { signal: controller.signal });
      if (controller.signal.aborted) return;
      setItems(result.items);
      setCampus((current) =>
        result.items.some((item) => item.campus === current)
          ? current
          : result.items[0]?.campus || ''
      );
      // Reconcile facts without overwriting local input. A matching server value
      // also recovers a successful save whose response was lost.
      setDrafts((current) =>
        Object.fromEntries(
          result.items.flatMap((item) => {
            const draft = current[keyOf(item)];
            return draft && draft.value !== String(item.capacity) ? [[keyOf(item), draft]] : [];
          })
        )
      );
    } catch (failure) {
      if (!controller.signal.aborted) {
        if ([401, 403].includes(failure.status)) {
          setItems([]);
          setDrafts({});
          setUndo(null);
          setCopied('');
        }
        setError(failure.message);
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [active]);
  useEffect(() => {
    if (active) refresh();
    const visibility = () => {
      if (document.hidden) {
        reading.current?.abort();
        setLoading(false);
      } else if (active) refresh();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      reading.current?.abort();
      setLoading(false);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [active, refresh]);
  useUnsavedChanges({
    dirty: !!changes.length,
    active,
    busy,
    save,
    discard: () => {
      setDrafts({});
      setUndo(null);
      setReview(false);
      setDiscard(false);
      setError('');
    }
  });
  useEffect(() => {
    if (!active) {
      drag.current = null;
      setPreview(null);
      setEditing('');
    }
  }, [active]);

  function apply(updates, remember = true) {
    if (lock.current) return;
    if (remember) setUndo({ ...currentDrafts.current });
    setDrafts((current) => {
      const next = { ...current };
      for (const [item, nextValue] of updates) {
        if (!item) continue;
        const key = keyOf(item);
        if (nextValue === String(item.capacity)) delete next[key];
        else
          next[key] = {
            original: item.capacity,
            revision: item.revision,
            ...next[key],
            value: nextValue
          };
      }
      return next;
    });
    setMessage('');
  }
  function choose(anchor, end = anchor, focus = false) {
    setSelections((current) => ({
      ...current,
      [campus]: { anchor, end, range: gridRange(anchor, end) }
    }));
    setEditing('');
    if (focus)
      root.current
        ?.querySelector(`[data-row="${end.row}"][data-col="${end.col}"]`)
        ?.focus({ preventScroll: true });
  }
  function gridValues(range) {
    return Array.from({ length: range.bottom - range.top + 1 }, (_, row) =>
      Array.from({ length: range.right - range.left + 1 }, (_, col) =>
        value(at(row + range.top, col + range.left))
      )
    );
  }
  function applyGrid(grid, target, source, skipSource = false) {
    const updates = [];
    for (let row = target.top; row <= target.bottom; row++)
      for (let col = target.left; col <= target.right; col++) {
        if (!skipSource || !rangeContains(source, row, col))
          updates.push([at(row, col), repeatGridValue(grid, source, row, col)]);
      }
    apply(updates);
    choose({ row: target.top, col: target.left }, { row: target.bottom, col: target.right });
  }
  function copy() {
    try {
      const text = gridValues(selection.range)
        .map((row) => row.join('\t'))
        .join('\n');
      parseCapacityGrid(text);
      setCopied(text);
      setMessage('已复制，可切换校区后粘贴。');
      return text;
    } catch (failure) {
      setError(failure.message);
      return '';
    }
  }
  function paste(text) {
    try {
      const grid = parseCapacityGrid(text);
      applyGrid(grid, pasteRange(grid, selection.range), selection.range);
      setMessage('已粘贴到草稿，检查后保存。');
    } catch (failure) {
      setError(failure.message);
    }
  }
  function selectHeader(axis, index, end = index) {
    if (axis === 'all') choose({ row: 0, col: 0 }, { row: 3, col: 3 });
    else if (axis === 'col')
      choose({ row: 0, col: Math.min(index, end) }, { row: 3, col: Math.max(index, end) });
    else choose({ row: Math.min(index, end), col: 0 }, { row: Math.max(index, end), col: 3 });
  }
  function pointOf(target) {
    const cell = target.closest('[data-row][data-col]');
    return cell && root.current?.contains(cell)
      ? { row: Number(cell.dataset.row), col: Number(cell.dataset.col) }
      : null;
  }
  function pointerDown(event) {
    if (busy || event.button !== 0) return;
    const target = pointOf(event.target),
      header = event.target.closest('[data-axis]');
    if (event.target.closest('.capacity-editor-handle')) {
      event.preventDefault();
      try {
        const source = selection.range;
        const grid = parseCapacityGrid(
          gridValues(source)
            .map((row) => row.join('\t'))
            .join('\n')
        );
        drag.current = { type: 'fill', source, grid, target: source };
        setPreview(source);
        root.current.setPointerCapture(event.pointerId);
      } catch (failure) {
        setError(failure.message);
      }
      return;
    }
    if (header) {
      event.preventDefault();
      const axis = header.dataset.axis,
        index = Number(header.dataset.index || 0);
      selectHeader(axis, index);
      if (event.pointerType !== 'touch') {
        drag.current = { type: 'header', axis, index };
        root.current.setPointerCapture(event.pointerId);
      }
      return;
    }
    if (
      !target ||
      (event.target.tagName === 'INPUT' &&
        ((event.pointerType === 'touch' && !extend) ||
          editing === keyOf(at(target.row, target.col))))
    )
      return;
    event.preventDefault();
    const anchor = event.shiftKey || extend ? selection.anchor : target;
    choose(anchor, target, true);
    if (event.pointerType !== 'touch') {
      drag.current = { type: 'select', anchor };
      root.current.setPointerCapture(event.pointerId);
    }
  }
  function pointerMove(event) {
    const current = drag.current;
    if (!current) return;
    const hit = document.elementFromPoint(event.clientX, event.clientY),
      target = pointOf(hit || event.target);
    if (current.type === 'header') {
      const header = hit?.closest(`[data-axis="${current.axis}"]`);
      if (header) selectHeader(current.axis, current.index, Number(header.dataset.index || 0));
      return;
    }
    if (!target) return;
    if (current.type === 'select') choose(current.anchor, target);
    else {
      const source = current.source;
      const vertical = Math.max(source.top - target.row, target.row - source.bottom, 0),
        horizontal = Math.max(source.left - target.col, target.col - source.right, 0);
      current.target =
        vertical >= horizontal
          ? {
              ...source,
              top: Math.min(source.top, target.row),
              bottom: Math.max(source.bottom, target.row)
            }
          : {
              ...source,
              left: Math.min(source.left, target.col),
              right: Math.max(source.right, target.col)
            };
      setPreview(current.target);
    }
  }
  function endDrag(event, commit) {
    const current = drag.current;
    drag.current = null;
    setPreview(null);
    if (root.current?.hasPointerCapture(event.pointerId))
      root.current.releasePointerCapture(event.pointerId);
    if (commit && current?.type === 'fill')
      applyGrid(current.grid, current.target, current.source, true);
  }
  function edit(point, digit) {
    const item = at(point.row, point.col);
    choose(point);
    setEditing(keyOf(item));
    if (digit !== undefined) apply([[item, digit]]);
    requestAnimationFrame(() => {
      const input = root.current?.querySelector(
        `[data-row="${point.row}"][data-col="${point.col}"] input`
      );
      input?.focus();
      if (digit === undefined) input?.select();
    });
  }
  function keyDown(event) {
    if (busy || event.target.closest('[data-axis]')) return;
    const point = selection.end,
      modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 'a' && !editing) {
      event.preventDefault();
      selectHeader('all');
      return;
    }
    if (modifier && event.key.toLowerCase() === 'z' && !editing) {
      event.preventDefault();
      if (undo) {
        setDrafts(undo);
        setUndo(null);
      }
      return;
    }
    if (modifier || event.altKey) return;
    if (event.key === 'Escape') {
      setEditing('');
      choose(point, point, true);
      return;
    }
    const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    // Tab traverses cells but leaves the sheet at either boundary; keyboard
    // users must still be able to reach the following actions without a mouse.
    if (
      event.key === 'Tab' &&
      (event.shiftKey ? point.row === 0 && point.col === 0 : point.row === 3 && point.col === 3)
    ) {
      setEditing('');
      return;
    }
    if ((!editing && arrows[event.key]) || ['Enter', 'Tab'].includes(event.key)) {
      event.preventDefault();
      let end;
      if (event.key === 'Tab') {
        const index = (point.row * 4 + point.col + (event.shiftKey ? 15 : 1)) % 16;
        end = { row: Math.floor(index / 4), col: index % 4 };
      } else if (event.key === 'Enter')
        end = { ...point, row: (point.row + (event.shiftKey ? 3 : 1)) % 4 };
      else
        end = {
          row: Math.max(0, Math.min(3, point.row + arrows[event.key][0])),
          col: Math.max(0, Math.min(3, point.col + arrows[event.key][1]))
        };
      choose(event.shiftKey && arrows[event.key] ? selection.anchor : end, end, true);
    } else if (!editing && (event.key === 'F2' || /^\d$/.test(event.key))) {
      event.preventDefault();
      edit(point, event.key === 'F2' ? undefined : event.key);
    } else if (!editing && ['Backspace', 'Delete'].includes(event.key)) {
      event.preventDefault();
      applyGrid([['0']], selection.range, selection.range);
    }
  }
  function quickFill(event) {
    event.preventDefault();
    if (!valid(bulk)) {
      setError('请输入不小于 0 的安全整数人数。');
      return;
    }
    if (scope === 'selection')
      applyGrid([[String(Number(bulk))]], selection.range, selection.range);
    else
      apply(
        items
          .filter((item) => item.campus === campus && (scope === 'week' || item.weekday === day))
          .map((item) => [item, String(Number(bulk))])
      );
  }
  function copyDay(target) {
    const source = new Map(
      items
        .filter((item) => item.campus === campus && item.weekday === day)
        .map((item) => [item.timeSlot, value(item)])
    );
    apply(
      items
        .filter(
          (item) =>
            item.campus === campus &&
            item.weekday !== day &&
            (target === 'all' || item.weekday === Number(target))
        )
        .map((item) => [item, source.get(item.timeSlot)])
    );
    setMessage('已复制到其他日期的草稿。');
  }
  async function save() {
    if (lock.current || conflicts.length || invalid.length || !changes.length) return;
    lock.current = true;
    reading.current?.abort();
    setLoading(false);
    setBusy(true);
    setError('');
    try {
      const result = await request('/api/slot-capacities', {
        method: 'PATCH',
        body: { items: changes.map((item) => ({ ...item, capacity: Number(value(item)) })) }
      });
      const saved = new Map(result.items.map((item) => [keyOf(item), item]));
      setItems((current) => current.map((item) => saved.get(keyOf(item)) || item));
      setDrafts((current) =>
        Object.fromEntries(Object.entries(current).filter(([key]) => !saved.has(key)))
      );
      setUndo(null);
      setReview(false);
      setRevision((current) => current + 1);
      setMessage(`已保存 ${result.items.length} 项。已形成快照的日期保持原容量。`);
      return true;
    } catch (failure) {
      setReview(false);
      setError(
        failure.status === 409
          ? '配置已被其他人更新，请核对最新值和你的草稿后再保存。'
          : `${failure.message}。草稿已保留，正在核对保存结果。`
      );
      // Refresh only after unlocking, and merge matching values instead of
      // resending a write whose result may be uncertain.
      lock.current = false;
      await refresh();
      setError(
        failure.status === 409
          ? '配置已被其他人更新，请在冲突区逐项核对后再保存。'
          : `${failure.message}。已尝试读取最新值；未确认的修改仍保留。`
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function reconcile(item, keep) {
    setDrafts((current) => {
      const next = { ...current },
        key = keyOf(item);
      if (keep) next[key] = { ...next[key], revision: item.revision, original: item.capacity };
      else delete next[key];
      return next;
    });
    setUndo(null);
  }

  return (
    <div className="capacity-editor">
      <WorkspaceSections
        label="预约配置视图"
        items={[
          { id: 'template', label: '每周模板' },
          { id: 'actual', label: '日期实际容量' },
          { id: 'locations', label: '维修地点' },
          { id: 'serviceDays', label: '暂停日期' }
        ]}
        value={mode}
        onChange={setMode}
      />
      <div className="capacity-context">
        <div className="capacity-campus-switch" aria-label="选择校区">
          {campuses.map((name) => (
            <button
              key={name}
              aria-pressed={campus === name}
              disabled={busy}
              onClick={() => {
                setCampus(name);
                setEditing('');
              }}
            >
              {name}校区
              {changes.some((item) => item.campus === name) && (
                <span className="capacity-draft-dot" aria-label="有未保存修改" />
              )}
            </button>
          ))}
        </div>
        {mode !== 'locations' && (
          <button disabled={loading || busy} onClick={refresh}>
            {loading ? '正在读取…' : '读取最新配置'}
          </button>
        )}
      </div>
      <Notice>{error}</Notice>
      <p className="workspace-update" role="status">
        {mode === 'template'
          ? message || (loading ? '正在更新，保留当前草稿与选区…' : '容量为 0 时暂停该时段预约。')
          : ''}
      </p>
      {!items.length && !loading && <p>暂无可编辑的校区配置。</p>}
      <div hidden={mode !== 'template' || !campus}>
        <section className="field-card capacity-template">
          <div className="capacity-section-heading">
            <div>
              <h2>每周预约人数</h2>
              <p className="field-muted">调整周一至周四的四个半小时时段。工作人员排班单独维护。</p>
            </div>
            <span className="capacity-template-badge">每周重复</span>
          </div>
          <div className="capacity-mobile-days" aria-label="模板日期">
            {days.map((name, index) => (
              <button key={name} aria-pressed={day === index + 1} onClick={() => setDay(index + 1)}>
                {name}
              </button>
            ))}
          </div>
          <div className="capacity-sheet-tools">
            <span>
              已选 {selection.range.bottom - selection.range.top + 1} 行 ×{' '}
              {selection.range.right - selection.range.left + 1} 列
            </span>
            <div>
              <button disabled={busy} onClick={() => selectHeader('all')}>
                全选
              </button>
              <button
                disabled={busy || !items.length}
                onClick={() => {
                  const text = copy();
                  if (text) navigator.clipboard?.writeText(text).catch(() => {});
                }}
              >
                复制选区
              </button>
              <button disabled={busy || !copied} onClick={() => paste(copied)}>
                粘贴
              </button>
              <button disabled={busy} aria-pressed={extend} onClick={() => setExtend(!extend)}>
                扩展选区
              </button>
            </div>
          </div>
          <div
            className="capacity-sheet-desktop"
            ref={root}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={(event) => endDrag(event, true)}
            onPointerCancel={(event) => endDrag(event, false)}
            onLostPointerCapture={(event) => endDrag(event, false)}
            onKeyDown={keyDown}
            onCopy={(event) => {
              if (!editing) {
                const text = copy();
                if (text) {
                  event.preventDefault();
                  event.clipboardData.setData('text/plain', text);
                }
              }
            }}
            onPaste={(event) => {
              if (!busy) {
                event.preventDefault();
                paste(event.clipboardData.getData('text/plain'));
              }
            }}
          >
            <table role="grid" aria-label={`${campus}每周预约人数`}>
              <thead>
                <tr>
                  <th>
                    <button
                      data-axis="all"
                      aria-label="选择全部时段"
                      onClick={(event) => {
                        if (event.detail === 0) selectHeader('all');
                      }}
                    >
                      时段 / 日期
                    </button>
                  </th>
                  {days.map((name, col) => (
                    <th key={name}>
                      <button
                        data-axis="col"
                        data-index={col}
                        aria-label={`选择${name}整列`}
                        onClick={(event) => {
                          if (event.detail === 0) selectHeader('col', col);
                        }}
                      >
                        {name}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TIME_SLOTS.map((slot, row) => (
                  <tr key={slot}>
                    <th scope="row">
                      <button
                        data-axis="row"
                        data-index={row}
                        aria-label={`选择${slot}整行`}
                        onClick={(event) => {
                          if (event.detail === 0) selectHeader('row', row);
                        }}
                      >
                        {slot}
                      </button>
                    </th>
                    {days.map((_, col) => {
                      const item = at(row, col);
                      if (!item) return <td key={col} />;
                      const key = keyOf(item),
                        selected = rangeContains(selection.range, row, col),
                        filling = preview && rangeContains(preview, row, col);
                      return (
                        <td
                          key={key}
                          role="gridcell"
                          data-row={row}
                          data-col={col}
                          aria-label={label(item)}
                          aria-selected={selected}
                          tabIndex={selection.end.row === row && selection.end.col === col ? 0 : -1}
                          className={`${selected ? 'is-selected' : ''} ${filling ? 'is-fill-preview' : ''} ${drafts[key] ? 'is-dirty' : ''}`}
                          onDoubleClick={() => edit({ row, col })}
                        >
                          <input
                            aria-label={`${label(item)} 预约人数`}
                            inputMode="numeric"
                            type="text"
                            value={value(item)}
                            disabled={busy}
                            tabIndex={-1}
                            aria-invalid={!valid(value(item))}
                            onFocus={() => {
                              setEditing(key);
                              setSelections((current) => ({
                                ...current,
                                [campus]: {
                                  anchor: { row, col },
                                  end: { row, col },
                                  range: gridRange({ row, col }, { row, col })
                                }
                              }));
                            }}
                            onBlur={() => setEditing('')}
                            onChange={(event) => apply([[item, event.target.value]])}
                          />
                          {selected &&
                            row === selection.range.bottom &&
                            col === selection.range.right &&
                            !busy && (
                              <button
                                className="capacity-editor-handle"
                                tabIndex={-1}
                                aria-label="拖动复制选区人数"
                              />
                            )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>当日总名额</th>
                  {days.map((_, col) => (
                    <td key={col}>
                      {TIME_SLOTS.every((_, row) => at(row, col) && valid(value(at(row, col))))
                        ? TIME_SLOTS.reduce(
                            (sum, _, row) => sum + Number(value(at(row, col))),
                            0
                          ).toLocaleString()
                        : '—'}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="capacity-mobile-inputs">
            {items
              .filter((item) => item.campus === campus && item.weekday === day)
              .map((item) => (
                <label key={keyOf(item)}>
                  <span>
                    {item.timeSlot}
                    <small>{drafts[keyOf(item)] ? `原名额 ${item.capacity}` : '预约人数'}</small>
                  </span>
                  <input
                    aria-label={`${label(item)} 预约人数`}
                    inputMode="numeric"
                    value={value(item)}
                    disabled={busy}
                    aria-invalid={!valid(value(item))}
                    onChange={(event) => apply([[item, event.target.value]])}
                  />
                </label>
              ))}
          </div>
          <p className="capacity-sheet-hint field-muted">
            点击选格，双击或键入数字编辑；支持 Shift 多选、拖动填充、Ctrl C / V 和跨校区复制。
          </p>
          <details className="capacity-quick-tools">
            <summary>批量填写与复制</summary>
            <form onSubmit={quickFill}>
              <label>
                统一人数
                <input
                  aria-label="统一人数"
                  inputMode="numeric"
                  value={bulk}
                  onChange={(event) => setBulk(event.target.value)}
                  disabled={busy}
                />
              </label>
              <label>
                填写范围
                <select
                  value={scope}
                  onChange={(event) => setScope(event.target.value)}
                  disabled={busy}
                >
                  <option value="selection">当前表格选区</option>
                  <option value="day">{days[day - 1]}四个时段</option>
                  <option value="week">当前校区整周</option>
                </select>
              </label>
              <button disabled={busy}>填入草稿</button>
            </form>
            <div className="capacity-copy-tools">
              <label>
                复制日期
                <select
                  value={day}
                  onChange={(event) => setDay(Number(event.target.value))}
                  disabled={busy}
                >
                  {days.map((name, index) => (
                    <option key={name} value={index + 1}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                复制到日期
                <select
                  value={dayTarget === String(day) ? 'all' : dayTarget}
                  onChange={(event) => setDayTarget(event.target.value)}
                  disabled={busy}
                >
                  <option value="all">其他三天</option>
                  {days.map(
                    (name, index) =>
                      index + 1 !== day && (
                        <option key={name} value={index + 1}>
                          {name}
                        </option>
                      )
                  )}
                </select>
              </label>
              <button
                disabled={busy}
                onClick={() => copyDay(dayTarget === String(day) ? 'all' : dayTarget)}
              >
                复制日期人数
              </button>
            </div>
            {campuses.length > 1 && (
              <div className="capacity-copy-tools">
                <label>
                  目标校区
                  <select
                    value={
                      copyTarget && copyTarget !== campus
                        ? copyTarget
                        : campuses.find((name) => name !== campus) || ''
                    }
                    onChange={(event) => setCopyTarget(event.target.value)}
                    disabled={busy}
                  >
                    {campuses
                      .filter((name) => name !== campus)
                      .map((name) => (
                        <option key={name}>{name}</option>
                      ))}
                  </select>
                </label>
                <button
                  disabled={busy}
                  onClick={() => {
                    const target =
                      campuses.includes(copyTarget) && copyTarget !== campus
                        ? copyTarget
                        : campuses.find((name) => name !== campus);
                    apply(
                      items
                        .filter((item) => item.campus === target)
                        .map((item) => [
                          item,
                          value(
                            items.find(
                              (source) =>
                                source.campus === campus &&
                                source.weekday === item.weekday &&
                                source.timeSlot === item.timeSlot
                            )
                          )
                        ])
                    );
                    setMessage('已复制整周到目标校区草稿。');
                  }}
                >
                  复制整周到目标校区
                </button>
              </div>
            )}
          </details>
        </section>
        <p className="capacity-effect-note">
          生效规则：每个校区、日期首次产生预约时，会固定当天全部时段的容量。模板修改仅影响尚未形成快照的日期，已有快照不会改变。
        </p>
      </div>
      <ActivityContext.Provider value={active && mode === 'actual'}>
        <div hidden={mode !== 'actual'}>
          {campus && (
            <ActualDayCapacity campus={campus} revision={revision} onNavigate={onNavigate} />
          )}
        </div>
      </ActivityContext.Provider>
      <ActivityContext.Provider value={active && mode === 'serviceDays'}>
        <div hidden={mode !== 'serviceDays'}>
          {campus && <ServiceDayEditor campus={campus} onNavigate={onNavigate} />}
        </div>
      </ActivityContext.Provider>
      <ActivityContext.Provider value={active && mode === 'locations'}>
        <div hidden={mode !== 'locations'}>
          {campus && <ServiceLocationEditor campus={campus} />}
        </div>
      </ActivityContext.Provider>
      {conflicts.length > 0 && (
        <section className="field-card capacity-conflicts" aria-label="配置冲突">
          <h2>核对其他人的修改</h2>
          <p>以下格子在你编辑期间已更新。草稿完整保留，逐项选择后再保存。</p>
          {conflicts.map((item) => (
            <article key={keyOf(item)}>
              <strong>{label(item)}</strong>
              <div>
                <span>编辑前 {drafts[keyOf(item)].original}</span>
                <span>
                  最新值 <b>{item.capacity}</b>
                </span>
                <span>
                  我的草稿 <b>{value(item) || '空白'}</b>
                </span>
              </div>
              <div className="field-actions">
                <button disabled={busy} onClick={() => reconcile(item, false)}>
                  使用最新值
                </button>
                <button disabled={busy} onClick={() => reconcile(item, true)}>
                  保留我的修改
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
      {!!changes.length && (
        <footer className="capacity-save-bar">
          <div>
            <strong>{changes.length} 项待保存</strong>
            <span>
              {conflicts.length
                ? `${conflicts.length} 项冲突待核对`
                : invalid.length
                  ? `${invalid.length} 项人数格式不正确`
                  : '切换页面前请选择保存或丢弃改动。'}
            </span>
          </div>
          <div className="field-actions">
            <button
              disabled={busy || !undo}
              onClick={() => {
                setDrafts(undo);
                setUndo(null);
              }}
            >
              撤销上一步
            </button>
            <button disabled={busy} onClick={() => setDiscard(true)}>
              放弃修改
            </button>
            <button
              className="field-primary"
              disabled={busy || !!conflicts.length || !!invalid.length}
              onClick={() => setReview(true)}
            >
              预览并保存
            </button>
          </div>
        </footer>
      )}
      {review && (
        <Modal
          title="确认预约人数调整"
          dismissible={!busy}
          onClose={() => {
            if (!busy) setReview(false);
          }}
        >
          <p>保存全部校区的 {changes.length} 项修改；已有日期快照保持不变。</p>
          <div className="capacity-review-list">
            {changes.map((item) => (
              <div key={keyOf(item)}>
                <span>{label(item)}</span>
                <strong>
                  {item.capacity} → {value(item)} 名
                </strong>
              </div>
            ))}
          </div>
          <div className="field-actions">
            <button disabled={busy} onClick={() => setReview(false)}>
              返回编辑
            </button>
            <button
              className="field-primary"
              disabled={busy || !!conflicts.length || !!invalid.length}
              onClick={save}
            >
              {busy ? '正在保存…' : '确认保存全部修改'}
            </button>
          </div>
        </Modal>
      )}
      {discard && (
        <Modal title="放弃全部未保存修改？" onClose={() => setDiscard(false)}>
          <p>所有校区的未保存人数将恢复为最近读取的配置。</p>
          <div className="field-actions">
            <button onClick={() => setDiscard(false)}>继续编辑</button>
            <button
              onClick={() => {
                setDrafts({});
                setUndo(null);
                setDiscard(false);
                setError('');
              }}
            >
              确认放弃修改
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
