import { $, showToast } from '/shared/utils.js';
import { validSignature, drawSignature } from '/shared/signature.js';

export function initSignature() {
  const modal = $('#signature-modal'), canvas = $('#signature-canvas'), checkbox = $('[name="agreement"]');
  let strokes = [], signed = null, pointer = null, previousFocus;
  const point = event => {
    const rect = canvas.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))];
  };
  function close() { modal.hidden = true; pointer = null; previousFocus?.focus(); }
  function open() {
    previousFocus = document.activeElement; checkbox.checked = false; signed = null; strokes = [];
    $('#signature-status').textContent = '请先手写签名，确认后才能提交预约。';
    modal.hidden = false; drawSignature(canvas, strokes); $('#clear-signature').focus();
  }
  canvas.addEventListener('pointerdown', event => {
    if (pointer !== null) return;
    pointer = event.pointerId; canvas.setPointerCapture(pointer); strokes.push([point(event)]);
  });
  canvas.addEventListener('pointermove', event => {
    if (pointer !== event.pointerId) return;
    strokes.at(-1).push(point(event)); drawSignature(canvas, strokes);
  });
  function finish(event) {
    if (event.pointerId !== pointer) return;
    if (strokes.at(-1).length < 2) strokes.pop();
    pointer = null;
  }
  canvas.addEventListener('pointerup', finish); canvas.addEventListener('pointercancel', finish);
  $('#clear-signature').addEventListener('click', () => { strokes = []; pointer = null; drawSignature(canvas, strokes); });
  $('#cancel-signature').addEventListener('click', close);
  $('#confirm-signature').addEventListener('click', () => {
    if (!validSignature(strokes)) { showToast('请在签名框内完整手写本人姓名，不能留白或只点一下'); return; }
    signed = structuredClone(strokes); checkbox.checked = true;
    $('#signature-status').textContent = '已完成手写签名；取消勾选后可重新签名。'; close();
  });
  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const buttons = [...modal.querySelectorAll('button')], first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) open();
    else { signed = null; $('#signature-status').textContent = '同意协议后需手写本人姓名，请提前准备。'; }
  });
  return { open, value: () => checkbox.checked ? signed : null };
}
