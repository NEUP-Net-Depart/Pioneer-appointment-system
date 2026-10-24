import React, { useLayoutEffect, useRef } from 'react';

// Only short, non-interactive task prompts use the character reveal. One
// animation drives a bounded number of glyphs; the accessible text is complete.
export function MotionText({ children }: { children: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const text = String(children ?? '');
  const glyphs = Array.from(text);
  const short = glyphs.length > 0 && glyphs.length <= 20;
  useLayoutEffect(() => {
    const node = ref.current;
    if (
      !short ||
      !node ||
      document.hidden ||
      node.closest('[hidden]') ||
      matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !CSS.supports('(--motion-progress: 1)')
    )
      return;
    const animation = node.animate([{ '--motion-progress': '-2' }, { '--motion-progress': '22' }], {
      duration: 220,
      easing: 'ease-out'
    });
    const stop = () => animation.cancel();
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    document.addEventListener('visibilitychange', stop);
    preference.addEventListener('change', stop);
    return () => {
      animation.cancel();
      document.removeEventListener('visibilitychange', stop);
      preference.removeEventListener('change', stop);
    };
  }, [text, short]);
  if (!short) return <span data-motion-value="text">{text}</span>;
  return (
    <span className="motion-phrase" ref={ref}>
      <span className="motion-accessible">{text}</span>
      <span aria-hidden="true">
        {glyphs.map((glyph, index) => (
          <span
            key={`${text}:${index}`}
            className="motion-glyph"
            style={{ '--motion-index': index } as React.CSSProperties}
          >
            {glyph}
          </span>
        ))}
      </span>
    </span>
  );
}
