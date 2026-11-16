import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function telemetryQuery({ name = 'errors', preview = false, hours = 24 } = {}) {
  if (!Number.isInteger(hours) || hours < 1 || hours > 2160)
    throw new Error('--hours must be an integer from 1 to 2160.');
  const source = await readFile(
    new URL('../docs/observability/queries.sql', import.meta.url),
    'utf8'
  );
  const parts = source.split(/^-- name: ([a-z]+)\s*$/m);
  const queries = new Map();
  for (let i = 1; i < parts.length; i += 2) queries.set(parts[i], parts[i + 1].trim());
  if (!queries.has(name)) throw new Error(`Choose --query ${[...queries.keys()].join('|')}.`);
  const sql = queries
    .get(name)
    .replaceAll('__DATASET__', `pioneer_telemetry_${preview ? 'preview' : 'production'}`)
    .replaceAll('__HOURS__', String(hours));
  if (!/^SELECT\s/i.test(sql) || sql.includes(';'))
    throw new Error('Only one predefined SELECT is allowed.');
  return sql + '\nFORMAT JSON';
}

export async function queryTelemetry(options, { env = process.env, fetcher = fetch } = {}) {
  const sql = await telemetryQuery(options);
  if (options.print) return sql;
  const account = env.CLOUDFLARE_ACCOUNT_ID,
    token = env.CLOUDFLARE_ANALYTICS_API_TOKEN;
  if (!/^[a-f\d]{32}$/i.test(account || '') || !token)
    throw new Error(
      'Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_ANALYTICS_API_TOKEN (Account Analytics Read).'
    );
  const response = await fetcher(
    `https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
      body: sql,
      redirect: 'error',
      signal: AbortSignal.timeout(20000)
    }
  );
  if (!response.ok)
    throw new Error(
      `Analytics query failed (HTTP ${response.status}). Check dataset initialization, read permission and query quota.`
    );
  return response.json();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--query') options.name = args[++i];
    else if (args[i] === '--hours') options.hours = Number(args[++i]);
    else if (args[i] === '--preview') options.preview = true;
    else if (args[i] === '--print') options.print = true;
    else throw new Error('Use --query <name> --hours <1..2160> [--preview] [--print].');
  }
  const result = await queryTelemetry(options);
  console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
}
