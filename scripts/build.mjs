import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { build as bundle } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = resolve(root, 'dist');
if (out !== join(root, 'dist')) throw new Error('Unsafe output directory');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(join(root, 'public'), out, { recursive: true });
if (process.env.WARRANTY_CAPTCHA_ORIGIN) {
  const { captchaBridgeOrigin } = await import('../src/services/warranty/huawei.js');
  const origin = captchaBridgeOrigin(process.env.WARRANTY_CAPTCHA_ORIGIN);
  if (!origin) throw new Error('WARRANTY_CAPTCHA_ORIGIN must be an HTTPS origin or a local preview origin');
  const { readFile, writeFile } = await import('node:fs/promises');
  const headersPath = join(out, '_headers');
  const headers = await readFile(headersPath, 'utf8');
  const marker = '/staff/*\n'; const start = headers.indexOf(marker); const end = headers.indexOf('\n/staff/assets/*', start);
  const staff = headers.slice(start, end).replace("object-src 'none';", `frame-src ${origin}; object-src 'none';`);
  await writeFile(headersPath, headers.slice(0, start) + staff + headers.slice(end));
}
await cp(join(root, 'shared'), join(out, 'shared'), { recursive: true });
await cp(join(root, 'frontend/assets'), join(out, 'assets'), { recursive: true });
await mkdir(join(out, 'assets/vendor'), { recursive: true });
await cp(join(root, 'node_modules/blueimp-load-image/js/load-image.all.min.js'), join(out, 'assets/vendor/load-image.all.min.js'));
await cp(join(root, 'node_modules/blueimp-load-image/LICENSE.txt'), join(out, 'assets/vendor/blueimp-load-image-LICENSE.txt'));
// Keep the shared QR adapter's URLs stable for student and React staff pages.
await mkdir(join(out, 'vendor'), { recursive: true });
await cp(join(root, 'node_modules/zxing-wasm/LICENSE'), join(out, 'vendor/zxing-LICENSE'));
for (const kind of ['reader', 'writer']) {
  await bundle({ entryPoints: [join(root, `node_modules/zxing-wasm/dist/es/${kind}/index.js`)], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, outfile: join(out, `vendor/zxing-${kind}.js`) });
  await cp(join(root, `node_modules/zxing-wasm/dist/${kind}/zxing_${kind}.wasm`), join(out, `vendor/zxing_${kind}.wasm`));
}
{
  const { readFile, writeFile } = await import('node:fs/promises');
  const path = join(out, '_headers'); const headers = await readFile(path, 'utf8');
  const start = headers.indexOf('/staff/*\n'); const end = headers.indexOf('\n/staff/assets/*', start);
  const staff = headers.slice(start, end).replace("object-src 'none';", "worker-src 'self'; object-src 'none';");
  await writeFile(path, headers.slice(0, start) + staff + headers.slice(end));
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
await build({ configFile: join(root, 'vite.staff.config.mjs') });
await mkdir(join(out, 'user'));
for (const name of await readdir(join(root, 'frontend/user'))) {
  if (!(await stat(join(root, 'frontend/user', name))).isFile()) continue;
  await cp(join(root, 'frontend/user', name), join(out, name === 'index.html' ? name : `user/${name}`));
}
console.log('Built dist/: / and /staff/ with shared modules; Functions remain outside public assets.');
