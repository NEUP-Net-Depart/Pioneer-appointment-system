import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rename, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from './cli.mjs';

const dev = '2781f3977e131bdf0571069f2a510419a6c7f9a5';
const area = join(root, 'output', 'student-equivalence');
await mkdir(area, { recursive: true });
const runDirectory = await mkdtemp(join(area, 'run-'));
const checkout = join(runDirectory, 'dev');
const screenshots = join(runDirectory, 'screenshots');

function run(command, args, cwd = root, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(command + ' exited with status ' + result.status);
}

const env = {
  ...process.env,
  E2E_STUDENT_BASELINE: screenshots,
  POSTHOG_ENABLED: 'false',
  CF_WEB_ANALYTICS_TOKEN: ''
};
delete env.E2E_CAPTURE_STUDENT_BASELINE;
const scenario = 'tests/e2e/student-equivalence.spec.mjs';
const args = ['scripts/test-e2e.mjs', '--full', scenario, ...process.argv.slice(2)];
console.log('Screenshot baseline ' + dev + ' · ' + screenshots);
run('git', ['worktree', 'add', '--detach', checkout, dev]);
try {
  await symlink(join(root, 'node_modules'), join(checkout, 'node_modules'), 'junction');
  await copyFile(join(root, scenario), join(checkout, scenario));
  await copyFile(join(root, 'playwright.config.mjs'), join(checkout, 'playwright.config.mjs'));
  run(process.execPath, args, checkout, { ...env, E2E_CAPTURE_STUDENT_BASELINE: '1' });
  run(process.execPath, args, root, env);
} finally {
  await Promise.all(
    ['node_modules', scenario].map((name) => rm(join(checkout, name), { force: true }))
  );
  run('git', ['-C', checkout, 'restore', '--', 'playwright.config.mjs']);
  // Keep artifacts after removing the temporary checkout.
  await rename(join(checkout, 'output'), join(runDirectory, 'dev-results')).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  run('git', ['worktree', 'remove', checkout]);
}
