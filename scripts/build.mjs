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
await cp(join(root, 'shared'), join(out, 'shared'), { recursive: true });
await cp(join(root, 'frontend/assets'), join(out, 'assets'), { recursive: true });
await mkdir(join(out, 'assets/vendor'), { recursive: true });
await cp(join(root, 'node_modules/blueimp-load-image/js/load-image.all.min.js'), join(out, 'assets/vendor/load-image.all.min.js'));
await cp(join(root, 'node_modules/blueimp-load-image/LICENSE.txt'), join(out, 'assets/vendor/blueimp-load-image-LICENSE.txt'));
await cp(join(root, 'frontend/staff'), join(out, 'staff'), { recursive: true });
// Keep the shared QR adapter's URLs stable for both React and legacy pages.
await mkdir(join(out, 'vendor'), { recursive: true });
await cp(join(root, 'node_modules/zxing-wasm/LICENSE'), join(out, 'vendor/zxing-LICENSE'));
for (const kind of ['reader', 'writer']) {
  await bundle({ entryPoints: [join(root, `node_modules/zxing-wasm/dist/es/${kind}/index.js`)], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, outfile: join(out, `vendor/zxing-${kind}.js`) });
  await cp(join(root, `node_modules/zxing-wasm/dist/${kind}/zxing_${kind}.wasm`), join(out, `vendor/zxing_${kind}.wasm`));
}
await build({ configFile: join(root, 'vite.staff.config.mjs') });
await mkdir(join(out, 'user'));
for (const name of await readdir(join(root, 'frontend/user'))) {
  if (!(await stat(join(root, 'frontend/user', name))).isFile()) continue;
  await cp(join(root, 'frontend/user', name), join(out, name === 'index.html' ? name : `user/${name}`));
}
console.log('Built dist/: / and /staff/ with shared modules; Functions remain outside public assets.');
