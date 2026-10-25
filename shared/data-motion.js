// Animate only data regions and keyed rows. The shell and controls stay in place.
const regions =
  '[data-motion-region],.booking-settings-editor,.capacity-actual,.capacity-staffing,.field-appointments,.field-people-list,.records-table-wrap,.members-results,.attendance-history-list,.report-grid,.roster-workflow,.account-list,.workspace-dialog-body,#lookup-results,#detail-queue,#detail-information,#detail-repair-record';
const containers =
  '[data-motion-container],.field-card,.react-card,.records-panel,.roster-start,.roster-board,.field-hero,.field-confirm,.reception-panel,.react-message,.react-error,.field-notice,.field-empty,.empty-state,.roster-issues,.roster-editbar,.service-day-preview,.roster-compose-section,.leave-detail-section';
const items = '[data-motion-item]';
const values = '[data-motion-value]';
const maxAnimations = 24;
// Lists provide geometry; their children enter as one bounded batch.
const listGroups =
  '[data-motion-list],.account-list,.members-results,.records-table-wrap,.field-people-list,.field-appointments,.report-grid';
// Product-wide semantic presets: no full-page fade or artificial data delay.
export const dataMotionPresets = {
  text: { duration: 160, keyframes: [{ opacity: 0.65 }, { opacity: 1 }] },
  number: {
    duration: 180,
    keyframes: [
      { opacity: 0.65, transform: 'translateY(.18em)' },
      { opacity: 1, transform: 'none' }
    ]
  },
  status: { duration: 150, keyframes: [{ opacity: 0.7 }, { opacity: 1 }] },
  field: { duration: 140, keyframes: [{ opacity: 0.8 }, { opacity: 1 }] },
  enter: {
    duration: 180,
    keyframes: [
      { opacity: 0.8, clipPath: 'inset(0 0 100% 0)' },
      { opacity: 1, clipPath: 'inset(0 0 0% 0)' }
    ]
  },
  container: {
    duration: 200,
    keyframes: [{ opacity: 0.8 }, { opacity: 1 }]
  },
  layout: { duration: 200 }
};
export function observeDataMotion(root, { enterInitial = false } = {}) {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const running = new Map();
  let previous = new Map(),
    frame = 0,
    width = root.clientWidth;
  let previousValues = new Map();
  let scrollPosition = `${window.scrollX}:${window.scrollY}:${root.scrollTop}`;
  const readValues = (snapshot) =>
    new Map(
      [...snapshot.keys()]
        .filter((node) => node.matches(values))
        .map((node) => [
          node,
          node.dataset.motionValue === 'bar'
            ? node.dataset.motionRatio
            : 'value' in node
              ? node.value
              : node.textContent
        ])
    );
  // Page roots and title-bearing wrappers never move or fade as a whole.
  const contentSurface = (node) => node !== root && !node.querySelector('.workspace-heading');
  const visible = (node) => node.getClientRects().length && !node.closest('[hidden],[inert]');
  const cancel = () => {
    for (const animation of running.values()) animation.cancel();
    running.clear();
  };
  const watched = new Set();
  let resizePending = false;
  const nativeLayoutRunning = () =>
    root
      .getAnimations({ subtree: true })
      .some((animation) =>
        ['block-size', 'height', 'grid-template-rows'].includes(animation.transitionProperty)
      );
  const sizeObserver = new ResizeObserver(() => {
    // Native disclosure/grid transitions already interpolate their own layout.
    // Do not rescan a long list on each frame or start a second height tween.
    if (nativeLayoutRunning()) return;
    if (!running.size) schedule();
    else resizePending = true;
  });
  function measure() {
    const nodes = [...root.querySelectorAll(`${regions},${containers},${items},${values}`)];
    if (root.matches(`${regions},${containers}`)) nodes.unshift(root);
    const candidates = new Set([
      root,
      ...nodes.filter((node) => !node.matches(`${items},${values}`))
    ]);
    for (const node of watched)
      if (!candidates.has(node)) {
        sizeObserver.unobserve(node);
        watched.delete(node);
      }
    for (const node of candidates)
      if (!watched.has(node)) {
        sizeObserver.observe(node);
        watched.add(node);
      }
    const snapshot = new Map();
    for (const node of nodes) {
      // Offscreen rows need geometry for later reflow; their individual fields
      // do not. Avoid thousands of redundant geometry reads on long lists.
      if (node.matches(values)) {
        const parent = node.parentElement?.closest(`${items},${containers},${regions}`);
        const bounds = snapshot.get(parent);
        if (bounds && (bounds.bottom < 0 || bounds.top > innerHeight)) continue;
      }
      if (visible(node) && (!node.closest('dialog') || root.closest('dialog')))
        snapshot.set(node, node.getBoundingClientRect());
    }
    return snapshot;
  }
  function animate(node, frames, preset = dataMotionPresets.layout, delay = 0) {
    running.get(node)?.cancel();
    const animation = node.animate(frames, {
      duration: preset.duration,
      delay,
      fill: delay ? 'backwards' : 'none',
      easing: 'cubic-bezier(.2,.75,.25,1)'
    });
    running.set(node, animation);
    animation.finished.then(
      () => {
        if (running.get(node) === animation) running.delete(node);
        if (!running.size && resizePending) {
          resizePending = false;
          schedule();
        }
      },
      () => {}
    );
  }
  function update() {
    frame = 0;
    const resized = width !== root.clientWidth;
    width = root.clientWidth;
    const currentScroll = `${window.scrollX}:${window.scrollY}:${root.scrollTop}`;
    const scrolled = currentScroll !== scrollPosition;
    scrollPosition = currentScroll;
    if (
      preference.matches ||
      document.hidden ||
      !visible(root) ||
      resized ||
      scrolled ||
      nativeLayoutRunning()
    ) {
      cancel();
      previous = measure();
      previousValues = readValues(previous);
      return;
    }
    // Measure natural layout, never an intermediate animated height/transform.
    const interrupted = new Map();
    for (const [node, animation] of running) {
      // Unrelated responses must not cut a row reveal or text fade short.
      // Only layout effects need to be removed to read natural geometry.
      const layout =
        !node.matches(values) &&
        animation.effect.getKeyframes().some((frame) => 'height' in frame || 'transform' in frame);
      if (!node.isConnected || layout) {
        if (node.isConnected) interrupted.set(node, node.getBoundingClientRect());
        animation.cancel();
        running.delete(node);
      }
    }
    const next = measure();
    const nextValues = readValues(next);
    const entering = new Set(
      [...next.keys()].filter(
        (node) =>
          !previous.has(node) &&
          contentSurface(node) &&
          !node.matches(listGroups) &&
          node.matches(`${regions},${containers},${items}`)
      )
    );
    // An arriving parent owns the visual treatment until its reveal finishes.
    // A second response may update its contents immediately without layering fades.
    const arriving = new Set();
    for (const [node, animation] of running)
      if (
        !node.matches(values) &&
        animation.effect.getKeyframes().some((frame) => 'opacity' in frame || 'clipPath' in frame)
      )
        arriving.add(node);
    const enteringParent = (node) => {
      for (
        let parent = node.parentElement;
        parent && root.contains(parent);
        parent = parent.parentElement
      )
        if (entering.has(parent) || (!node.matches(items) && arriving.has(parent))) return true;
      return false;
    };
    // All geometry/style reads finish before the first animation writes styles.
    // Bound the work for dense rosters and long account lists.
    const animations = [];
    const allocated = new Set(running.keys());
    // Only an ancestor whose height really changes owns the size transition.
    // A static wrapper (including the page root) must not suppress inner growth.
    const resizing = new Set(
      [...next]
        .filter(([node, target]) => {
          const before = interrupted.get(node) || previous.get(node);
          return (
            before &&
            contentSurface(node) &&
            node.matches(`${regions},${containers}`) &&
            Math.abs(before.width - target.width) <= 1 &&
            Math.abs(before.height - target.height) > 1 &&
            before.height > 0 &&
            target.height > 0 &&
            target.bottom >= 0 &&
            target.top <= innerHeight &&
            !node.contains(document.activeElement) &&
            !node.querySelector(
              'canvas,video,input:focus,textarea:focus,select:focus,[contenteditable="true"]:focus'
            )
          );
        })
        .map(([node]) => node)
    );
    const resizingParent = (node) => {
      for (
        let parent = node.parentElement;
        parent && root.contains(parent);
        parent = parent.parentElement
      )
        if (resizing.has(parent)) return true;
      return false;
    };
    let arrivals = 0;
    const queue = (node, frames, preset = dataMotionPresets.layout, stagger = false) => {
      if (!allocated.has(node) && allocated.size >= maxAnimations) return;
      allocated.add(node);
      animations.push([node, frames, preset, stagger ? Math.min(arrivals++ * 12, 60) : 0]);
    };
    for (const [node, target] of next) {
      if (!contentSurface(node)) continue;
      const before = interrupted.get(node) || previous.get(node);
      if (
        (before && Math.abs(before.width - target.width) > 1 && !node.matches(values)) ||
        target.bottom < 0 ||
        target.top > innerHeight
      )
        continue;
      // Interactive/sensitive content never shifts under somebody's hands.
      if (
        node.contains(document.activeElement) ||
        node.querySelector(
          'canvas,video,input:focus,textarea:focus,select:focus,[contenteditable="true"]:focus'
        )
      )
        continue;
      if (enteringParent(node)) continue;
      if (node.matches(values)) {
        const parentItem = node.parentElement?.closest(items);
        if (
          (parentItem && !previous.has(parentItem)) ||
          node
            .closest(regions)
            ?.querySelector(
              'input:focus,textarea:focus,select:focus,[contenteditable="true"]:focus'
            )
        )
          continue;
        if (
          node.getAttribute('aria-busy') !== 'true' &&
          (previousValues.has(node)
            ? previousValues.get(node) !== nextValues.get(node)
            : previous.size > 0)
        ) {
          if (node.dataset.motionValue === 'bar') {
            queue(node, [
              { transform: `scaleX(${Number(previousValues.get(node)) || 0})` },
              { transform: `scaleX(${Number(nextValues.get(node)) || 0})` }
            ]);
          } else {
            const preset = dataMotionPresets[node.dataset.motionValue] || dataMotionPresets.text;
            queue(node, preset.keyframes, preset);
          }
        }
        continue;
      }
      if (!before) {
        if (!node.matches(listGroups) && node.matches(`${regions},${containers},${items}`)) {
          const preset = node.matches(items)
            ? dataMotionPresets.enter
            : dataMotionPresets.container;
          queue(node, preset.keyframes, preset, node.matches(items));
        }
        continue;
      }
      if (node.matches(items) && Math.abs(before.height - target.height) <= 1) {
        const y = before.top - target.top,
          x = before.left - target.left;
        // Category/filter replacement is a reveal, not a spatial reorder.
        // Never fly cards across columns or replay an old offscreen position.
        if (!node.closest('[data-motion-list="reveal"]') && Math.abs(x) <= 1 && Math.abs(y) > 0.5)
          queue(node, [{ transform: `translateY(${y}px)` }, { transform: 'none' }]);
      } else if (resizing.has(node)) {
        if (resizingParent(node)) continue;
        const style = getComputedStyle(node);
        const inset =
          style.boxSizing === 'border-box'
            ? 0
            : ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce(
                (sum, key) => sum + (parseFloat(style[key]) || 0),
                0
              );
        queue(node, [
          { height: `${Math.max(0, before.height - inset)}px`, overflow: 'clip' },
          { height: `${Math.max(0, target.height - inset)}px`, overflow: 'clip' }
        ]);
      }
    }
    for (const args of animations) animate(...args);
    previous = next;
    previousValues = nextValues;
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  const observer = new MutationObserver(schedule);
  previous = measure();
  previousValues = readValues(previous);
  if (enterInitial && !preference.matches && !document.hidden && visible(root)) {
    let count = 0;
    const initialParents = new Set(
      [...previous.keys()].filter(
        (node) =>
          contentSurface(node) &&
          !node.matches(listGroups) &&
          node.matches(`${regions},${containers},${items}`)
      )
    );
    const hasInitialParent = (node) => {
      for (
        let parent = node.parentElement;
        parent && root.contains(parent);
        parent = parent.parentElement
      )
        if (initialParents.has(parent)) return true;
      return false;
    };
    for (const [node, bounds] of previous) {
      if (
        !node.matches(`${regions},${containers},${items}`) ||
        !contentSurface(node) ||
        node.matches(listGroups) ||
        bounds.bottom < 0 ||
        bounds.top > innerHeight
      )
        continue;
      if (
        hasInitialParent(node) ||
        node.contains(document.activeElement) ||
        node.querySelector('canvas,video') ||
        ++count > maxAnimations
      )
        continue;
      const preset = node.matches(items) ? dataMotionPresets.enter : dataMotionPresets.container;
      animate(
        node,
        preset.keyframes,
        preset,
        node.matches(items) ? Math.min((count - 1) * 12, 60) : 0
      );
    }
  }
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      'hidden',
      'open',
      'class',
      'value',
      'disabled',
      'aria-busy',
      'data-motion-ratio'
    ]
  });
  const reset = () => {
    cancel();
    previous = measure();
    previousValues = readValues(previous);
    width = root.clientWidth;
    scrollPosition = `${window.scrollX}:${window.scrollY}:${root.scrollTop}`;
  };
  const layoutSettled = (event) => {
    if (['block-size', 'height', 'grid-template-rows'].includes(event.propertyName)) reset();
  };
  root.addEventListener('transitionend', layoutSettled);
  preference.addEventListener('change', reset);
  document.addEventListener('visibilitychange', reset);
  window.addEventListener('resize', reset);
  return () => {
    observer.disconnect();
    sizeObserver.disconnect();
    watched.clear();
    cancelAnimationFrame(frame);
    cancel();
    root.removeEventListener('transitionend', layoutSettled);
    preference.removeEventListener('change', reset);
    document.removeEventListener('visibilitychange', reset);
    window.removeEventListener('resize', reset);
  };
}
