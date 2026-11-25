import type { telemetryBuildConfig } from './telemetry-build.ts';

type SourceMapRun = (command: string, args: string[], options: import('node:child_process').SpawnSyncOptions) => { status: number | null; error?: Error };
import { spawnSync } from 'node:child_process';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep maps private even when upload is disabled or fails.
export async function finishSourceMaps(directory: string, config: Pick<ReturnType<typeof telemetryBuildConfig>, 'enabled' | 'environment' | 'release' | 'posthog'>, env = process.env, run: SourceMapRun = spawnSync) {
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
      const result = run(
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
          timeout: 30000,
          env: {
            ...env,
            POSTHOG_CLI_API_KEY: key,
            POSTHOG_CLI_PROJECT_ID: project,
            POSTHOG_CLI_HOST: config.posthog.uiHost
          }
        }
      );
      if (result.error || result.status !== 0)
        throw (
          result.error || new Error(`PostHog source map ${command} failed (exit ${result.status}).`)
        );
    }
  } catch (error) {
    console.warn(`PostHog source maps unavailable; deployment will continue: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    async function clean(path: string) {
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
