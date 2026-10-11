import { $, $$ } from './utils.js';
export function initNavigation(onChange = () => {}) {
  function switchView(view) {
    const target = $(`[data-view="${view}"]`);
    const link = $(`[data-view-link="${view}"]`);
    if (!target || link?.hidden) return;
    $$('.view').forEach(item => item.classList.toggle('is-active', item === target));
    $$('[data-view-link]').forEach(item => item.classList.toggle('is-active', item.dataset.viewLink === view));
    // View changes should settle at the same scroll position immediately. A
    // smooth scroll overlaps the view transition and makes the page appear to
    // jump when the user switches tabs from a scrolled position.
    window.scrollTo({ top: 0, behavior: 'auto' });
    onChange(view);
  }
  $$('[data-view-link]').forEach(button => button.addEventListener('click', event => { event.preventDefault(); switchView(button.dataset.viewLink); }));
  return switchView;
}
