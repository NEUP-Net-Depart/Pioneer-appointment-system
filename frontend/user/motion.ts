import { useLayoutEffect, useRef, type RefObject } from 'react';

const running = new WeakMap<Element, Animation>();
const easing = 'cubic-bezier(.2,.75,.25,1)';
const items =
  '.step-heading,.selection-summary,.form-block > h3,.form-block > .field,.review-group,.booking-preparation,.agreement-check,.step-actions,.booking-date-panel,.booking-time-panel,#booking-location,.booking-feedback';
const visible = (element: Element) => element.getClientRects().length > 0;
export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function animate(element: Element, frames: Keyframe[], { duration = 280, delay = 0 } = {}) {
  running.get(element)?.cancel();
  if (reduced() || !visible(element)) return;
  const animation = element.animate(frames, { duration, delay, easing, fill: 'backwards' });
  running.set(element, animation);
  void animation.finished.then(
    () => {
      if (running.get(element) === animation) running.delete(element);
    },
    () => {}
  );
}

export function reveal(element: Element | null, { delay = 0, distance = 8 } = {}) {
  if (element)
    animate(
      element,
      [
        { opacity: 0, transform: 'translateY(' + distance + 'px)' },
        { opacity: 1, transform: 'translateY(0)' }
      ],
      { delay }
    );
}

export function useReveal<T extends HTMLElement>(trigger: unknown, distance = 8) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    if (trigger) reveal(ref.current, { distance });
  }, [trigger, distance]);
  return ref;
}

export function useLayoutMotion(root: RefObject<HTMLElement | null>) {
  const pending = useRef<{
    positions: Map<Element, DOMRect>;
    height: number;
    stagger: boolean;
  } | null>(null);
  function measure({ stagger = false, resize = false } = {}) {
    const element = root.current;
    if (!element || reduced() || pending.current) return;
    pending.current = {
      positions: new Map(
        [...element.querySelectorAll(items)]
          .filter(visible)
          .map((node) => [node, node.getBoundingClientRect()])
      ),
      height: resize && visible(element) ? element.getBoundingClientRect().height : 0,
      stagger
    };
  }
  useLayoutEffect(() => {
    const snapshot = pending.current;
    pending.current = null;
    const element = root.current;
    if (!snapshot || !element) return;
    const { positions, height, stagger } = snapshot;
    if (height) {
      running.get(element)?.cancel();
      const next = visible(element) ? element.getBoundingClientRect().height : 0;
      if (next && Math.abs(height - next) > 0.5)
        animate(element, [{ height: height + 'px' }, { height: next + 'px' }]);
    }
    let index = 0;
    for (const node of element.querySelectorAll(items)) {
      running.get(node)?.cancel();
      if (!visible(node)) continue;
      const previous = positions.get(node);
      if (!previous) {
        reveal(node, { delay: stagger ? Math.min(index++ * 24, 144) : 0 });
        continue;
      }
      const next = node.getBoundingClientRect();
      const x = previous.left - next.left,
        y = previous.top - next.top;
      if (Math.abs(x) + Math.abs(y) > 0.5)
        animate(node, [
          { transform: 'translate(' + x + 'px,' + y + 'px)' },
          { transform: 'translate(0,0)' }
        ]);
    }
  });
  useLayoutEffect(() => {
    const element = root.current;
    return () =>
      element?.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
  }, [root]);
  return measure;
}
