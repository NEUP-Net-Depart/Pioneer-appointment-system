// Animate only data regions and keyed rows. The shell and controls stay in place.
const regions =
  '[data-motion-region],.booking-settings-editor,.capacity-actual,.capacity-staffing,.field-appointments,.field-people-list,.records-table-wrap,.members-results,.attendance-history-list,.report-grid,.roster-workflow,.account-list,.workspace-dialog-body,#lookup-results,#detail-queue,#detail-information,#detail-repair-record';
const items = '[data-motion-item]';
const duration = 200;
export function observeDataMotion(root) {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const running = new Map();
  let previous = new Map(),
    frame = 0,
    width = root.clientWidth;
  const visible = (node) => node.getClientRects().length && !node.closest('[hidden]');
  const cancel = () => {
    for (const animation of running.values()) animation.cancel();
    running.clear();
  };
  const watched = new Set();
  const sizeObserver = new ResizeObserver(() => { if (!running.size) schedule(); });
  function measure() {
    const nodes = [...root.querySelectorAll(`${regions},${items}`)];
    if (root.matches(regions)) nodes.unshift(root);
    const candidates = new Set([root, ...nodes.filter(node => !node.matches(items))]);
    for (const node of watched) if (!candidates.has(node)) { sizeObserver.unobserve(node); watched.delete(node); }
    for (const node of candidates) if (!watched.has(node)) { sizeObserver.observe(node); watched.add(node); }
    return new Map(
      nodes
        .filter((node) => visible(node) && (!node.closest('dialog') || root.closest('dialog')))
        .map((node) => [node, node.getBoundingClientRect()])
    );
  }
  function animate(node, frames) {
    running.get(node)?.cancel();
    const animation = node.animate(frames, { duration, easing: 'cubic-bezier(.2,.75,.25,1)' });
    running.set(node, animation);
    animation.finished.then(
      () => {
        if (running.get(node) === animation) running.delete(node);
      },
      () => {}
    );
  }
  function update() {
    frame = 0;
    const resized = width !== root.clientWidth;
    width = root.clientWidth;
    if (preference.matches || document.hidden || !visible(root) || resized) {
      cancel();
      previous = measure();
      return;
    }
    // Measure natural layout, never an intermediate animated height/transform.
    const interrupted = new Map([...running].map(([node]) => [node, node.getBoundingClientRect()]));
    cancel();
    const next = measure();
    let count = 0;
    for (const [node, target] of next) {
      const before = interrupted.get(node) || previous.get(node);
      if (
        !before ||
        Math.abs(before.width - target.width) > 1 ||
        target.bottom < 0 ||
        target.top > innerHeight
      )
        continue;
      // Never move a field under somebody's hands, or animate hundreds of rows.
      if (node.contains(document.activeElement) || ++count > 80) continue;
      if (node.matches(items)) {
        const y = before.top - target.top,
          x = before.left - target.left;
        if (Math.abs(y) > 0.5 || Math.abs(x) > 0.5)
          animate(node, [{ transform: `translate(${x}px,${y}px)` }, { transform: 'none' }]);
      } else if (
        !node.querySelector('canvas,video') &&
        !node.querySelector(
          'input:focus,textarea:focus,select:focus,[contenteditable="true"]:focus'
        ) &&
        Math.abs(before.height - target.height) > 1 &&
        before.height > 0 &&
        target.height > 0
      ) {
        // Do not nest height animations: only the outer data region expands.
        if (
          node.parentElement?.closest(regions) &&
          root.contains(node.parentElement.closest(regions))
        )
          continue;
        const style = getComputedStyle(node);
        const inset =
          style.boxSizing === 'border-box'
            ? 0
            : ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce(
                (sum, key) => sum + (parseFloat(style[key]) || 0),
                0
              );
        animate(node, [
          { height: `${Math.max(0, before.height - inset)}px`, overflow: 'clip' },
          { height: `${Math.max(0, target.height - inset)}px`, overflow: 'clip' }
        ]);
      }
    }
    previous = next;
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  const observer = new MutationObserver(schedule);
  previous = measure();
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['hidden', 'class']
  });
  const reset = () => {
    cancel();
    previous = measure();
    width = root.clientWidth;
  };
  preference.addEventListener('change', reset);
  document.addEventListener('visibilitychange', reset);
  window.addEventListener('resize', reset);
  return () => {
    observer.disconnect();
    sizeObserver.disconnect();
    watched.clear();
    cancelAnimationFrame(frame);
    cancel();
    preference.removeEventListener('change', reset);
    document.removeEventListener('visibilitychange', reset);
    window.removeEventListener('resize', reset);
  };
}
