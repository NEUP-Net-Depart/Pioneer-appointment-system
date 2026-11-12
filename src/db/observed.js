import { observedOperation } from '../platform/observability.js';

// Preserve native statements in batches and the existing request-scoped session.
// first()/raw() have no metadata; never issue a second query to obtain it.
export function observedDatabase(database, observation) {
  const originals = new WeakMap();
  function statement(native) {
    const wrapped = new Proxy(native, {
      get(target, key) {
        const value = target[key];
        if (typeof value !== 'function') return value;
        if (key === 'bind') return (...args) => statement(value.apply(target, args));
        if (['first', 'all', 'run', 'raw'].includes(key))
          return (...args) => observedOperation(observation, 'd1', () => value.apply(target, args));
        return value.bind(target);
      }
    });
    originals.set(wrapped, native);
    return wrapped;
  }
  return new Proxy(database, {
    get(target, key) {
      if (key === 'prepare') return (...args) => statement(target.prepare(...args));
      if (key === 'batch')
        return (statements) =>
          observedOperation(observation, 'd1', () =>
            target.batch(statements.map((item) => originals.get(item) || item))
          );
      const value = target[key];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}
