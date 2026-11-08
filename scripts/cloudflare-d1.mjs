// D1 HTTP adapter for repository reuse by maintenance scripts, never frontend code.
export function cloudflareClient(accountId, token, fetchImpl = fetch) {
  if (!/^[a-f\d]{32}$/i.test(accountId || '') || !token) throw new Error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN');
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}`;
  async function call(path, body) {
    const response = await fetchImpl(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const codes = Array.isArray(payload?.errors) ? payload.errors.map(error => Number(error.code)).filter(Number.isSafeInteger).slice(0, 3) : [];
      throw new Error(`Cloudflare request failed (${response.status}${codes.length ? `; codes ${codes.join(',')}` : ''})`);
    }
    if (!payload.success) throw new Error('Cloudflare returned an unsuccessful result');
    return payload.result;
  }
  return {
    async checkBucket(name) { await call(`/r2/buckets/${encodeURIComponent(name)}`); },
    database(id) {
      async function query(statements) {
        const prepared = statements.map(({ sql, params }) => ({ sql, params: params.map(String) }));
        const result = await call(`/d1/database/${encodeURIComponent(id)}/query`, prepared.length === 1 ? prepared[0] : { batch: prepared });
        if (!Array.isArray(result) || result.length !== statements.length || result.some(item => !item.success)) throw new Error('D1 query failed');
        return result;
      }
      function prepare(sql, params = []) {
        const statement = {
          sql, params, bind: (...values) => prepare(sql, values),
          async all() { return (await query([statement]))[0]; },
          async first() { return (await statement.all()).results[0] ?? null; },
          async run() { return statement.all(); }
        };
        return statement;
      }
      return { prepare, batch: query };
    }
  };
}
