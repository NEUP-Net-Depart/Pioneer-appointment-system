import React, { useLayoutEffect, useRef } from 'react';

// The accessible value changes immediately. Only its visual position transitions.
export function AnimatedValue({ value }: { value: string | number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);
  useLayoutEffect(() => {
    const node = ref.current;
    if (previous.current === value || !node) return;
    previous.current = value;
    node.getAnimations().forEach((animation) => animation.cancel());
    if (
      document.hidden ||
      matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !node.getClientRects().length
    )
      return;
    const animation = node.animate(
      [
        { transform: 'translateY(.18em)', opacity: 0.65 },
        { transform: 'none', opacity: 1 }
      ],
      { duration: 180, easing: 'ease-out' }
    );
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const stop = () => {
      if (preference.matches || document.hidden) animation.cancel();
    };
    preference.addEventListener('change', stop);
    document.addEventListener('visibilitychange', stop);
    return () => {
      animation.cancel();
      preference.removeEventListener('change', stop);
      document.removeEventListener('visibilitychange', stop);
    };
  }, [value]);
  return (
    <span className="workspace-data-value" ref={ref}>
      {value}
    </span>
  );
}
