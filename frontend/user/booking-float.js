import { $ } from '/shared/utils.js';

export function initBookingFloat(picker) {
  const panel = $('#booking-float'), button = $('#booking-float-button');
  const meta = $('#booking-float-meta'), time = $('#booking-float-time'), state = $('#booking-float-state');
  let passed = false, selection, leaving;

  function render() {
    if (passed && selection) {
      if (leaving) {
        const { opacity, transform } = getComputedStyle(button);
        leaving.cancel(); leaving = undefined;
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
          button.animate([{ opacity, transform }, { opacity: 1, transform: 'scale(1)' }], {
            duration: 200, easing: 'cubic-bezier(.2,.7,.25,1)'
          });
        }
      }
      panel.inert = false; panel.hidden = false;
      return;
    }
    if (panel.hidden || leaving) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { panel.hidden = true; return; }
    const { opacity, transform } = getComputedStyle(button);
    panel.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
    panel.inert = true;
    const animation = button.animate([{ opacity, transform }, { opacity: 0, transform: 'scale(.9,.05)' }], {
      duration: 220, easing: 'cubic-bezier(.4,0,.8,.3)', fill: 'forwards'
    });
    leaving = animation;
    animation.finished.then(() => {
      if (leaving !== animation) return;
      panel.hidden = true; leaving = undefined; animation.cancel();
    }).catch(() => {});
  }
  // Only crossing the selector boundary matters; no scroll loop or animation loop.
  picker.style.scrollMarginTop = '12px';
  const observer = new IntersectionObserver(([entry]) => {
    passed = !entry.isIntersecting && entry.boundingClientRect.bottom <= 0;
    render();
  }, { threshold: 0 });
  observer.observe(picker);

  button.addEventListener('click', () => {
    picker.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    (picker.querySelector('[data-slot][aria-pressed=true]') || picker.querySelector('[data-campus][aria-pressed=true]'))?.focus({ preventScroll: true });
  });
  return {
    update(campus, date, slot, issue = '') {
      if (campus && date && slot) {
        selection = true;
        const detail = `${campus} · ${date}`;
        if (meta.textContent !== detail) meta.textContent = detail;
        if (time.textContent !== slot) time.textContent = slot;
      } else if (!issue) selection = false;
      if (state.textContent !== issue) state.textContent = issue;
      state.hidden = !issue;
      panel.classList.toggle('is-invalid', Boolean(issue));
      button.setAttribute('aria-label', `已选预约：${meta.textContent} · ${time.textContent}${issue ? `，${issue}` : ''}，点击返回时间选择器`);
      render();
    },
    dispose() {
      observer.disconnect();
      leaving?.cancel(); leaving = undefined;
      panel.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
      panel.hidden = true;
    }
  };
}
