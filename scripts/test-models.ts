import { failureFrom } from '../shared/api-types.ts';

interface ModelEntry { name: string; project?: string }
interface ModelReport {
  schemaVersion: number; mode: string; startedAt: string; command: string[]; status: string;
  models: ModelEntry[]; properties: ModelEntry[]; error?: string; finishedAt?: string; exitCode?: number;
}

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const [mode, ...args] = process.argv.slice(2);
if (!['node', 'e2e', 'all', 'properties'].includes(mode))
  throw new Error('Choose node, e2e, all or properties.');
if (mode === 'all' && args.length) throw new Error('Use node or e2e when filtering tests.');
if (
  process.env.FC_PATH !== undefined &&
  (!args.some((arg) => arg.startsWith('--test-name-pattern')) ||
    args.filter((arg) => arg.endsWith('.test.ts')).length !== 1)
)
  throw new Error('FC_PATH requires one test file and --test-name-pattern selecting one property.');

const startedAt = new Date().toISOString();
const directory = resolve(
  process.env.MODEL_REPORT_ROOT || resolve(root, 'output/model-reports'),
  `${startedAt.replaceAll(':', '-')}-${randomUUID()}`
);
await mkdir(directory, { recursive: true });
const env = {
  ...process.env,
  TEST_MODELS: '1',
  TEST_PROPERTIES: mode === 'properties' ? '1' : '0',
  MODEL_REPORT_DIR: directory
};
const report: ModelReport = {
  schemaVersion: 1,
  mode,
  startedAt,
  command: process.argv.slice(1),
  status: 'running',
  models: [],
  properties: []
};
const filename = join(directory, 'model-report.json');
await writeFile(filename, JSON.stringify(report, null, 2) + '\n');
async function run(command: string[]) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, command, { cwd: root, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}
try {
  process.exitCode = 0;
  if (mode !== 'e2e') {
    const files = args.some((arg) => arg.endsWith('.test.ts'))
      ? []
      : (await readdir(resolve(root, 'tests')))
          .filter((name) => name.endsWith('.test.ts'))
          .sort()
          .map((name) => `tests/${name}`);
    process.exitCode = await run(['--test', ...args, ...files]);
  }
  // Keep browser evidence even if a Node model fails.
  if (mode === 'e2e' || mode === 'all')
    process.exitCode = (await run(['scripts/test-e2e.ts', '--full', ...args])) || process.exitCode;
} catch (error) {
  process.exitCode = 1;
  report.error = failureFrom(error).message;
  throw error;
} finally {
  const entries = join(directory, 'entries');
  const files = await readdir(entries).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const file of files.filter((name) => name.endsWith('.json')).sort()) {
    const entry = JSON.parse(await readFile(join(entries, file), 'utf8'));
    if (entry.status === 'running') entry.status = 'incomplete';
    report[entry.kind === 'property' ? 'properties' : 'models'].push(entry);
  }
  report.models.sort(
    (a, b) => a.name.localeCompare(b.name) || String(a.project).localeCompare(String(b.project))
  );
  report.finishedAt = new Date().toISOString();
  report.exitCode = Number(process.exitCode ?? 0);
  report.status = process.exitCode ? 'failed' : 'passed';
  await writeFile(filename, JSON.stringify(report, null, 2) + '\n');
  console.log(`[model-report] ${filename}`);
}
