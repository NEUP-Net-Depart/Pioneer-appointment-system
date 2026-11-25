import type { PagesConfig } from './wrangler-config.ts';
import type { releasePlan } from './release-plan.ts';
import type { WranglerRunner } from './pages-deploy.ts';

type ReleasePlan = Pick<Awaited<ReturnType<typeof releasePlan>>, 'project' | 'branch' | 'siteUrl' | 'environment' | 'commit'>;
type VerifierPlan = ReturnType<typeof warrantyDeployment>;
type Prepared = Awaited<ReturnType<typeof prepareWarrantyDeployment>>;
interface CloudflareProjectResponse { success: boolean; result?: { name: string; production_branch: string } }
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { root } from './cli.ts';
import { pagesSiteUrl } from './release-plan.ts';
import { publishPages } from './pages-deploy.ts';
import { captchaBridgeOrigin } from '../src/services/warranty/huawei.ts';
import { transform } from 'esbuild';

export async function buildWarrantyBridge() {
  const source = await readFile(join(root, 'warranty-verifier/bridge.ts'), 'utf8');
  const result = await transform(source, { loader: 'ts', target: 'es2022', sourcefile: 'bridge.ts' });
  return result.code;
}

export function warrantyDeployment(plan: ReleasePlan, env = process.env) {
  const project = `${plan.project}-warranty`;
  const origin = pagesSiteUrl(project, plan.branch);
  const site = captchaBridgeOrigin(env.SITE_URL || plan.siteUrl);
  if (!site || !site.startsWith('https:') || site === origin) throw new Error('Warranty verification requires a separate HTTPS origin.');
  const parents = plan.environment === 'production'
    ? [site, pagesSiteUrl(plan.project, 'main')]
    : [plan.siteUrl, `https://*.${plan.project}.pages.dev`];
  return { project, branch: plan.branch, origin, parents: [...new Set(parents)] };
}

export function staffWarrantyHeaders(headers: string, value = '') {
  const origin = captchaBridgeOrigin(value);
  if (value && !origin) throw new Error('WARRANTY_CAPTCHA_ORIGIN must be an HTTPS origin or a local preview origin');
  const source = headers.replaceAll('\r\n', '\n');
  const start = source.indexOf('/staff/*\n'), end = source.indexOf('\n/app-assets/*', start);
  if (start < 0 || end < 0) throw new Error('Staff CSP template is missing.');
  const staff = source.slice(start, end).replace("object-src 'none';", `frame-src ${origin || "'none'"}; worker-src 'self'; object-src 'none';`);
  return source.slice(0, start) + staff + source.slice(end);
}

export function verifierHeaders(headers: string, parents: readonly string[] = []) {
  if (!headers.includes("frame-ancestors 'none'")) throw new Error('Verifier CSP template is missing.');
  return headers.replace("frame-ancestors 'none'", `frame-ancestors ${parents.join(' ') || "'none'"}`);
}

export async function prepareWarrantyDeployment(plan: ReleasePlan, cfg: PagesConfig, warranty: VerifierPlan, env = process.env) {
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
        if (env[key]) bindings.vars[key] = env[key];
      }
      // A disabled collector must not require account-level Analytics Engine activation.
      if (bindings.vars.TELEMETRY_ENABLED !== 'true')
        bindings.analytics_engine_datasets = (bindings.analytics_engine_datasets || []).filter(dataset => dataset.binding !== 'ANALYTICS');
    }
    (plan.environment === 'preview' ? runtime.env.preview : runtime).vars.WARRANTY_CAPTCHA_ORIGIN = warranty.origin;
    await writeFile(join(workbench, 'wrangler.jsonc'), JSON.stringify(runtime, null, 2));
    await writeFile(join(verifier, 'wrangler.jsonc'), JSON.stringify({ name: warranty.project, pages_build_output_dir: './dist', compatibility_date: cfg.compatibility_date }));
    for (const cwd of [workbench, verifier]) await writeFile(join(cwd, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    for (const file of ['index.html', 'style.css']) await cp(join(root, 'warranty-verifier', file), join(verifier, 'dist', file));
    await writeFile(join(verifier, 'dist/bridge.js'), await buildWarrantyBridge());
    const headers = await readFile(join(root, 'warranty-verifier/_headers'), 'utf8');
    await writeFile(join(verifier, 'dist/_headers'), verifierHeaders(headers, warranty.parents));
    return {
      workbench: { ...plan, directory: runtime.pages_build_output_dir, cwd: workbench },
      verifier: { ...warranty, commit: plan.commit, cwd: verifier },
      cleanup
    };
  } catch (error) { await cleanup(); throw error; }
}

export async function ensureWarrantyProject(project: string, env = process.env, fetcher = fetch) {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) throw new Error('Warranty deployment requires the existing Cloudflare account and Pages API token.');
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/pages/projects`;
  const request = (path: string, options = {}) => fetcher(url + path, {
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
  let payload = await response.json() as CloudflareProjectResponse;
  if (payload.success && payload.result?.name === project && payload.result.production_branch !== 'main') {
    response = await request('/' + project, { method: 'PATCH', body: JSON.stringify({ production_branch: 'main' }) });
    if (!response.ok) throw new Error(`Cannot set the warranty Pages production branch (${response.status}).`);
    payload = await response.json() as CloudflareProjectResponse;
  }
  if (!payload.success || payload.result?.name !== project || payload.result?.production_branch !== 'main') throw new Error('Warranty Pages project must use main as its production branch.');
}

export async function publishWarrantyVerifier(prepared: Prepared, { env = process.env, fetcher = fetch, run }: { env?: NodeJS.ProcessEnv; fetcher?: typeof fetch; run?: WranglerRunner } = {}) {
  await ensureWarrantyProject(prepared.verifier.project, env, fetcher);
  await publishPages(prepared.verifier, run);
}
