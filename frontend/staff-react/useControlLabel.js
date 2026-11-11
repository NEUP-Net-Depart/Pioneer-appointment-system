import { useLayoutEffect, useState } from 'react';

export function useControlLabel(control, explicit, id) {
  const [label, setLabel] = useState(explicit || '');
  useLayoutEffect(() => {
    const node = control.current;
    if (!node) return;
    const parent = node.closest('label');
    const external = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
    const text = parent
      ? [...parent.childNodes]
          .filter((child) => child !== node && !(child instanceof Element && child.contains(node)))
          .map((child) => child.textContent)
          .join(' ')
          .trim()
      : external?.textContent;
    setLabel(explicit || text || '');
  }, [control, explicit, id]);
  return label;
}
