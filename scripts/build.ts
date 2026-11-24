import { telemetryBuildConfig, posthogHeaders } from './telemetry-build.ts';
import { finishSourceMaps } from './posthog-sourcemaps.ts';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { build as bundle } from 'esbuild';
import { staffWarrantyHeaders } from './warranty-deploy.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = resolve(root, 'dist');
if (out !== join(root, 'dist')) throw new Error('Unsafe output directory');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(join(root, 'public'), out, { recursive: true });
const telemetry = telemetryBuildConfig();
await writeFile(join(out, 'telemetry-config.js'), `window.pioneerTelemetry = Object.freeze(${JSON.stringify(telemetry)});\n`);
const headersPath = join(out, '_headers');
await writeFile(headersPath, posthogHeaders(staffWarrantyHeaders(await readFile(headersPath, 'utf8'), process.env.WARRANTY_CAPTCHA_ORIGIN), telemetry));
await mkdir(join(out, 'shared'), { recursive: true });
await cp(join(root, 'shared/styles.css'), join(out, 'shared/styles.css'));
// These browser entry points are also loaded directly by the diagnostics.
await bundle({
  absWorkingDir: root,
  entryPoints: ['shared/api.ts', 'shared/image-compress.ts', 'shared/zxing.ts'],
  outdir: join(out, 'shared'),
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  external: ['/assets/*', '/vendor/*']
});
await cp(join(root, 'frontend/assets'), join(out, 'assets'), { recursive: true });
await bundle({ entryPoints: [join(root, 'frontend/staff-react/posthog-sdk.ts')], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, sourcemap: true, outfile: join(out, 'assets/posthog.js') });
await mkdir(join(out, 'assets/vendor'), { recursive: true });
await cp(join(root, 'node_modules/blueimp-load-image/js/load-image.all.min.js'), join(out, 'assets/vendor/load-image.all.min.js'));
await cp(join(root, 'node_modules/blueimp-load-image/LICENSE.txt'), join(out, 'assets/vendor/blueimp-load-image-LICENSE.txt'));
// Keep the shared QR adapter's URLs stable for student and React staff pages.
await mkdir(join(out, 'vendor'), { recursive: true });
await bundle({ entryPoints: [join(root, 'node_modules/signature_pad/dist/signature_pad.js')], bundle: true, format: 'esm', platform: 'browser', target: 'es2019', minify: true, outfile: join(out, 'vendor/signature-pad.js') });
await cp(join(root, 'node_modules/signature_pad/LICENSE'), join(out, 'vendor/signature-pad-LICENSE'));
await cp(join(root, 'node_modules/zxing-wasm/LICENSE'), join(out, 'vendor/zxing-LICENSE'));
for (const kind of ['reader', 'writer']) {
  await bundle({ entryPoints: [join(root, `node_modules/zxing-wasm/dist/es/${kind}/index.js`)], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, outfile: join(out, `vendor/zxing-${kind}.js`) });
  await cp(join(root, `node_modules/zxing-wasm/dist/${kind}/zxing_${kind}.wasm`), join(out, `vendor/zxing_${kind}.wasm`));
}
await mkdir(join(out, 'vendor/ocr/core'), { recursive: true });
await mkdir(join(out, 'vendor/ocr/lang'), { recursive: true });
await cp(join(root, 'node_modules/tesseract.js/dist/worker.min.js'), join(out, 'vendor/ocr/worker.min.js'));
await cp(join(root, 'node_modules/tesseract.js/LICENSE.md'), join(out, 'vendor/ocr/tesseract-LICENSE.md'));
await cp(join(root, 'node_modules/tesseract.js-core/LICENSE'), join(out, 'vendor/ocr/core-LICENSE'));
await cp(join(root, 'node_modules/@tesseract.js-data/eng/package.json'), join(out, 'vendor/ocr/model-package.json'));
for (const name of await readdir(join(root, 'node_modules/tesseract.js-core'))) {
  if (/^tesseract-core.*\.(?:wasm|wasm\.js)$/.test(name)) await cp(join(root, 'node_modules/tesseract.js-core', name), join(out, 'vendor/ocr/core', name));
}
await cp(join(root, 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'), join(out, 'vendor/ocr/lang/eng.traineddata.gz'));
await build({ configFile: join(root, 'vite.config.ts') });
await finishSourceMaps(out, telemetry);
console.log('Built dist/: / and /staff/ with shared modules; Functions remain outside public assets.');
