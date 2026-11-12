import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { root } from './cli.mjs';
import { pagesSiteUrl } from './release-plan.mjs';
import { publishPages } from './pages-deploy.mjs';
import { captchaBridgeOrigin } from '../src/services/warranty/huawei.js';

export function warrantyDeployment(plan, env = process.env) {
  const project = `${plan.project}-warranty`;
  const origin = pagesSiteUrl(project, plan.branch);
  const site = captchaBridgeOrigin(env.SITE_URL || plan.siteUrl);
  if (!site || !site.startsWith('https:') || site === origin) throw new Error('Warranty verification requires a separate HTTPS origin.');
  const parents = plan.environment === 'production'
    ? [site, pagesSiteUrl(plan.project, 'main')]
    : [plan.siteUrl, `https://*.${plan.project}.pages.dev`];
  return { project, branch: plan.branch, origin, parents: [...new Set(parents)] };
}

export function staffWarrantyHeaders(headers, value = '') {
  const origin = captchaBridgeOrigin(value);
  if (value && !origin) throw new Error('WARRANTY_CAPTCHA_ORIGIN must be an HTTPS origin or a local preview origin');
  const source = headers.replaceAll('\r\n', '\n');
  const start = source.indexOf('/staff/*\n'), end = source.indexOf('\n/staff/assets/*', start);
  if (start < 0 || end < 0) throw new Error('Staff CSP template is missing.');
  const staff = source.slice(start, end).replace("object-src 'none';", `frame-src ${origin || "'none'"}; worker-src 'self'; object-src 'none';`);
  return source.slice(0, start) + staff + source.slice(end);
}

export function verifierHeaders(headers, parents = []) {
  if (!headers.includes("frame-ancestors 'none'")) throw new Error('Verifier CSP template is missing.');
  return headers.replace("frame-ancestors 'none'", `frame-ancestors ${parents.join(' ') || "'none'"}`);
}

export async function prepareWarrantyDeployment(plan, cfg, warranty) {
  const parent = resolve(root, '.wrangler');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'warranty-release-'));
  const workbench = join(directory, 'workbench'), verifier = join(directory, 'verifier');
  async function cleanup() {
    if (dirname(directory) !== parent || !basename(directory).startsWith('warranty-release-')) throw new Error('Unsafe warranty release directory');
    await rm(directory, { recursive: true, force: true });
  }
  try {
    await mkdir(workbench);
    await mkdir(join(verifier, 'dist'), { recursive: true });
    // Pages rejects --config. Isolated project roots also prevent the static verifier
    // from accidentally uploading the appointment API or its D1/R2 bindings.
    for (const area of ['functions', 'src', 'shared']) await cp(join(root, area), join(workbench, area), { recursive: true });
    const runtime = structuredClone(cfg);
    delete runtime.$schema;
    runtime.pages_build_output_dir = resolve(root, 'dist');
    for (const bindings of [runtime, ...Object.values(runtime.env || {})]) {
      for (const database of bindings.d1_databases || []) if (database.migrations_dir) database.migrations_dir = resolve(root, database.migrations_dir);
      bindings.vars = { ...bindings.vars, WARRANTY_CAPTCHA_ORIGIN: '', TELEMETRY_RELEASE: plan.commit };
      for (const key of ['TELEMETRY_ENABLED', 'TELEMETRY_INTERACTIONS', 'TELEMETRY_SAMPLE_RATE', 'TELEMETRY_POLL_SAMPLE_RATE', 'OBSERVABILITY_LOGS']) {
        if (process.env[key]) bindings.vars[key] = process.env[key];
      }
    }
    (plan.environment === 'preview' ? runtime.env.preview : runtime).vars.WARRANTY_CAPTCHA_ORIGIN = warranty.origin;
    await writeFile(join(workbench, 'wrangler.jsonc'), JSON.stringify(runtime, null, 2));
    await writeFile(join(verifier, 'wrangler.jsonc'), JSON.stringify({ name: warranty.project, pages_build_output_dir: './dist', compatibility_date: cfg.compatibility_date }));
    for (const cwd of [workbench, verifier]) await writeFile(join(cwd, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    for (const file of ['index.html', 'bridge.js', 'style.css']) await cp(join(root, 'warranty-verifier', file), join(verifier, 'dist', file));
    const headers = await readFile(join(root, 'warranty-verifier/_headers'), 'utf8');
    await writeFile(join(verifier, 'dist/_headers'), verifierHeaders(headers, warranty.parents));
    return {
      workbench: { ...plan, directory: runtime.pages_build_output_dir, cwd: workbench },
      verifier: { ...warranty, commit: plan.commit, cwd: verifier },
      cleanup
    };
  } catch (error) { await cleanup(); throw error; }
}

export async function ensureWarrantyProject(project, env = process.env, fetcher = fetch) {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) throw new Error('Warranty deployment requires the existing Cloudflare account and Pages API token.');
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/pages/projects`;
  const request = (path, options = {}) => fetcher(url + path, {
    ...options, redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' }
  });
  let response = await request('/' + project);
  if (response.status === 404) {
    response = await request('', { method: 'POST', body: JSON.stringify({ name: project, production_branch: 'main' }) });
    // Concurrent first Preview/Production releases may both try to create it.
    if (!response.ok) response = await request('/' + project);
  }
  if (!response.ok) throw new Error(`Cannot configure warranty Pages project (${response.status}); the existing token needs Cloudflare Pages Edit permission for this account.`);
  let payload = await response.json();
  if (payload.success && payload.result?.name === project && payload.result.production_branch !== 'main') {
    response = await request('/' + project, { method: 'PATCH', body: JSON.stringify({ production_branch: 'main' }) });
    if (!response.ok) throw new Error(`Cannot set the warranty Pages production branch (${response.status}).`);
    payload = await response.json();
  }
  if (!payload.success || payload.result?.name !== project || payload.result?.production_branch !== 'main') throw new Error('Warranty Pages project must use main as its production branch.');
}

export async function publishWarrantyVerifier(prepared, { env = process.env, fetcher = fetch, run } = {}) {
  await ensureWarrantyProject(prepared.verifier.project, env, fetcher);
  await publishPages(prepared.verifier, run);
}
