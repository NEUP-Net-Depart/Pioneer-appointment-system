import { useRef, useState } from 'react';

// Events and network continuations must see updates before React's next commit.
export function useCurrent<T>(initial: T | (() => T)) {
  const [value, setValue] = useState(initial);
  const current = useRef(value);
  function set(next: T) {
    current.current = next;
    setValue(next);
  }
  return [value, set, current] as const;
}
