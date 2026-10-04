import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export const root = fileURLToPath(new URL('..', import.meta.url));
export function wrangler(args, { capture = false } = {}) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url)), ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  if (result.error || result.status !== 0) throw result.error || new Error(`Wrangler exited ${result.status}`);
  return result.stdout;
}
export async function config() { return JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8')); }
export async function localVars() {
  const contents = await readFile(new URL('../.dev.vars', import.meta.url), 'utf8');
  return Object.fromEntries(contents.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^([A-Z_\d]+)=(.*)$/);
    return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, '')]] : [];
  }));
}
export async function remoteConfig(preview) {
  const cfg = await config();
  const bindings = preview ? cfg.env.preview : cfg;
  if (!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(bindings.d1_databases[0].database_id) || bindings.d1_databases[0].database_id.startsWith('00000000-')) throw new Error('Set the real D1 database_id in wrangler.jsonc before remote operations.');
  if (preview && (bindings.d1_databases[0].database_id === cfg.d1_databases[0].database_id || bindings.r2_buckets[0].bucket_name === cfg.r2_buckets[0].bucket_name)) throw new Error('Preview must use a separate D1 database and R2 bucket.');
  return cfg;
}
