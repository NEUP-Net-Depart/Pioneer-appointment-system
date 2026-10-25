import { useLayoutEffect, type RefObject } from 'react';
import { observeDataMotion } from '../../shared/data-motion.js';

export function useDataMotion(ref: RefObject<HTMLElement>, active: boolean, enterInitial = false) {
  useLayoutEffect(() => {
    if (active && ref.current) {
      const cleanup = observeDataMotion(ref.current, {
        enterInitial
      });
      return cleanup;
    }
  }, [ref, active, enterInitial]);
}
