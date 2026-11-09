import React, { useLayoutEffect, useRef } from 'react';
import { dataMotionPresets } from '../../shared/data-motion.js';

export function DataInput({ value, ...props }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (
      !node ||
      value === '' ||
      value == null ||
      !/^-?\d+(\.\d+)?$/.test(String(value)) ||
      document.hidden ||
      document.activeElement === node ||
      matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !node.getClientRects().length
    )
      return;
    const preset = dataMotionPresets.number;
    const color = getComputedStyle(node).color;
    const animation = node.animate(
      [
        { color: 'transparent', textShadow: `0 1em 0 ${color}` },
        { color: 'transparent', textShadow: `0 0 0 ${color}` }
      ],
      {
        duration: preset.duration,
        easing: 'ease-out'
      }
    );
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const stop = () => animation.cancel();
    node.addEventListener('focus', stop);
    preference.addEventListener('change', stop);
    document.addEventListener('visibilitychange', stop);
    return () => {
      animation.cancel();
      node.removeEventListener('focus', stop);
      preference.removeEventListener('change', stop);
      document.removeEventListener('visibilitychange', stop);
    };
  }, [value]);
  return <input {...props} value={value} ref={ref} data-value-motion="field" />;
}
