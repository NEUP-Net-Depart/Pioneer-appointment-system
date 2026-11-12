import { spawnSync } from 'node:child_process';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep maps private even when upload is disabled or fails. The copied native JS
// is already readable; Vite and the shared SDK are the transformed bundles.
export async function finishSourceMaps(directory, config, env = process.env) {
  try {
    if (!config.enabled) return;
    const key = env.POSTHOG_PERSONAL_API_KEY,
      project = env.POSTHOG_PROJECT_ID;
    if (!key && !project) {
      console.warn(
        'PostHog source maps not uploaded: configure POSTHOG_PROJECT_ID and POSTHOG_PERSONAL_API_KEY.'
      );
      return;
    }
    if (!key || !project)
      throw new Error(
        'Source map upload requires both POSTHOG_PROJECT_ID and POSTHOG_PERSONAL_API_KEY'
      );
    const cli = fileURLToPath(
      new URL('../node_modules/@posthog/cli/run-posthog-cli.js', import.meta.url)
    );
    for (const command of ['inject', 'upload']) {
      const result = spawnSync(
        process.execPath,
        [
          cli,
          'sourcemap',
          command,
          '--directory',
          directory,
          '--release-name',
          `pioneer-${config.environment}`,
          '--release-version',
          config.release
        ],
        {
          stdio: 'inherit',
          timeout: 120000,
          env: {
            ...env,
            POSTHOG_CLI_API_KEY: key,
            POSTHOG_CLI_PROJECT_ID: project,
            POSTHOG_CLI_HOST: config.posthog.host.replace('.i.posthog.com', '.posthog.com')
          }
        }
      );
      if (result.error || result.status !== 0)
        throw result.error || new Error(`PostHog source map ${command} failed; release stopped.`);
    }
  } finally {
    async function clean(path) {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const file = join(path, entry.name);
        if (entry.isDirectory()) await clean(file);
        else if (entry.name.endsWith('.map')) await rm(file);
        else if (entry.name.endsWith('.js')) {
          const source = await readFile(file, 'utf8');
          const stripped = source.replace(/^\/\/[#@] sourceMappingURL=.*$/gm, '');
          if (stripped !== source) await writeFile(file, stripped);
        }
      }
    }
    await clean(directory);
  }
}
