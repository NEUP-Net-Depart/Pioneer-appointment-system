import { spawn } from 'node:child_process';
import { resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { root } from './cli.mjs';
import { smoke } from './smoke.mjs';
import { preparePreview, startPreview } from './e2e-preview.mjs';
import { startWarrantyVerifier } from './warranty-verifier-preview.mjs';

const serve = process.argv.includes('--serve');
const verifier = await startWarrantyVerifier();
process.env.WARRANTY_CAPTCHA_ORIGIN = verifier.origin;
process.env.E2E_VERIFIER_PARENTS = verifier.parentsFile;
let template, preview;
try {
  await import('./build.mjs');
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
    process.exitCode = await new Promise((onExit, reject) => {
      const child = spawn(
        process.execPath,
        [runner, 'test', '--config', 'playwright.config.mjs', ...process.argv.slice(2)],
        {
          cwd: root,
          env: {
            ...process.env,
            WRANGLER_SEND_METRICS: 'false',
            E2E_TEMPLATE_DIR: template.dir,
            E2E_OUTPUT_DIR: resolve(root, 'output/playwright', basename(template.dir)),
            E2E_ROOT_PASSWORD: template.rootPassword
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
