import { spawn, spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdir, writeFile, readFile, rm, cp, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { root, config } from './cli.mjs';
import { hashPassword } from '../src/lib/passwords.js';
import { dateKey } from '../shared/time.js';
import { workflowSeed, WORKFLOW_TIME, STAFF_PASSWORD } from '../tests/fixtures/workflow-seed.mjs';

const cli = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const localEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false', BROWSER: 'none' };
delete localEnv.CLOUDFLARE_API_TOKEN;
delete localEnv.CLOUDFLARE_ACCOUNT_ID;
const temporaryDirectory = () => resolve(root, '.wrangler', 'e2e-' + randomUUID());
const remove = (dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });

// Prepare a closed database once. Tests copy this state before starting their own
// Worker, so cookies, rate limits, rosters and attachments never cross test cases.
export async function preparePreview({ serve = false } = {}) {
  const dir = temporaryDirectory();
  const rootPassword = serve ? STAFF_PASSWORD : randomBytes(24).toString('base64url');
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(
      resolve(dir, 'package.json'),
      JSON.stringify({ private: true, type: 'module' })
    );
    for (const area of ['functions', 'src', 'shared', 'dist'])
      await cp(resolve(root, area), resolve(dir, area), {
        recursive: true,
        mode: constants.COPYFILE_FICLONE
      });
    if (!serve) {
      const clock = `const RealDate = Date; globalThis.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [${Date.parse(WORKFLOW_TIME)}])); }
        static now() { return ${Date.parse(WORKFLOW_TIME)}; }
      };`;
      const entry = resolve(dir, 'functions/api/[[path]].js');
      await writeFile(resolve(dir, 'functions/e2e-clock.js'), clock);
      await writeFile(entry, "import '../e2e-clock.js';\n" + (await readFile(entry, 'utf8')));
    }
    const cfg = await config();
    const bindings = {
      vars: { ...cfg.env.preview.vars },
      d1_databases: [
        {
          binding: 'DB',
          database_name: 'pioneer-local-e2e',
          database_id: '00000000-0000-4000-8000-000000000001',
          migrations_dir: resolve(root, 'migrations')
        }
      ],
      r2_buckets: [{ binding: 'ATTACHMENTS', bucket_name: 'pioneer-local-e2e' }]
    };
    await writeFile(
      resolve(dir, 'wrangler.jsonc'),
      JSON.stringify({
        name: cfg.name,
        pages_build_output_dir: resolve(dir, 'dist'),
        compatibility_date: cfg.compatibility_date,
        compatibility_flags: cfg.compatibility_flags,
        ...bindings,
        env: { preview: bindings }
      })
    );
    const vars = `JWT_SECRET=${randomBytes(48).toString('base64url')}\nPII_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}\nROOT001_PASSWORD=${rootPassword}\nWARRANTY_CAPTCHA_ORIGIN=${process.env.WARRANTY_CAPTCHA_ORIGIN}\n`;
    await writeFile(resolve(dir, '.dev.vars'), vars, { mode: 0o600 });
    await writeFile(resolve(dir, '.dev.vars.preview'), vars, { mode: 0o600 });
    const command = (args) => {
      const result = spawnSync(process.execPath, [cli, ...args, '--env', 'preview'], {
        cwd: dir,
        env: localEnv,
        encoding: 'utf8'
      });
      if (result.error || result.status !== 0)
        throw result.error || new Error(`Local Wrangler failed: ${result.stderr.slice(-1500)}`);
    };
    const state = resolve(dir, 'state'),
      sql = resolve(dir, 'seed.sql');
    const instant = serve ? new Date() : new Date(WORKFLOW_TIME);
    command(['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', state]);
    await writeFile(
      sql,
      `INSERT INTO staff_accounts(account,name,role,home_campus,protected,password_hash,created_at) VALUES ('root001','预览负责人','superadmin','南湖',1,'${hashPassword(rootPassword)}','${instant.toISOString()}'); INSERT INTO staff_campus_grants VALUES ('root001','南湖'),('root001','浑南'); INSERT INTO member_department_memberships(id,member_id,department_id,position_code,assignment_type,is_primary,effective_from,created_at) VALUES('test-root-hardware','member-root001','dept-hardware','member','primary',1,'2026-01-01','${instant.toISOString()}');\n` +
        workflowSeed(dateKey(instant)),
      { mode: 0o600 }
    );
    command(['d1', 'execute', 'DB', '--local', '--persist-to', state, '--file', sql]);
    await rm(sql);
    return { dir, rootPassword, close: () => remove(dir) };
  } catch (error) {
    await remove(dir);
    throw error;
  }
}

export async function startPreview(template) {
  const dir = temporaryDirectory();
  let server;
  const close = async () => {
    if (server?.pid && server.exitCode === null && server.signalCode === null) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => server.kill('SIGKILL'), 3000);
        server.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        server.kill('SIGTERM');
      });
    }
    await remove(dir);
  };
  try {
    await cp(template, dir, { recursive: true, mode: constants.COPYFILE_FICLONE });
    const cfg = JSON.parse(await readFile(resolve(dir, 'wrangler.jsonc'), 'utf8'));
    cfg.pages_build_output_dir = resolve(dir, 'dist');
    await writeFile(resolve(dir, 'wrangler.jsonc'), JSON.stringify(cfg));
    let port;
    for (let attempt = 0; attempt < 20 && !port; attempt++) {
      const probe = createServer((_, response) => {
        response.setHeader('Connection', 'close');
        response.end('ready');
      });
      await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
      const candidate = probe.address().port;
      try {
        const response = await fetch(`http://127.0.0.1:${candidate}`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) port = candidate;
      } catch {
        port = undefined;
      } finally {
        await new Promise((resolve) => probe.close(resolve));
      }
    }
    if (!port) throw new Error('No browser-accessible local Preview port available');
    const baseURL = `http://127.0.0.1:${port}`;
    // Register only the concrete origins of running local previews. The shared
    // verifier reads this append-only file across parallel Playwright workers.
    if (process.env.E2E_VERIFIER_PARENTS)
      await appendFile(process.env.E2E_VERIFIER_PARENTS, baseURL + '\n');
    const vars = await readFile(resolve(dir, '.dev.vars'), 'utf8');
    const secrets = vars
      .trim()
      .split('\n')
      .map((line) => line.slice(line.indexOf('=') + 1));
    let diagnostics = '',
      startupError;
    const record = (chunk) => {
      let value = chunk.toString();
      for (const secret of secrets) value = value.replaceAll(secret, '[redacted]');
      diagnostics = (diagnostics + value).slice(-4000);
    };
    server = spawn(
      process.execPath,
      [
        cli,
        'pages',
        'dev',
        resolve(dir, 'dist'),
        '--persist-to',
        resolve(dir, 'state'),
        '--ip',
        '127.0.0.1',
        '--port',
        String(port),
        '--inspector-port',
        '0'
      ],
      { cwd: dir, env: localEnv, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    server.stdout.on('data', record);
    server.stderr.on('data', record);
    server.on('error', (error) => {
      startupError = error;
    });
    for (let n = 0; n < 120; n++) {
      if (startupError) throw startupError;
      if (server.exitCode !== null)
        throw new Error('Local Preview exited before readiness:\n' + diagnostics);
      try {
        const response = await fetch(baseURL + '/api/health', {
          signal: AbortSignal.timeout(1000)
        });
        if (response.ok) return { dir, baseURL, close };
      } catch {
        /* starting */
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('Local Preview did not become ready:\n' + diagnostics);
  } catch (error) {
    await close();
    throw error;
  }
}
