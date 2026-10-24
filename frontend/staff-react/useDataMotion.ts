import { useEffect, type RefObject } from 'react';
import { observeDataMotion } from '../../shared/data-motion.js';

export function useDataMotion(ref: RefObject<HTMLElement>, active: boolean) {
  useEffect(() => {
    if (active && ref.current) return observeDataMotion(ref.current);
  }, [ref, active]);
}
