import type { D1Result } from '@cloudflare/workers-types';
import type { Database, DatabaseStatement } from '../src/platform/environment.ts';

interface CloudflareResponse<T> {
  success?: boolean;
  result: T;
  errors?: { code?: number | string }[];
}
interface SqlCommand {
  sql: string;
  params: unknown[];
}
interface RemoteStatement extends DatabaseStatement, SqlCommand {}

// D1 HTTP adapter for repository reuse by maintenance scripts, never frontend code.
export function cloudflareClient(accountId: string|undefined, token: string|undefined, fetchImpl = fetch) {
  if (!/^[a-f\d]{32}$/i.test(accountId || '') || !token) throw new Error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN');
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}`;
  async function call<T>(path: string, body?: object) {
    const response = await fetchImpl(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000)
    });
    const payload = await response.json().catch(() => null) as CloudflareResponse<T> | null;
    if (!response.ok) {
      const codes = Array.isArray(payload?.errors) ? payload.errors.map(error => Number(error.code)).filter(Number.isSafeInteger).slice(0, 3) : [];
      throw new Error(`Cloudflare request failed (${response.status}${codes.length ? `; codes ${codes.join(',')}` : ''})`);
    }
    if (!payload?.success) throw new Error('Cloudflare returned an unsuccessful result');
    return payload.result;
  }
  return {
    async checkBucket(name: string) { await call(`/r2/buckets/${encodeURIComponent(name)}`); },
    database(id: string): Database {
      async function query<T>(statements: SqlCommand[]) {
        const prepared = statements.map(({ sql, params }) => ({ sql, params: params.map(String) }));
        const result = await call<D1Result<T>[]>(`/d1/database/${encodeURIComponent(id)}/query`, prepared.length === 1 ? prepared[0] : { batch: prepared });
        if (!Array.isArray(result) || result.length !== statements.length || result.some(item => !item.success)) throw new Error('D1 query failed');
        return result;
      }
      function prepare(sql: string, params: unknown[] = []): RemoteStatement {
        const statement: RemoteStatement = {
          sql, params, bind: (...values: unknown[]) => prepare(sql, values),
          async all<T>() { return (await query<T>([statement]))[0]; },
          async first<T>(column?: string): Promise<T | null> {
            if (column === undefined) return (await statement.all<T>()).results[0] ?? null;
            return (await statement.all<Record<string, T>>()).results[0]?.[column] ?? null;
          },
          async run<T>() { return statement.all<T>(); }
        };
        return statement;
      }
      return {
        prepare,
        batch<T>(statements: DatabaseStatement[]) {
          const commands = statements.map(statement => {
            if (!('sql' in statement) || typeof statement.sql !== 'string' ||
                !('params' in statement) || !Array.isArray(statement.params))
              throw new TypeError('Expected a D1 HTTP statement');
            return { sql: statement.sql, params: statement.params };
          });
          return query<T>(commands);
        }
      };
    }
  };
}
