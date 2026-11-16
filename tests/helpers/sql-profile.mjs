import { performance } from 'node:perf_hooks';

// Diagnostic-only adapter. first() executes all() once to retain D1 metadata;
// production's first() discards that metadata. Never issue a second query.
export function sqlProfiler(database) {
  const statements = new WeakMap();
  let entries = [];
  function record(sql, result, elapsedMs) {
    const { rows_read, rows_written, duration } = result.meta || {};
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
  function wrap(target) {
    function prepare(sql, native = target.prepare(sql)) {
      async function execute(method) {
        const start = performance.now();
        const result = await native[method]();
        record(sql, result, performance.now() - start);
        return result;
      }
      const statement = {
        bind: (...values) => prepare(sql, native.bind(...values)),
        all: () => execute('all'),
        run: () => execute('run'),
        async first(column) {
          const row = (await execute('all')).results[0];
          if (!row) return null;
          if (column === undefined) return row;
          if (!Object.hasOwn(row, column)) throw new Error(`Unknown D1 column: ${column}`);
          return row[column];
        }
      };
      statements.set(statement, { sql, native });
      return statement;
    }
    return {
      prepare,
      withSession: (constraint) => wrap(target.withSession(constraint)),
      async batch(batch) {
        const originals = batch.map((item) => {
          const original = statements.get(item);
          if (!original) throw new Error('Unprofiled statement in D1 batch');
          return original;
        });
        const start = performance.now();
        const results = await target.batch(originals.map((item) => item.native));
        const elapsedMs = performance.now() - start;
        results.forEach((result, index) => record(originals[index].sql, result, null));
        // Batch wall time belongs to the operation, not to each SQL statement.
        batchElapsedMs += elapsedMs;
        return results;
      }
    };
  }
  let batchElapsedMs = 0;
  return {
    db: wrap(database),
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

export function budgetFailures(sample, budget, baseline) {
  const errors = [];
  for (const key of ['rowsRead', 'rowsWritten', 'statements']) {
    if (sample[key] > budget[key]) errors.push(`${key}: ${sample[key]} > ${budget[key]}`);
  }
  if (baseline && sample.rowsRead > baseline.rowsRead * 2 + 32)
    errors.push(`read growth: ${baseline.rowsRead} → ${sample.rowsRead} (limit 2× + 32)`);
  return errors;
}
