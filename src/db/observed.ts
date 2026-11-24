import type { Observation } from '../platform/observability.ts';
import type { Database, DatabaseStatement } from '../platform/environment.ts';
import { observedOperation } from '../platform/observability.ts';

// Preserve native statements in batches and the existing request-scoped session.
// first()/raw() have no metadata; never issue a second query to obtain it.
export function observedDatabase<T extends Database>(database: T, observation: Observation) {
  const originals = new WeakMap<DatabaseStatement, DatabaseStatement>();
  function statement(native: DatabaseStatement) {
    const wrapped = new Proxy(native, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key);
        if (typeof value !== 'function') return value;
        if (key === 'bind') return (...args: unknown[]) => statement(target.bind(...args));
        if (typeof key === 'string' && ['first', 'all', 'run', 'raw'].includes(key))
          return (...args: unknown[]) => observedOperation(observation, 'd1', () => value.apply(target, args));
        return value.bind(target);
      }
    });
    originals.set(wrapped, native);
    return wrapped;
  }
  return new Proxy(database, {
    get(target, key) {
      if (key === 'prepare') return (sql: string) => statement(target.prepare(sql));
      if (key === 'batch')
        return (statements: DatabaseStatement[]) =>
          observedOperation(observation, 'd1', () =>
            target.batch(statements.map((item) => originals.get(item) || item))
          );
      const value: unknown = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}
