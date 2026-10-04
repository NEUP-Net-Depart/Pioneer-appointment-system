import { $, $$ } from './utils.js';
export function initNavigation(onChange = () => {}) {
  function switchView(view) {
    const target = $(`[data-view="${view}"]`);
    const link = $(`[data-view-link="${view}"]`);
    if (!target || link?.hidden) return;
    $$('.view').forEach(item => item.classList.toggle('is-active', item === target));
    $$('[data-view-link]').forEach(item => item.classList.toggle('is-active', item.dataset.viewLink === view));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    onChange(view);
  }
  $$('[data-view-link]').forEach(button => button.addEventListener('click', event => { event.preventDefault(); switchView(button.dataset.viewLink); }));
  return switchView;
}
