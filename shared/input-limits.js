// Keep the full value so users can correct an overlong paste themselves.
function controls(root) {
  const selector = 'input[data-max-length],textarea[data-max-length]';
  return [...(root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector)];
}
const feedback = new WeakMap();
function update(control) {
  let target = feedback.get(control);
  if (!target) {
    target = document.createElement('span');
    target.className = 'input-length-error';
    target.id = `length-error-${control.id || control.name}`;
    target.setAttribute('role', 'alert');
    control.after(target);
    feedback.set(control, target);
    const description = control.getAttribute('aria-describedby');
    control.setAttribute('aria-describedby', [description, target.id].filter(Boolean).join(' '));
  }
  // These fields retain the UTF-16 limits formerly enforced by maxlength.
  const invalid = !control.disabled && control.value.length > Number(control.dataset.maxLength);
  const message = invalid ? `必须在 ${control.dataset.maxLength} 字以内` : '';
  target.textContent = message;
  target.hidden = !invalid;
  control.setCustomValidity(message);
  if (invalid) control.setAttribute('aria-invalid', 'true');
  else control.removeAttribute('aria-invalid');
  return !invalid;
}
function validate(root) {
  const invalid = controls(root).filter(control => !control.disabled && !control.closest('[hidden]')).filter(control => !update(control));
  invalid[0]?.focus();
  return !invalid.length;
}
export function initInputLimits(root = document) {
  controls(root).forEach(update);
  function changed(event) {
    if (!event.isComposing && event.target.matches('input[data-max-length],textarea[data-max-length]')) update(event.target);
  }
  for (const type of ['input', 'change', 'compositionend', 'focusin']) root.addEventListener(type, changed);
  root.addEventListener('reset', event => queueMicrotask(() => controls(event.target).forEach(update)));
  root.addEventListener('submit', event => {
    if (!validate(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  root.addEventListener('click', event => {
    const button = event.target.closest('button,input[type="submit"]');
    if (!button) return;
    const scope = button.dataset.lengthScope ? root.querySelector(button.dataset.lengthScope) : button.type === 'submit' ? button.form : null;
    if (scope && !validate(scope)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
}
