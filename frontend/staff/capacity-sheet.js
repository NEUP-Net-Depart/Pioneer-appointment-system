import { gridRange, rangeContains, parseCapacityGrid, pasteRange, repeatGridValue } from '/shared/capacity-grid.js';

// A small, fixed 4×4 sheet: no canvas, timers or spreadsheet runtime.
export function initCapacitySheet({ root, toolbar, campus, disabled, beforeChange, afterChange, notify, undo }) {
  const status = toolbar.querySelector('[data-sheet-status]');
  const copyButton = toolbar.querySelector('[data-sheet-copy]'), pasteButton = toolbar.querySelector('[data-sheet-paste]');
  const extendButton = toolbar.querySelector('[data-sheet-extend]');
  const selections = new Map();
  let copied = '', drag = null, extending = false, edit = null;
  let scrollFrame = 0, pointerPosition = null;
  const group = () => [...root.children].find(element => element.dataset.campus === campus());
  const cells = () => [...(group()?.querySelectorAll('.capacity-row') || [])];
  const coordinate = cell => ({ row:Number(cell.dataset.sheetRow), col:Number(cell.dataset.weekday) - 1 });
  const cellAt = (row,col) => cells().find(cell => Number(cell.dataset.sheetRow) === row && Number(cell.dataset.weekday) === col + 1);
  const selection = () => selections.get(campus());
  const inputAt = (row,col) => cellAt(row,col)?.querySelector('input');
  const scoped = event => Boolean(group()?.contains(event.target));
  const editing = () => group()?.querySelector('.is-editing input') === document.activeElement;

  function paint() {
    root.classList.toggle('is-extending',extending);
    const current = selection(), range = current?.range, preview = drag?.preview;
    for (const cell of root.querySelectorAll('.capacity-row')) {
      const { row,col } = coordinate(cell), visible = cell.dataset.campus === campus();
      const selected = Boolean(visible && range && rangeContains(range,row,col));
      const effective = preview || range;
      cell.classList.toggle('is-selected',selected);
      cell.setAttribute('aria-selected',String(selected));
      cell.classList.toggle('is-active',Boolean(visible && current && row === current.end.row && col === current.end.col));
      cell.classList.toggle('is-fill-preview',Boolean(visible && preview && rangeContains(preview,row,col) && !selected));
      for (const [edge,test] of Object.entries({ top:row === effective?.top,bottom:row === effective?.bottom,left:col === effective?.left,right:col === effective?.right })) {
        cell.classList.toggle(`selection-${edge}`,Boolean(visible && effective && rangeContains(effective,row,col) && test));
      }
      let handle = cell.querySelector('.capacity-fill-handle');
      const showHandle = visible && range && row === range.bottom && col === range.right && !disabled();
      if (showHandle && !handle) {
        handle = document.createElement('button'); handle.type = 'button'; handle.className = 'capacity-fill-handle';
        handle.tabIndex = -1; handle.setAttribute('aria-label','拖动复制选区人数'); handle.title = '拖动复制选区人数'; cell.append(handle);
      }
      if (handle) handle.hidden = !showHandle;
    }
    for (const header of group()?.querySelectorAll('[data-sheet-header]') || []) {
      const axis = header.dataset.sheetHeader, index = Number(header.dataset.sheetIndex);
      const selected = range && (axis === 'all' ? range.top === 0 && range.bottom === 3 && range.left === 0 && range.right === 3 : axis === 'row' ? index >= range.top && index <= range.bottom : index >= range.left && index <= range.right);
      header.setAttribute('aria-pressed',String(Boolean(selected)));
    }
    status.textContent = range ? `已选 ${range.bottom - range.top + 1} 行 × ${range.right - range.left + 1} 列${extending ? ' · 点击另一格扩展选区' : copied ? ' · 已复制，可切换校区粘贴' : ''}` : extending ? '点击起点和终点框选区域' : '点击选择 · 双击或直接键入修改';
    copyButton.disabled = disabled() || !range;
    // Keyboard paste also supports text from Excel; this button uses the sheet's copied values.
    pasteButton.disabled = disabled() || !range || !copied;
    extendButton.disabled = disabled(); extendButton.setAttribute('aria-pressed',String(extending));
  }
  function endEditing() {
    edit = null;
    for (const cell of root.querySelectorAll('.is-editing')) cell.classList.remove('is-editing');
  }
  function select(anchor,end = anchor,focus = true) {
    endEditing(); selections.set(campus(),{ anchor,end,range:gridRange(anchor,end) });
    paint(); if (focus) cellAt(end.row,end.col)?.focus({ preventScroll:true });
  }
  function values(range) {
    return Array.from({ length:range.bottom - range.top + 1 },(_,row) =>
      Array.from({ length:range.right - range.left + 1 },(_,col) => inputAt(range.top + row,range.left + col).value));
  }
  function copyText() {
    const range = selection()?.range;
    if (!range) return '';
    const text = values(range).map(row => row.join('\t')).join('\n');
    parseCapacityGrid(text); copied = text; paint(); return text;
  }
  function apply(grid,target,source,skipSource = false) {
    if (disabled()) return;
    const changes = [];
    for (let row = target.top; row <= target.bottom; row++) for (let col = target.left; col <= target.right; col++) {
      if (skipSource && rangeContains(source,row,col)) continue;
      const input = inputAt(row,col), value = repeatGridValue(grid,source,row,col);
      if (input.value !== value) changes.push({ input,value });
    }
    if (changes.length) { beforeChange(); for (const { input,value } of changes) { input.value = value; input.setCustomValidity(''); } }
    select({ row:target.top,col:target.left },{ row:target.bottom,col:target.right });
    if (changes.length) afterChange();
  }
  function paste(text) {
    const range = selection()?.range;
    if (!range || disabled()) return;
    try {
      const grid = parseCapacityGrid(text), target = pasteRange(grid,range);
      apply(grid,target,range); notify('已粘贴到草稿，检查后保存');
    } catch (error) { notify(error.message); }
  }
  function startEditing(cell,value) {
    if (!cell || disabled()) return;
    const point = coordinate(cell); select(point,point,false); cell.classList.add('is-editing');
    const input = cell.querySelector('input'); input.focus({ preventScroll:true });
    if (value !== undefined) { input.value = value; input.dispatchEvent(new Event('input',{ bubbles:true })); }
    else input.select();
  }
  function hit(target) {
    if (!group()?.contains(target)) return null;
    const cell = target.closest('.capacity-row');
    if (cell) return { point:coordinate(cell),axis:'cell' };
    const header = target.closest('[data-sheet-header]');
    if (!header) return null;
    const axis = header.dataset.sheetHeader, index = Number(header.dataset.sheetIndex);
    return { point:{ row:axis === 'row' ? index : 0,col:axis === 'col' ? index : 0 },axis };
  }
  function headerRange(start,end,axis) {
    if (axis === 'all') return { top:0,bottom:3,left:0,right:3 };
    const range = gridRange(start,end);
    return axis === 'row' ? { ...range,left:0,right:3 } : { ...range,top:0,bottom:3 };
  }
  function selectHeader(start,end,axis) {
    const range = headerRange(start,end,axis);
    select({ row:range.top,col:range.left },{ row:range.bottom,col:range.right },false);
  }
  root.addEventListener('pointerdown',event => {
    if (disabled() || event.button !== 0) return;
    const target = hit(event.target); if (!target) return;
    if (event.target.closest('.capacity-fill-handle')) {
      event.preventDefault();
      try {
        const source = { ...selection().range }, grid = parseCapacityGrid(values(source).map(row => row.join('\t')).join('\n'));
        endEditing(); drag = { mode:'fill',id:event.pointerId,source,grid,preview:source };
        root.setPointerCapture(event.pointerId);
      } catch (error) { notify(error.message); }
      return;
    }
    if (event.target.matches('input') && (event.pointerType === 'touch' && !extending || event.target.closest('.is-editing'))) return;
    event.preventDefault();
    const start = (event.shiftKey || extending) && selection() ? selection().anchor : target.point;
    if (target.axis === 'cell') select(start,target.point);
    else selectHeader(start,target.point,target.axis);
    // Touch taps select without hijacking the page's scrolling gestures.
    if (event.pointerType !== 'touch') {
      drag = { mode:'select',id:event.pointerId,start,axis:target.axis };
      root.setPointerCapture(event.pointerId);
    }
  });
  function updateDrag(x,y) {
    if (!drag || disabled()) return;
    const target = hit(document.elementFromPoint(x,y)); if (!target) return;
    if (drag.mode === 'select') {
      if (drag.axis === 'cell') select(drag.start,target.point,false);
      else selectHeader(drag.start,target.point,drag.axis);
    } else {
      const { source } = drag, { row,col } = target.point;
      const vertical = Math.max(source.top - row,row - source.bottom,0), horizontal = Math.max(source.left - col,col - source.right,0);
      drag.preview = vertical >= horizontal ? { ...source,top:Math.min(source.top,row),bottom:Math.max(source.bottom,row) } : { ...source,left:Math.min(source.left,col),right:Math.max(source.right,col) };
      paint();
    }
  }
  function scrollAtEdge() {
    scrollFrame = 0;
    if (!drag || !pointerPosition || disabled()) return;
    const rect = group()?.querySelector('table').getBoundingClientRect(); if (!rect) return;
    const { x,y } = pointerPosition;
    if (x < rect.left || x > rect.right) return;
    const speed = y > innerHeight - 40 && rect.bottom > innerHeight - 40 ? 10 : y < 100 && rect.top < 100 ? -10 : 0;
    if (!speed) return;
    const position = window.scrollY; window.scrollBy({ top:speed,behavior:'instant' });
    updateDrag(x,y);
    if (window.scrollY !== position) scrollFrame = requestAnimationFrame(scrollAtEdge);
  }
  root.addEventListener('pointermove',event => {
    if (!drag || drag.id !== event.pointerId) return;
    pointerPosition = { x:event.clientX,y:event.clientY }; updateDrag(event.clientX,event.clientY);
    if (!scrollFrame) scrollFrame = requestAnimationFrame(scrollAtEdge);
  });
  function stopDrag(applyFill) {
    cancelAnimationFrame(scrollFrame); scrollFrame = 0; pointerPosition = null;
    const current = drag; drag = null;
    if (!current) return;
    if (root.hasPointerCapture(current.id)) root.releasePointerCapture(current.id);
    if (current.mode === 'fill' && applyFill && !disabled()) apply(current.grid,current.preview,current.source,true);
    else { paint(); const end = selection()?.end; if (end) cellAt(end.row,end.col)?.focus({ preventScroll:true }); }
  }
  root.addEventListener('pointerup',() => stopDrag(true));
  root.addEventListener('pointercancel',() => stopDrag(false));
  root.addEventListener('lostpointercapture',() => stopDrag(false));
  root.addEventListener('dblclick',event => startEditing(event.target.closest('.capacity-row')));
  root.addEventListener('click',event => {
    const target = hit(event.target);
    if (!disabled() && event.detail === 0 && target && target.axis !== 'cell') {
      selectHeader(target.point,target.point,target.axis); const end = selection().end; cellAt(end.row,end.col)?.focus({ preventScroll:true });
    }
  });
  root.addEventListener('focusin',event => {
    const cell = event.target.closest('.capacity-row'); if (!cell || !event.target.matches('input')) return;
    const point = coordinate(cell); selections.set(campus(),{ anchor:point,end:point,range:gridRange(point,point) });
    const previousEdit = edit?.input === event.target ? edit : { input:event.target,value:event.target.value };
    endEditing(); edit = previousEdit; cell.classList.add('is-editing'); paint();
  });
  root.addEventListener('focusout',event => {
    if (event.target.matches('.capacity-row input')) {
      event.target.closest('.capacity-row').classList.remove('is-editing'); if (edit?.input === event.target) edit = null;
    }
  });
  root.addEventListener('keydown',event => {
    if (!scoped(event) || disabled()) return;
    if (event.target.closest('[data-sheet-header]')) return;
    const current = selection(); if (!current) return;
    const modifier = event.ctrlKey || event.metaKey, key = event.key;
    if (key === 'Escape') {
      event.preventDefault(); stopDrag(false);
      if (edit) { edit.input.value = edit.value; edit.input.dispatchEvent(new Event('input',{ bubbles:true })); }
      endEditing(); cellAt(current.end.row,current.end.col)?.focus(); return;
    }
    if (modifier && key.toLowerCase() === 'a' && !editing()) { event.preventDefault(); select({ row:0,col:0 },{ row:3,col:3 }); return; }
    if (modifier && key.toLowerCase() === 'z' && !editing()) { event.preventDefault(); undo(); return; }
    if (modifier || event.altKey) return;
    if (key === 'F2') { event.preventDefault(); startEditing(cellAt(current.end.row,current.end.col)); return; }
    if (key === 'Enter' || key === 'Tab' || (!editing() && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(key))) {
      event.preventDefault();
      const end = { ...current.end };
      if (key === 'Enter') end.row = (end.row + (event.shiftKey ? 3 : 1)) % 4;
      else if (key === 'Tab') { const index = (end.row * 4 + end.col + (event.shiftKey ? 15 : 1)) % 16; end.row = Math.floor(index / 4); end.col = index % 4; }
      else { end.row = Math.max(0,Math.min(3,end.row + (key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0))); end.col = Math.max(0,Math.min(3,end.col + (key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0))); }
      select(event.shiftKey && key.startsWith('Arrow') ? current.anchor : end,end); return;
    }
    if (!editing() && /^\d$/.test(key)) { event.preventDefault(); startEditing(cellAt(current.end.row,current.end.col),key); }
    if (!editing() && (key === 'Delete' || key === 'Backspace')) { event.preventDefault(); apply([['0']],current.range,current.range); }
  });
  root.addEventListener('copy',event => {
    if (!scoped(event) || editing() || disabled()) return;
    try { const text = copyText(); if (text) { event.preventDefault(); event.clipboardData.setData('text/plain',text); notify('已复制，可切换校区粘贴'); } }
    catch (error) { event.preventDefault(); notify(error.message); }
  });
  root.addEventListener('paste',event => {
    if (!scoped(event) || disabled()) return;
    event.preventDefault(); paste(event.clipboardData.getData('text/plain'));
  });
  copyButton.addEventListener('click',() => {
    try {
      const text = copyText(); if (!text) return;
      // The internal buffer works even when the browser denies clipboard access.
      if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(text).catch(() => {});
      notify('已复制，可切换校区后点击粘贴');
    } catch (error) { notify(error.message); }
  });
  pasteButton.addEventListener('click',() => paste(copied));
  toolbar.querySelector('[data-sheet-all]').addEventListener('click',() => { if (!disabled()) select({ row:0,col:0 },{ row:3,col:3 }); });
  extendButton.addEventListener('click',() => { extending = !extending; paint(); });
  return {
    refresh() { if (drag && (disabled() || !group())) stopDrag(false); paint(); },
    clear() { stopDrag(false); endEditing(); selections.clear(); copied = ''; extending = false; paint(); }
  };
}
