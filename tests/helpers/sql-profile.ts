import type { Miniflare } from 'miniflare';
import type { Database, DatabaseStatement } from '../../src/platform/environment.ts';
import { performance } from 'node:perf_hooks';

// Diagnostic-only adapter. first() executes all() once to retain D1 metadata;
// production's first() discards that metadata. Never issue a second query.
type NativeDatabase = Awaited<ReturnType<Miniflare['getD1Database']>>;
type NativeSession = ReturnType<NativeDatabase['withSession']>;
type NativeStatement = ReturnType<NativeDatabase['prepare']>;
type QueryProfile = { sql: string; rowsRead: number; rowsWritten: number; durationMs: number; elapsedMs: number | null };
type SqlBudget = { rowsRead: number; rowsWritten: number; statements: number };

export function sqlProfiler(database: NativeDatabase) {
  const statements = new WeakMap<DatabaseStatement, { sql: string; native: NativeStatement }>();
  let entries: QueryProfile[] = [];
  function record(sql: string, result: { meta: { rows_read: number; rows_written: number; duration: number } }, elapsedMs: number | null) {
    const { rows_read, rows_written, duration } = result.meta;
    if (![rows_read, rows_written, duration].every((value) => Number.isFinite(value) && value >= 0))
      throw new Error(
        'D1 did not return rows_read, rows_written and duration; cannot measure SQL cost'
      );
    entries.push({
      sql: sql.replace(/\s+/g, ' ').trim(),
      rowsRead: rows_read,
      rowsWritten: rows_written,
      durationMs: duration,
      elapsedMs
    });
  }
  function wrap(target: Pick<NativeSession, 'prepare' | 'batch'>): Database {
    function prepare(sql: string, native = target.prepare(sql)): DatabaseStatement {
      async function execute<T>(method: 'all' | 'run') {
        const start = performance.now();
        const result = await native[method]<T>();
        record(sql, result, performance.now() - start);
        return result;
      }
      const statement: DatabaseStatement = {
        bind: (...values) => prepare(sql, native.bind(...values)),
        all: <T>() => execute<T>('all'),
        run: <T>() => execute<T>('run'),
        async first<T>(column?: string) {
          const row = (await execute<Record<string, unknown>>('all')).results[0];
          if (!row) return null;
          if (column === undefined) return row as T;
          if (!Object.hasOwn(row, column)) throw new Error(`Unknown D1 column: ${column}`);
          return row[column] as T;
        }
      };
      statements.set(statement, { sql, native });
      return statement;
    }
    return {
      prepare,
      async batch<T>(batch: DatabaseStatement[]) {
        const originals = batch.map((item) => {
          const original = statements.get(item);
          if (!original) throw new Error('Unprofiled statement in D1 batch');
          return original;
        });
        const start = performance.now();
        const results = await target.batch<T>(originals.map((item) => item.native));
        const elapsedMs = performance.now() - start;
        results.forEach((result, index: number) => record(originals[index].sql, result, null));
        // Batch wall time belongs to the operation, not to each SQL statement.
        batchElapsedMs += elapsedMs;
        return results;
      }
    };
  }
  let batchElapsedMs = 0;
  return {
    db: { ...wrap(database), withSession: (...args: Parameters<NativeDatabase['withSession']>) => wrap(database.withSession(...args)) },
    reset() {
      entries = [];
      batchElapsedMs = 0;
    },
    snapshot() {
      return {
        statements: entries.length,
        rowsRead: entries.reduce((sum, entry) => sum + entry.rowsRead, 0),
        rowsWritten: entries.reduce((sum, entry) => sum + entry.rowsWritten, 0),
        durationMs: entries.reduce((sum, entry) => sum + entry.durationMs, 0),
        elapsedMs: entries.reduce((sum, entry) => sum + (entry.elapsedMs || 0), batchElapsedMs),
        queries: [...entries]
      };
    }
  };
}

export function budgetFailures(sample: SqlBudget, budget: SqlBudget, baseline?: SqlBudget) {
  const errors = [];
  for (const key of ['rowsRead', 'rowsWritten', 'statements'] as const) {
    if (sample[key] > budget[key]) errors.push(`${key}: ${sample[key]} > ${budget[key]}`);
  }
  if (baseline && sample.rowsRead > baseline.rowsRead * 2 + 32)
    errors.push(`read growth: ${baseline.rowsRead} → ${sample.rowsRead} (limit 2× + 32)`);
  return errors;
}
