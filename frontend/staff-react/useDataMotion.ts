import { useLayoutEffect, type RefObject } from 'react';
import { observeDataMotion } from '../../shared/data-motion.ts';

export function useDataMotion(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  enterInitial = false
) {
  useLayoutEffect(() => {
    if (active && ref.current) {
      const cleanup = observeDataMotion(ref.current, {
        enterInitial
      });
      return cleanup;
    }
  }, [ref, active, enterInitial]);
}
