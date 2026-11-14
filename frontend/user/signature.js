import { $ } from '/shared/utils.js';
import { validSignature } from '/shared/signature.js';
import { createSignaturePad, createSignaturePreview } from '/shared/signature-pad.js';
import { dialogController } from './dialogs.js';

export function initSignature() {
  const modal = $('#signature-modal'),
    canvas = $('#signature-canvas'),
    confirmed = $('#confirmed-signature');
  let signed = null,
    pad = null,
    preview = null;
  const dialog = dialogController(modal, {
    onClose() {
      pad?.dispose();
      pad = null;
    }
  });
  const listeners = [];
  function listen(selector, handler) {
    const element = $(selector);
    element.addEventListener('click', handler);
    listeners.push(() => element.removeEventListener('click', handler));
  }
  function showError(message) {
    $('#signature-error').textContent = message;
  }
  function open() {
    pad?.dispose();
    showError('');
    dialog.open();
    pad = createSignaturePad(canvas, { onError: showError });
  }
  listen('#clear-signature', () => pad?.clear());
  listen('#undo-signature', () => pad?.undo());
  listen('#cancel-signature', dialog.close);
  listen('#confirm-signature', () => {
    const value = pad?.value();
    if (!validSignature(value)) {
      showError('请完整手写本人姓名，不能留白或只点一下。');
      return;
    }
    signed = value;
    preview?.dispose();
    confirmed.hidden = false;
    preview = createSignaturePreview(confirmed, signed);
    $('#signature-status').textContent = '已完成手写签名。';
    $('[data-error-for=signature]').textContent = '';
    $('#open-signature').removeAttribute('aria-invalid');
    $('#open-signature').textContent = '重新手写签名';
    dialog.close();
  });
  listen('#open-signature', open);
  return {
    open,
    value: () => signed,
    reset() {
      dialog.close();
      preview?.dispose();
      preview = null;
      signed = null;
      confirmed.hidden = true;
      $('#signature-status').textContent = '尚未完成手写签名。';
      $('#open-signature').textContent = '手写本人姓名';
    },
    dispose() {
      dialog.dispose();
      preview?.dispose();
      listeners.forEach((remove) => remove());
    }
  };
}
