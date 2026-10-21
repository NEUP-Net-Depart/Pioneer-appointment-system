import { spawn, execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventory } from './mobile-audit-inventory.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = resolve(root, 'output/mobile-audit/evidence');
const metadata = { startedAt: new Date().toISOString(), timezone: 'Asia/Shanghai',
  branch: execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  serverClock: '2026-10-15T02:00:00.000Z', isolation: 'existing test-e2e.mjs disposable local D1/R2; loopback-only browser requests',
  node: process.version, arguments: process.argv.slice(2),
};
if (evidence !== resolve(root, 'output/mobile-audit/evidence')) throw new Error('Unsafe audit output path');
await mkdir(resolve(root, 'output/mobile-audit'), { recursive: true });
await rm(evidence, { recursive: true, force: true });
await writeFile(resolve(root, 'output/mobile-audit/inventory.json'), JSON.stringify(await inventory(), null, 2) + '\n');
const code = await new Promise((done, reject) => {
  const child = spawn(process.execPath, ['scripts/test-e2e.mjs', '--field', '--config', 'tests/mobile-audit/playwright.config.mjs', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit', env: process.env });
  child.once('error', reject); child.once('exit', exitCode => done(exitCode ?? 1));
});
await writeFile(resolve(root, 'output/mobile-audit/run.json'), JSON.stringify({ ...metadata, finishedAt: new Date().toISOString(), exitCode: code }, null, 2) + '\n');
process.exitCode = code;
