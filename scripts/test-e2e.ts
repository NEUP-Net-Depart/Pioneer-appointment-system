import { spawn } from 'node:child_process';
import { resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { root } from './cli.ts';
import { smoke } from './smoke.ts';
import { preparePreview, startPreview } from './e2e-preview.ts';
import { startWarrantyVerifier } from './warranty-verifier-preview.ts';

const serve = process.argv.includes('--serve');
const suiteFlags = process.argv.slice(2).filter(arg => ['--full', '--diagnostics'].includes(arg));
if (suiteFlags.length > 1) throw new Error('Choose either --full or --diagnostics.');
const suite = suiteFlags[0]?.slice(2) || 'smoke';
const verifier = await startWarrantyVerifier();
process.env.WARRANTY_CAPTCHA_ORIGIN = verifier.origin;
process.env.E2E_VERIFIER_PARENTS = verifier.parentsFile;
let template: Awaited<ReturnType<typeof preparePreview>> | undefined;
let preview: Awaited<ReturnType<typeof startPreview>> | null | undefined;
try {
  await import('./build.ts');
  template = await preparePreview({ serve });
  preview = await startPreview(template.dir);
  await smoke(preview.baseURL, fetch, pathToFileURL(resolve(preview.dir, 'dist') + '/'));
  if (serve) {
    console.log(`Isolated local Preview ready: ${preview.baseURL}`);
    console.log(
      `Local root001 password is in ${resolve(preview.dir, '.dev.vars.preview')}. Stop with Ctrl+C; temporary data is removed.`
    );
    await new Promise((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
  } else {
    await preview.close();
    preview = null;
    console.log('Isolated local Preview verified; each test receives fresh D1/R2 state.');
    const runner = fileURLToPath(
      new URL('../node_modules/@playwright/test/cli.js', import.meta.url)
    );
    const { dir, rootPassword } = template;
    process.exitCode = await new Promise<number>((onExit, reject) => {
      const child = spawn(
        process.execPath,
        [runner, 'test', '--config', 'playwright.config.ts', ...process.argv.slice(2).filter(arg => !['--full', '--diagnostics'].includes(arg))],
        {
          cwd: root,
          env: {
            ...process.env,
            E2E_SUITE: suite,
            WRANGLER_SEND_METRICS: 'false',
            E2E_TEMPLATE_DIR: dir,
            E2E_OUTPUT_DIR: resolve(root, 'output/playwright', basename(dir)),
            E2E_ROOT_PASSWORD: rootPassword
          },
          stdio: 'inherit'
        }
      );
      child.once('error', reject);
      child.once('exit', (code) => onExit(code ?? 1));
    });
  }
} finally {
  await preview?.close();
  await template?.close();
  await verifier.close();
}
