import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { config } from '../scripts/cli.mjs';
import { pagesSiteUrl } from '../scripts/release-plan.mjs';
import { publishPages } from '../scripts/pages-deploy.mjs';
import { warrantyDeployment, staffWarrantyHeaders, verifierHeaders, prepareWarrantyDeployment, publishWarrantyVerifier } from '../scripts/warranty-deploy.mjs';
import { warrantyService } from '../src/services/warranty.js';

const credentials = { CLOUDFLARE_ACCOUNT_ID: 'test-account', CLOUDFLARE_API_TOKEN: 'test-token' };
const projectResponse = project => Response.json({ success: true, result: { name: project, production_branch: 'main' } });
const release = branch => ({ project: 'pioneer-appointment-system', branch, environment: branch === 'main' ? 'production' : 'preview', siteUrl: pagesSiteUrl('pioneer-appointment-system', branch), commit: 'reviewed-commit' });

test('staff and verifier CSPs enable only their matching origins and fail closed when missing', async () => {
  const headers = await readFile('public/_headers', 'utf8');
  const origin = 'https://dev.pioneer-appointment-system-warranty.pages.dev';
  const built = staffWarrantyHeaders(headers, origin);
  assert.ok(built.includes(`frame-src ${origin}; worker-src 'self'`));
  assert.equal(built.split('/staff/*')[0].includes(origin), false);
  assert.equal(built.split('/staff/*')[1].split('/staff/assets/*')[0].match(/script-src[^;]+/)[0].includes(origin), false);
  assert.ok(staffWarrantyHeaders(headers).includes("frame-src 'none'"));
  assert.equal(staffWarrantyHeaders(headers.replace(/\r?\n/g, '\r\n'), origin), built);
  for (const value of ['http://evil.example', 'https://verify.example/path', "https://verify.example; script-src *"]) assert.throws(() => staffWarrantyHeaders(headers, value));
  const verifier = await readFile('warranty-verifier/_headers', 'utf8');
  assert.ok(verifierHeaders(verifier).includes("frame-ancestors 'none'"));
  const policy = verifierHeaders(verifier, ['https://repair.example.org']);
  assert.ok(policy.includes('frame-ancestors https://repair.example.org'));
  assert.ok(policy.includes('https://contentcenter-drcn.dbankcdn.cn'));
  assert.equal(policy.includes('X-Frame-Options'), false);
});

test('generated release roots share the build/runtime origin without copying Functions or bindings to the verifier', async () => {
  const cfg = await config(), original = JSON.stringify(cfg), originalFile = await readFile('wrangler.jsonc', 'utf8');
  const headers = await readFile('public/_headers', 'utf8');
  for (const branch of ['main', 'dev', 'fix/warranty']) {
    const plan = release(branch), warranty = warrantyDeployment(plan, {});
    const prepared = await prepareWarrantyDeployment(plan, cfg, warranty);
    try {
      const runtime = JSON.parse(await readFile(join(prepared.workbench.cwd, 'wrangler.jsonc'), 'utf8'));
      const vars = plan.environment === 'preview' ? runtime.env.preview.vars : runtime.vars;
      assert.equal(vars.WARRANTY_CAPTCHA_ORIGIN, warranty.origin);
      assert.ok(staffWarrantyHeaders(headers, vars.WARRANTY_CAPTCHA_ORIGIN).includes(`frame-src ${warranty.origin};`));
      const provider = warrantyService({ captchaOrigin: vars.WARRANTY_CAPTCHA_ORIGIN, encryptionKey: '22'.repeat(32) }).providers().providers.find(item => item.id === 'huawei');
      assert.equal(provider.available, true);
      assert.equal(provider.captchaOrigin, warranty.origin);
      assert.equal(runtime.d1_databases[0].migrations_dir, resolve('migrations'));
      assert.equal(runtime.d1_databases[0].database_id, cfg.d1_databases[0].database_id);
      assert.deepEqual(runtime.env.preview.r2_buckets, cfg.env.preview.r2_buckets);
      assert.equal(runtime.vars.MAX_R2_BYTES, cfg.vars.MAX_R2_BYTES);
      assert.equal(runtime.env.preview.vars.MAX_R2_BYTES, cfg.env.preview.vars.MAX_R2_BYTES);
      assert.deepEqual((await readdir(prepared.verifier.cwd)).sort(), ['dist', 'package.json', 'wrangler.jsonc']);
      assert.deepEqual((await readdir(join(prepared.verifier.cwd, 'dist'))).sort(), ['_headers', 'bridge.js', 'index.html', 'style.css']);
      const staticConfig = JSON.parse(await readFile(join(prepared.verifier.cwd, 'wrangler.jsonc'), 'utf8'));
      assert.deepEqual(Object.keys(staticConfig).sort(), ['compatibility_date', 'name', 'pages_build_output_dir']);
      assert.equal(staticConfig.name, warranty.project);
      const policy = await readFile(join(prepared.verifier.cwd, 'dist/_headers'), 'utf8');
      assert.ok(policy.includes('frame-ancestors ' + warranty.parents.join(' ')));
      const calls = [];
      const run = (args, options) => { calls.push({ args, options }); };
      await publishWarrantyVerifier(prepared, { env: credentials, fetcher: async () => projectResponse(warranty.project), run });
      await publishPages(prepared.workbench, run);
      assert.deepEqual(calls, [
        { args: ['pages', 'deploy', 'dist', '--project-name', warranty.project, '--branch', branch, '--commit-hash', plan.commit], options: { cwd: prepared.verifier.cwd } },
        { args: ['pages', 'deploy', resolve('dist'), '--project-name', plan.project, '--branch', branch, '--commit-hash', plan.commit], options: { cwd: prepared.workbench.cwd } }
      ]);
    } finally { await prepared.cleanup(); }
  }
  assert.equal(JSON.stringify(cfg), original);
  assert.equal(await readFile('wrangler.jsonc', 'utf8'), originalFile);
});
